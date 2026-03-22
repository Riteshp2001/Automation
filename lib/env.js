const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const preferredEnvPath = path.join(process.cwd(), ".env");
const fallbackEnvPath = path.join(process.cwd(), ".env.example");

function assignIfMissing(entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function extractMultilineJsonEnv(text, key) {
  const marker = `${key}=`;
  const startIndex = text.indexOf(marker);

  if (startIndex === -1) {
    return {
      text,
      value: undefined
    };
  }

  const valueStart = startIndex + marker.length;
  if (text[valueStart] !== "{") {
    return {
      text,
      value: undefined
    };
  }

  let depth = 0;
  let endIndex = valueStart;

  for (; endIndex < text.length; endIndex += 1) {
    const char = text[endIndex];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex += 1;
        break;
      }
    }
  }

  const extractedValue = text.slice(valueStart, endIndex).trim();
  const lineEndIndex = text.indexOf("\n", endIndex);
  const removeUntil = lineEndIndex === -1 ? text.length : lineEndIndex + 1;

  return {
    value: extractedValue,
    text: `${text.slice(0, startIndex)}${text.slice(removeUntil)}`
  };
}

function loadEnvFile(filePath) {
  const rawText = fs.readFileSync(filePath, "utf8");
  const extracted = extractMultilineJsonEnv(rawText, "GOOGLE_SERVICE_ACCOUNT_JSON");
  const parsed = dotenv.parse(extracted.text);

  if (extracted.value && parsed.GOOGLE_SERVICE_ACCOUNT_JSON === undefined) {
    parsed.GOOGLE_SERVICE_ACCOUNT_JSON = extracted.value;
  }

  assignIfMissing(parsed);
}

if (fs.existsSync(preferredEnvPath)) {
  loadEnvFile(preferredEnvPath);
} else if (fs.existsSync(fallbackEnvPath)) {
  loadEnvFile(fallbackEnvPath);
}

const { z } = require("zod");

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(env) {
  const explicit = String(env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) {
    return explicit;
  }

  const vercelUrl = String(env.VERCEL_URL || "").trim().replace(/\/+$/, "");
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return "";
}

const EnvSchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_IMPERSONATED_USER_EMAIL: z.string().email().optional(),
  GOOGLE_DRIVE_SOURCE_FOLDER_ID: z.string().min(1),
  GOOGLE_DRIVE_ARCHIVE_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_PROCESSING_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_STATE_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_CONFIG_FILE_ID: z.string().optional(),
  GOOGLE_DRIVE_CONFIG_FILE_NAME: z.string().default("channel-config.json"),
  GOOGLE_DRIVE_SHARED_DRIVE_ID: z.string().optional(),
  GOOGLE_DRIVE_SUPPORTS_ALL_DRIVES: z.string().optional(),
  INSTAGRAM_USER_ID: z.string().min(1),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().optional(),
  META_USER_ACCESS_TOKEN: z.string().optional(),
  META_API_VERSION: z.string().default("v25.0"),
  INSTAGRAM_AUTH_MODE: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  MEDIA_PROXY_SECRET: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_TIMEOUT_MS: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  CRON_SHARED_SECRET: z.string().optional(),
  ADMIN_API_SECRET: z.string().optional(),
  DEFAULT_TIMEZONE: z.string().default("UTC"),
  DEFAULT_SCHEDULE_CRON: z.string().default("0 8 * * *"),
  DEFAULT_CAPTION_MODE: z.string().default("hybrid"),
  ENABLE_UPLOADS: z.string().optional(),
  MAX_UPLOAD_RETRIES: z.string().optional(),
  MAX_VIDEO_SIZE_MB: z.string().optional(),
  STATUS_POLL_ATTEMPTS: z.string().optional(),
  STATUS_POLL_INTERVAL_MS: z.string().optional()
});

