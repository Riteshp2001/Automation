const crypto = require("crypto");

function signPayload(secret, fileId, expires) {
  return crypto.createHmac("sha256", secret).update(`${fileId}:${expires}`).digest("hex");
}

function buildMediaProxyUrl(env, fileId, ttlMs = 15 * 60 * 1000) {
  if (!env.appBaseUrl) {
    throw new Error(
      "APP_BASE_URL is required for Instagram Login uploads. Set it to your Vercel deployment URL."
    );
  }

  if (!env.mediaProxySecret) {
    throw new Error(
      "MEDIA_PROXY_SECRET is required for Instagram Login uploads. Set MEDIA_PROXY_SECRET or ADMIN_API_SECRET."
    );
  }

  const expires = Date.now() + ttlMs;
  const sig = signPayload(env.mediaProxySecret, fileId, expires);
  const url = new URL(`${env.appBaseUrl}/api/media`);
  url.searchParams.set("fileId", fileId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", sig);
  return url.toString();
}

function verifyMediaProxySignature(env, fileId, expires, sig) {
  if (!env.mediaProxySecret) {
    return false;
  }

  if (!fileId || !expires || !sig) {
    return false;
  }

  const expiryTimestamp = Number(expires);
  if (!Number.isFinite(expiryTimestamp) || Date.now() > expiryTimestamp) {
    return false;
  }

  const expected = signPayload(env.mediaProxySecret, fileId, expiryTimestamp);
  const received = String(sig);

  if (received.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

module.exports = {
  buildMediaProxyUrl,
  verifyMediaProxySignature
};
