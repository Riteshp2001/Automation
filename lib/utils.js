function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHashtag(value) {
  const compact = String(value || "")
    .replace(/#/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim();

  return compact ? `#${compact}` : "";
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function stableHash(input) {
  let hash = 0;
  const value = String(input || "");

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function pickFromPool(pool, seed, fallback = "") {
  if (!Array.isArray(pool) || pool.length === 0) {
    return fallback;
  }

  return pool[seed % pool.length];
}

function trimCaptionToLength(caption, maxLength) {
  if (caption.length <= maxLength) {
    return caption;
  }

  const body = caption.slice(0, maxLength - 3).trimEnd();
  return `${body}...`;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  dedupe,
  normalizeHashtag,
  pickFromPool,
  sleep,
  stableHash,
  titleCase,
  trimCaptionToLength
};