function normalizeCredentials(env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return {
      clientEmail: parsed.client_email,
      privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n")
    };
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error(
      "Google credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }

  return {
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: String(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).replace(/\\n/g, "\n")
  };
}

function resolveInstagramAuthMode(env) {
  const explicitMode = String(env.INSTAGRAM_AUTH_MODE || "")
    .trim()
    .toLowerCase();

  if (explicitMode === "instagram-login" || explicitMode === "facebook-login") {
    return explicitMode;
  }

  const metaUserAccessToken = String(env.META_USER_ACCESS_TOKEN || "").trim();
  const pageAccessToken = String(env.INSTAGRAM_PAGE_ACCESS_TOKEN || "").trim();

  if (metaUserAccessToken.startsWith("IG") || pageAccessToken.startsWith("IG")) {
    return "instagram-login";
  }

  return "facebook-login";
}

function resolveInstagramAccessToken(env, instagramAuthMode) {
  if (instagramAuthMode === "instagram-login") {
    return String(env.META_USER_ACCESS_TOKEN || env.INSTAGRAM_PAGE_ACCESS_TOKEN || "").trim();
  }

  return String(env.INSTAGRAM_PAGE_ACCESS_TOKEN || env.META_USER_ACCESS_TOKEN || "").trim();
}

let cachedEnv;

function loadEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const normalizedProcessEnv = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => {
      if (typeof value !== "string") {
        return [key, value];
      }

      const trimmed = value.trim();
      return [key, trimmed === "" ? undefined : trimmed];
    })
  );

  const parsed = EnvSchema.parse(normalizedProcessEnv);
  const credentials = normalizeCredentials(parsed);
  const instagramAuthMode = resolveInstagramAuthMode(parsed);
  const instagramAccessToken = resolveInstagramAccessToken(parsed, instagramAuthMode);

  if (!instagramAccessToken) {
    throw new Error(
      instagramAuthMode === "instagram-login"
        ? "Instagram credentials are missing. Set META_USER_ACCESS_TOKEN for Instagram Login."
        : "Instagram credentials are missing. Set INSTAGRAM_PAGE_ACCESS_TOKEN for Facebook Login."
    );
  }

  cachedEnv = {
    ...parsed,
    ...credentials,
    instagramAuthMode,
    instagramAccessToken,
    instagramGraphBaseUrl:
      instagramAuthMode === "instagram-login"
        ? "https://graph.instagram.com"
        : "https://graph.facebook.com",
    appBaseUrl: normalizeBaseUrl(parsed),
    supportsAllDrives: parseBoolean(parsed.GOOGLE_DRIVE_SUPPORTS_ALL_DRIVES, true),
    enableUploads: parseBoolean(parsed.ENABLE_UPLOADS, true),
    maxUploadRetries: Math.max(1, parseNumber(parsed.MAX_UPLOAD_RETRIES, 2)),
    maxVideoSizeBytes: Math.max(1, parseNumber(parsed.MAX_VIDEO_SIZE_MB, 512)) * 1024 * 1024,
    groqTimeoutMs: Math.max(1000, parseNumber(parsed.GROQ_TIMEOUT_MS, 15000)),
    statusPollAttempts: Math.max(1, parseNumber(parsed.STATUS_POLL_ATTEMPTS, 10)),
    statusPollIntervalMs: Math.max(1000, parseNumber(parsed.STATUS_POLL_INTERVAL_MS, 20000)),
    cronSecret: parsed.CRON_SECRET || parsed.CRON_SHARED_SECRET || "",
    adminSecret: parsed.ADMIN_API_SECRET || parsed.CRON_SECRET || parsed.CRON_SHARED_SECRET || "",
    mediaProxySecret:
      parsed.MEDIA_PROXY_SECRET ||
      parsed.ADMIN_API_SECRET ||
      parsed.CRON_SECRET ||
      parsed.CRON_SHARED_SECRET ||
      ""
  };

  return cachedEnv;
}

module.exports = {
  loadEnv
};
