const BASE_URL = "https://graph.threads.net";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
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
    throw new Error(`Threads API error ${resp.status}: ${textResp}`);
  }

  const data = textResp ? JSON.parse(textResp) : {};
  const id = data.id || data.post_id || data.creation_id;
  return { ok: !!id, id, raw: data };
}

async function postThreads(threadParts) {
  if (!Array.isArray(threadParts) || threadParts.length === 0) {
    return { ok: false, error: "No content." };
  }

  const token = requireEnv("THREADS_ACCESS_TOKEN");
  const userId = requireEnv("THREADS_USER_ID");

  const parts = threadParts
    .map((t) => (t || "").trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: "No content." };
  }

  let previousId = null;
  let rootId = null;

  try {
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
