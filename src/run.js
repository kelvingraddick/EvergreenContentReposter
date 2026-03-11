const { DateTime } = require("luxon");
const { AirtableClient, isoNow, runKeyUTC } = require("./airtable");
const { weightedPick } = require("./picker");
const { postX } = require("./platforms/x");
const { postThreads } = require("./platforms/threads");
const TARGET_THREADS = "threads";
const TARGET_X = "x";
const DEFAULT_TARGETS = [TARGET_THREADS, TARGET_X];

function parseDirectPostIdFromArgs(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = (argv[i] || "").trim();
    if (!arg) continue;

    if (arg === "--post-id" || arg === "--postId") {
      return (argv[i + 1] || "").trim();
    }
    if (arg.startsWith("--post-id=")) {
      return arg.slice("--post-id=".length).trim();
    }
    if (arg.startsWith("--postId=")) {
      return arg.slice("--postId=".length).trim();
    }
  }
  return "";
}

function parseTargetsFromArgs(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = (argv[i] || "").trim();
    if (!arg) continue;

    if (arg === "--targets" || arg === "--platforms") {
      return (argv[i + 1] || "").trim();
    }
    if (arg.startsWith("--targets=")) {
      return arg.slice("--targets=".length).trim();
    }
    if (arg.startsWith("--platforms=")) {
      return arg.slice("--platforms=".length).trim();
    }
  }
  return "";
}

function normalizeTargets(rawTargets) {
  const raw = String(rawTargets || "").trim();
  if (!raw) return new Set(DEFAULT_TARGETS);

  const normalized = new Set();
  const tokens = raw
    .split(/[,\s|]+/g)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === "both" || token === "all") {
      normalized.add(TARGET_THREADS);
      normalized.add(TARGET_X);
      continue;
    }
    if (token === "threads" || token === "thread") {
      normalized.add(TARGET_THREADS);
      continue;
    }
    if (token === "x" || token === "twitter") {
      normalized.add(TARGET_X);
      continue;
    }
    throw new Error(
      `Unsupported target "${token}". Use one or more of: threads, x (or both/all).`
    );
  }

  if (normalized.size === 0) {
    throw new Error("No valid targets were provided.");
  }

  return normalized;
}

function getPostPlatforms(record) {
  const raw = record?.fields?.Platforms;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .map((v) => (v === "thread" ? "threads" : v));
}

function ensurePostSupportsTargets(record, targets) {
  const platforms = new Set(getPostPlatforms(record));

  if (targets.has(TARGET_THREADS) && !platforms.has("threads")) {
    throw new Error(
      `Selected post ${record?.id || ""} does not include Threads in {Platforms}.`
    );
  }
  if (targets.has(TARGET_X) && !platforms.has("x")) {
    throw new Error(`Selected post ${record?.id || ""} does not include X in {Platforms}.`);
  }
}

function buildRunKey(nowUTC, directPostId) {
  const base = runKeyUTC(nowUTC);
  const trimmedId = String(directPostId || "").trim();
  if (!trimmedId) return base;

  const safeId = trimmedId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "unknown";
  return `${base}:direct:${safeId}:${nowUTC.toMillis()}`;
}

function splitPartsFromText(text) {
  return (text || "")
    .split(/---PART---/gi)
    .map(s => s.trim())
    .filter(Boolean);
}

