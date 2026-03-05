async function postX(threadParts) {
  // Example interface:
  // Returns { ok: boolean, postId?: string, error?: string }

  if (!Array.isArray(threadParts) || threadParts.length === 0) {
    return { ok: false, error: "No content." };
  }

  // TODO implement X API calls here
  const error = "X posting not implemented. Fill in src/platforms/x.js with your X API calls.";
  return { ok: false, error };
}

module.exports = { postX };
