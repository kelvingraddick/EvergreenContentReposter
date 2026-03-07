const { DateTime } = require("luxon");
const { AirtableClient, isoNow, runKeyUTC } = require("./airtable");
const { weightedPick } = require("./picker");
const { postX } = require("./platforms/x");
const { postThreads } = require("./platforms/threads");

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
    if (username) {
      return `https://www.threads.net/@${username}/post/${encodeURIComponent(postId)}`;
    }
    return `https://www.threads.net/t/${encodeURIComponent(postId)}`;
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
  const runKey = runKeyUTC(nowUTC);

  const lookbackDays = Number(process.env.LOOKBACK_DAYS || "90");
  const cutoffISO = nowUTC.minus({ days: lookbackDays }).toISO();

  const airtable = new AirtableClient();

  const existingJob = await airtable.findJobByRunKey(runKey);
  if (existingJob) {
    console.log(`Run already exists for ${runKey}, exiting.`);
    return;
  }

  const candidates = await airtable.listEligiblePosts(cutoffISO);

  if (!candidates || candidates.length === 0) {
    const skipJob = await airtable.createJob(runKey, undefined, nowUTCISO);
    await airtable.updateJob(skipJob.id, {
      EndTime: isoNow(),
      Result: "Skipped"
    });
    console.log(`No eligible posts at ${runKey}, skipped.`);
    return;
  }

  const chosen = weightedPick(candidates, "Weight");
  if (!chosen) {
    const skipJob = await airtable.createJob(runKey, undefined, nowUTCISO);
    await airtable.updateJob(skipJob.id, {
      EndTime: isoNow(),
      Result: "Skipped"
    });
    console.log(`Weighted pick failed, skipped.`);
    return;
  }

  const postRecordId = chosen.id;
  const text = chosen.fields?.Text || "";
  const partsFromDelimiters = splitPartsFromText(text);

  const threadsParts = buildThreadsPartsFromPostText(partsFromDelimiters);
  const xParts = buildXPartsFromPostText(partsFromDelimiters);

  console.log(`Selected post record: ${postRecordId}`);
  console.log(`Selected post text:\n${text}`);
  logPostParts("Threads", threadsParts);
  logPostParts("X", xParts);

  const job = await airtable.createJob(runKey, postRecordId, nowUTCISO);

  let threadsOk = false;
  let threadsId = "";
  let xOk = false;
  let xId = "";

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

  const updateCooldown = {};
  if (xOk) updateCooldown.LastPostedOnXTime = isoNow();
  if (threadsOk) updateCooldown.LastPostedOnThreadsTime = isoNow();
  if (Object.keys(updateCooldown).length > 0) {
    await airtable.updatePostCooldown(postRecordId, updateCooldown);
  }

  const end = isoNow();
  const jobResult = threadsOk && xOk ? "Success" : threadsOk || xOk ? "Partial" : "Failed";

  await airtable.updateJob(job.id, {
    EndTime: end,
    Result: jobResult
  });

  console.log(`Job ${job.id} finished with result ${jobResult}. Threads=${threadsOk}, X=${xOk}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
