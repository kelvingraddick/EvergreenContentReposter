const crypto = require("node:crypto");

const DEFAULT_X_API_BASE_URL = "https://api.x.com/2";

function parseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function encodeRFC3986(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function buildXRequestError(status, textResp) {
  const data = parseJSON(textResp);
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const firstError = errors[0] || null;
  const apiMessage = (
    firstError?.message ||
    data?.detail ||
    data?.title ||
    textResp ||
    "Unknown X API error."
  );

  if (status === 401) {
    return [
      "X authentication failed (401).",
      "Check OAuth 1.0a user-context credentials (`X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`).",
      `API message: ${apiMessage}`,
    ].join(" ");
  }

  if (status === 403) {
    return `X API error 403: ${apiMessage}`;
  }

  return `X API error ${status}: ${apiMessage}`;
}

function buildOAuth1Header(method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const urlObj = new URL(url);
  const baseURL = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const signatureParams = [];

  for (const [k, v] of Object.entries(oauthParams)) {
    signatureParams.push([encodeRFC3986(k), encodeRFC3986(v)]);
  }

  for (const [k, v] of urlObj.searchParams.entries()) {
    signatureParams.push([encodeRFC3986(k), encodeRFC3986(v)]);
  }

  signatureParams.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });

  const parameterString = signatureParams.map(([k, v]) => `${k}=${v}`).join("&");
  const baseString = [
    method.toUpperCase(),
    encodeRFC3986(baseURL),
    encodeRFC3986(parameterString),
  ].join("&");

  const signingKey = `${encodeRFC3986(consumerSecret)}&${encodeRFC3986(accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  const auth = Object.entries(headerParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRFC3986(k)}="${encodeRFC3986(v)}"`)
    .join(", ");

  return `OAuth ${auth}`;
}

function buildAuthHeader(method, url) {
  const consumerKey = requireEnv("X_CONSUMER_KEY");
  const consumerSecret = requireEnv("X_CONSUMER_SECRET");
  const accessToken = requireEnv("X_ACCESS_TOKEN");
  const accessTokenSecret = requireEnv("X_ACCESS_TOKEN_SECRET");

  return buildOAuth1Header(method, url, consumerKey, consumerSecret, accessToken, accessTokenSecret);
}

async function createTweet(text, inReplyToTweetId) {
  const baseUrl = (process.env.X_API_BASE_URL || DEFAULT_X_API_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/tweets`;
  const body = { text };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: inReplyToTweetId };
  }

  const authHeader = buildAuthHeader("POST", url);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const textResp = await resp.text();
  if (!resp.ok) {
    throw new Error(buildXRequestError(resp.status, textResp));
  }

  const data = parseJSON(textResp) || {};
  const id = data?.data?.id || data?.id || "";
  if (!id) {
    throw new Error("X API response missing tweet id.");
  }

  return {
    id,
    raw: data,
  };
}

async function postX(threadParts) {
  if (!Array.isArray(threadParts) || threadParts.length === 0) {
    return { ok: false, error: "No content." };
  }

  const parts = threadParts
    .map((t) => (t || "").trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: "No content." };
  }

  let previousId = "";
  let rootId = "";

  try {
    for (const part of parts) {
      const result = await createTweet(part, previousId || undefined);
      if (!rootId) rootId = result.id;
      previousId = result.id;
    }

    return {
      ok: true,
      postId: rootId,
      link: `https://x.com/i/web/status/${encodeURIComponent(rootId)}`,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = { postX };