function safeSplitByCharLimit(text, limit) {
  const words = (text || "").split(/\s+/);
  const parts = [];
  let current = "";

  for (const w of words) {
    const candidate = current.length ? `${current} ${w}` : w;
    if (candidate.length <= limit) {
      current = candidate;
    } else if (!current.length) {
      parts.push(candidate.slice(0, limit));
      current = candidate.slice(limit);
    } else {
      parts.push(current);
      current = w;
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

function buildThreadsPartsFromPostText(parts) {
  const max = 500;
  const out = [];
  for (const p of parts) out.push(...safeSplitByCharLimit(p, max));
  return out;
}

function buildXPartsFromPostText(parts) {
  const max = 280;
  const out = [];
  for (const p of parts) out.push(...safeSplitByCharLimit(p, max));
  return out;
}

function buildPlatformLink(platform, postId, providedLink = "") {
  if (providedLink) return providedLink;
  if (!postId) return "";
  if (/^https?:\/\//i.test(postId)) return postId;

  if (platform === "Threads") {
    const username = (process.env.THREADS_USERNAME || "").trim().replace(/^@/, "");
    const isNumericId = /^\d+$/.test(String(postId));
    if (username && !isNumericId) {
      return `https://www.threads.com/@${encodeURIComponent(username)}/post/${encodeURIComponent(postId)}`;
    }
    return `https://www.threads.com/t/${encodeURIComponent(postId)}`;
  }

  if (platform === "X") {
    return `https://x.com/i/web/status/${encodeURIComponent(postId)}`;
  }

  return "";
}

function logPostParts(platform, parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    console.log(`[${platform}] No parts generated.`);
    return;
  }
  parts.forEach((part, idx) => {
    console.log(`[${platform}] Part ${idx + 1}/${parts.length}: ${part}`);
  });
}

async function main() {
  const nowUTC = DateTime.now().toUTC();
  const nowUTCISO = isoNow();
  const directPostId = (parseDirectPostIdFromArgs() || process.env.DIRECT_POST_ID || "").trim();
  const rawTargets = (
    parseTargetsFromArgs() ||
    process.env.DIRECT_TARGET_PLATFORMS ||
    process.env.TARGET_PLATFORMS ||
    ""
  ).trim();
  const targets = normalizeTargets(rawTargets);
  const shouldPostThreads = targets.has(TARGET_THREADS);
  const shouldPostX = targets.has(TARGET_X);
  const runKey = buildRunKey(nowUTC, directPostId);

  const lookbackDays = Number(process.env.LOOKBACK_DAYS || "90");
  const cutoffISO = nowUTC.minus({ days: lookbackDays }).toISO();

  const airtable = new AirtableClient();

  const existingJob = await airtable.findJobByRunKey(runKey);
  if (existingJob) {
    console.log(`Run already exists for ${runKey}, exiting.`);
    return;
  }

  let chosen = null;
  if (directPostId) {
    chosen = await airtable.findPostByIdentifier(directPostId);
    if (!chosen) {
      throw new Error(
        `DIRECT_POST_ID "${directPostId}" was not found. Use Airtable record ID (rec...) or numeric {Id}.`
      );
    }
    ensurePostSupportsTargets(chosen, targets);
    console.log(`Direct override enabled. Identifier "${directPostId}" mapped to post record ${chosen.id}.`);
  } else {
    const candidates = await airtable.listEligiblePosts(cutoffISO, {
      requireX: shouldPostX,
      requireThreads: shouldPostThreads,
    });

    if (!candidates || candidates.length === 0) {
      const skipJob = await airtable.createJob(runKey, undefined, nowUTCISO);
      await airtable.updateJob(skipJob.id, {
        EndTime: isoNow(),
        Result: "Skipped"
      });
      console.log(`No eligible posts at ${runKey}, skipped.`);
      return;
    }

    chosen = weightedPick(candidates, "Weight");
    if (!chosen) {
      const skipJob = await airtable.createJob(runKey, undefined, nowUTCISO);
      await airtable.updateJob(skipJob.id, {
        EndTime: isoNow(),
        Result: "Skipped"
      });
      console.log(`Weighted pick failed, skipped.`);
      return;
    }
  }

  const postRecordId = chosen.id;
  const text = chosen.fields?.Text || "";
  const partsFromDelimiters = splitPartsFromText(text);

  const threadsParts = shouldPostThreads
    ? buildThreadsPartsFromPostText(partsFromDelimiters)
    : [];
  const xParts = shouldPostX ? buildXPartsFromPostText(partsFromDelimiters) : [];

  console.log(`Selected post record: ${postRecordId}`);
  console.log(
    `Target platforms: ${[
      shouldPostThreads ? "Threads" : null,
      shouldPostX ? "X" : null,
    ]
      .filter(Boolean)
      .join(", ")}`
  );
  console.log(`Selected post text:\n${text}`);
  if (shouldPostThreads) logPostParts("Threads", threadsParts);
  if (shouldPostX) logPostParts("X", xParts);

  const job = await airtable.createJob(runKey, postRecordId, nowUTCISO);

  let threadsOk = false;
  let threadsId = "";
  let xOk = false;
  let xId = "";

  if (shouldPostThreads) {
    try {
      const threadsRes = await postThreads(threadsParts);
      threadsOk = !!threadsRes?.ok;
      threadsId = threadsRes?.postId || "";
      const threadsLink = buildPlatformLink("Threads", threadsId, threadsRes?.link || threadsRes?.url || "");

      await airtable.createPublished(
        job.id,
        "Threads",
        threadsOk,
        threadsRes?.error || "",
        threadsId
      );

      if (threadsOk) {
        console.log(`[Threads] Published successfully. Post ID: ${threadsId || "n/a"}. Link: ${threadsLink || "n/a"}`);
      } else {
        console.warn(`[Threads] Publish failed. Error: ${threadsRes?.error || "Unknown error."}`);
      }
    } catch (err) {
      threadsOk = false;
      console.warn(`[Threads] Publish threw an error: ${String(err)}`);
      await airtable.createPublished(job.id, "Threads", false, String(err), "");
    }
  }

  if (shouldPostX) {
    try {
      const xRes = await postX(xParts);
      xOk = !!xRes?.ok;
      xId = xRes?.postId || "";
      const xLink = buildPlatformLink("X", xId, xRes?.link || xRes?.url || "");

      await airtable.createPublished(
        job.id,
        "X",
        xOk,
        xRes?.error || "",
        xId
      );

      if (xOk) {
        console.log(`[X] Published successfully. Post ID: ${xId || "n/a"}. Link: ${xLink || "n/a"}`);
      } else {
        console.warn(`[X] Publish failed. Error: ${xRes?.error || "Unknown error."}`);
      }
    } catch (err) {
      xOk = false;
      console.warn(`[X] Publish threw an error: ${String(err)}`);
      await airtable.createPublished(job.id, "X", false, String(err), "");
    }
  }

  const updateCooldown = {};
  if (shouldPostX && xOk) updateCooldown.LastPostedOnXTime = isoNow();
  if (shouldPostThreads && threadsOk) updateCooldown.LastPostedOnThreadsTime = isoNow();
  if (Object.keys(updateCooldown).length > 0) {
    await airtable.updatePostCooldown(postRecordId, updateCooldown);
  }

  const end = isoNow();
  const attemptedCount = Number(shouldPostThreads) + Number(shouldPostX);
  const successCount = Number(shouldPostThreads && threadsOk) + Number(shouldPostX && xOk);
  const jobResult =
    successCount === attemptedCount
      ? "Success"
      : successCount === 0
        ? "Failed"
        : "Partial";

  await airtable.updateJob(job.id, {
    EndTime: end,
    Result: jobResult
  });

  console.log(
    `Job ${job.id} finished with result ${jobResult}. ` +
      `Threads=${shouldPostThreads ? threadsOk : "not-targeted"}, ` +
      `X=${shouldPostX ? xOk : "not-targeted"}`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
