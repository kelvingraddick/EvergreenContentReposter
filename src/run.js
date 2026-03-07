const { DateTime } = require("luxon");
const { AirtableClient, isoNow, runKeyNY } = require("./airtable");
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

async function main() {
  const timezone = process.env.TIMEZONE || "America/New_York";
  const runMinutesRaw = process.env.RUN_MINUTES || "";
  const runHours = (process.env.RUN_HOURS || "8,16")
    .split(",")
    .map(Number)
    .filter(n => !Number.isNaN(n));
  const runMinutes = runMinutesRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => !Number.isNaN(n) && n >= 0 && n <= 59);

  if (runHours.length === 0) {
    throw new Error("RUN_HOURS is empty or invalid.");
  }
  if (runMinutesRaw.trim().length > 0 && runMinutes.length === 0) {
    throw new Error("RUN_MINUTES is set but invalid.");
  }

  const nowNY = DateTime.now().setZone(timezone);
  const nowUTCISO = isoNow();

  if (!runHours.includes(nowNY.hour)) {
    console.log(`Not in RUN_HOURS (NY): ${nowNY.toISO()}`);
    return;
  }

  if (runMinutes.length > 0 && !runMinutes.includes(nowNY.minute)) {
    console.log(`Not in RUN_MINUTES (NY): ${nowNY.toISO()}`);
    return;
  }

  const runKey = runKeyNY(nowNY);

  const lookbackDays = Number(process.env.LOOKBACK_DAYS || "90");
  const cutoffNY = nowNY.minus({ days: lookbackDays });
  const cutoffISO = cutoffNY.toUTC().toISO();

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

  const job = await airtable.createJob(runKey, postRecordId, nowUTCISO);

  let threadsOk = false;
  let threadsId = "";
  let xOk = false;
  let xId = "";

  try {
    const threadsRes = await postThreads(threadsParts);
    threadsOk = !!threadsRes?.ok;
    threadsId = threadsRes?.postId || "";

    await airtable.createPublished(
      job.id,
      "Threads",
      threadsOk,
      threadsRes?.error || "",
      threadsId,
      isoNow()
    );
  } catch (err) {
    threadsOk = false;
    await airtable.createPublished(job.id, "Threads", false, String(err), "", isoNow());
  }

  try {
    const xRes = await postX(xParts);
    xOk = !!xRes?.ok;
    xId = xRes?.postId || "";

    await airtable.createPublished(
      job.id,
      "X",
      xOk,
      xRes?.error || "",
      xId,
      isoNow()
    );
  } catch (err) {
    xOk = false;
    await airtable.createPublished(job.id, "X", false, String(err), "", isoNow());
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
