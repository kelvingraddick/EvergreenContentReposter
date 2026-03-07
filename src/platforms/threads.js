const BASE_URL = "https://graph.threads.net";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function parseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildThreadsRequestError(status, textResp) {
  const data = parseJSON(textResp);
  const apiMessage = data?.error?.message || textResp || "Unknown Threads API error.";
  const apiCode = data?.error?.code;

  if (status === 401 && apiCode === 190) {
    return [
      "Threads access token is expired or invalid (OAuth code 190).",
      "Refresh or replace `THREADS_ACCESS_TOKEN` in your GitHub secret, then rerun.",
      `API message: ${apiMessage}`,
    ].join(" ");
  }

  return `Threads API error ${status}: ${apiMessage}`;
}

async function refreshAccessTokenIfPossible(token) {
  if (process.env.THREADS_DISABLE_AUTO_REFRESH === "true") {
    return token;
  }

  const qs = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: token,
  });
  const url = `${BASE_URL}/refresh_access_token?${qs.toString()}`;

  const resp = await fetch(url, { method: "GET" });
  const textResp = await resp.text();
  if (!resp.ok) {
    throw new Error(buildThreadsRequestError(resp.status, textResp));
  }

  const data = parseJSON(textResp);
  const refreshed = data?.access_token;
  if (!refreshed) return token;

  if (refreshed !== token) {
    console.warn("Threads access token was refreshed for this run.");
  }

  return refreshed;
}

async function createTextPost(token, userId, text, replyToId) {
  const qs = new URLSearchParams({
    text,
    media_type: "TEXT",
    auto_publish_text: "true",
    access_token: token,
  });
  if (replyToId) qs.append("reply_to_id", replyToId);

  const url = `${BASE_URL}/${userId}/threads?${qs.toString()}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const textResp = await resp.text();
  if (!resp.ok) {
    throw new Error(buildThreadsRequestError(resp.status, textResp));
  }

  const data = parseJSON(textResp) || {};
  const id = data.id || data.post_id || data.creation_id;
  return { ok: !!id, id, raw: data };
}

async function postThreads(threadParts) {
  if (!Array.isArray(threadParts) || threadParts.length === 0) {
    return { ok: false, error: "No content." };
  }

  const baseToken = requireEnv("THREADS_ACCESS_TOKEN");
  const userId = requireEnv("THREADS_USER_ID");
  let token = baseToken;

  const parts = threadParts
    .map((t) => (t || "").trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: "No content." };
  }

  let previousId = null;
  let rootId = null;

  try {
    try {
      token = await refreshAccessTokenIfPossible(baseToken);
    } catch (err) {
      console.warn(`Threads token refresh failed; using configured token. ${String(err?.message || err)}`);
    }

    for (const part of parts) {
      const res = await createTextPost(token, userId, part, previousId);
      if (!res?.ok || !res.id) {
        return { ok: false, error: "Thread creation failed." };
      }

      if (!rootId) rootId = res.id;
      previousId = res.id;
    }

    return { ok: true, postId: rootId };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = { postThreads };
