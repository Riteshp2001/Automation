const { z } = require("zod");

const DEFAULT_HEADLINES = [
  "Luxury is not loud. It is unforgettable.",
  "Some dreams arrive quietly, then change the whole room.",
  "The life you pray for starts with the standards you keep.",
  "When your vision is expensive, your silence gets louder."
];

const DEFAULT_VIBES = [
  "Proof that discipline can look beautiful when ambition finally wins.",
  "Every frame feels like a promise you made to yourself and kept.",
  "Calm on the surface, unstoppable underneath.",
  "Not every blessing announces itself. Some just arrive in perfect detail."
];

const DEFAULT_CTAS = [
  "Follow for more emotional luxury, motivation, and machine poetry.",
  "Stay close for premium quotes, elite mindset, and cinematic motion.",
  "More luxury motivation and unforgettable machine energy every week.",
  "Follow if ambition, discipline, and taste are your love language."
];

const DEFAULT_HASHTAGS = [
  "#LuxuryLifestyle",
  "#LuxuryCars",
  "#ExoticCars",
  "#LuxuryMotivation",
  "#QuietLuxury",
  "#MillionaireMindset",
  "#EliteMindset",
  "#DrivenToSucceed",
  "#SupercarDreams"
];

const DEFAULT_ANGLES = [
  "after-hours presence",
  "private-club energy",
  "quiet wealth",
  "first-class motion",
  "city-light confidence",
  "tailored power"
];

function normalizeString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim();
}

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  schedule: z.object({
    cron: z.string(),
    timezone: z.string()
  }),
  queue: z.object({
    order: z.enum(["oldest-first", "newest-first", "alphabetical"]).default("oldest-first"),
    postedHandling: z.enum(["move-to-archive", "state-file"]).default("state-file"),
    archiveFolderId: z.string().optional(),
    processingFolderId: z.string().optional(),
    stateFolderId: z.string().optional(),
    stateFileName: z.string().default(".car-reels-state.json"),
    allowedExtensions: z.array(z.string()).default(["mp4", "mov", "m4v", "webm"]),
    minSizeMb: z.number().nonnegative().default(1)
  }),
  channel: z.object({
    name: z.string().default("Luxury Motion"),
    handle: z.string().optional(),
    voice: z.string().default("luxury lifestyle, emotional, motivational, cinematic, polished, quiet wealth"),
    cta: z.string().default("Follow for more emotional luxury, motivation, and machine poetry."),
    signature: z.string().optional(),
    hashtags: z.array(z.string()).default(DEFAULT_HASHTAGS),
    angleKeywords: z.array(z.string()).default(DEFAULT_ANGLES)
  }),
  captions: z.object({
    mode: z.enum(["template", "groq", "hybrid"]).default("hybrid"),
    fallbackToTemplate: z.boolean().default(true),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).default(0.9),
    systemPrompt: z.string().optional(),
    maxHashtags: z.number().int().min(1).max(30).default(12),
    maxCaptionLength: z.number().int().min(120).max(2200).default(1800),
    includeFileKeywords: z.boolean().default(true),
    headlinePool: z.array(z.string()).default(DEFAULT_HEADLINES),
    vibePool: z.array(z.string()).default(DEFAULT_VIBES),
    ctaPool: z.array(z.string()).default(DEFAULT_CTAS)
  }),
  filters: z.object({
    nameMustContain: z.array(z.string()).default([]),
    nameMustNotContain: z.array(z.string()).default([])
  }),
  instagram: z.object({
    mediaType: z.enum(["REELS"]).default("REELS"),
    thumbOffsetMs: z.number().int().nonnegative().optional(),
    audioName: z.string().optional()
  }),
  dryRun: z.boolean().default(false)
});

function mergeDeep(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeDeep(output[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function buildDefaultConfig(env) {
  return {
    enabled: true,
    schedule: {
      cron: normalizeString(env.DEFAULT_SCHEDULE_CRON),
      timezone: normalizeString(env.DEFAULT_TIMEZONE, "UTC")
    },
    queue: {
      order: "oldest-first",
      postedHandling: "state-file",
      archiveFolderId: env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID,
      processingFolderId: env.GOOGLE_DRIVE_PROCESSING_FOLDER_ID,
      stateFolderId: env.GOOGLE_DRIVE_STATE_FOLDER_ID,
      stateFileName: ".car-reels-state.json",
      allowedExtensions: ["mp4", "mov", "m4v", "webm"],
      minSizeMb: 1
    },
    channel: {
      name: "Luxury Motion",
      voice: "luxury lifestyle, emotional, motivational, cinematic, polished, quiet wealth",
      cta: "Follow for more emotional luxury, motivation, and machine poetry.",
      hashtags: DEFAULT_HASHTAGS,
      angleKeywords: DEFAULT_ANGLES
    },
    captions: {
      mode: env.DEFAULT_CAPTION_MODE,
      fallbackToTemplate: true,
      model: normalizeString(env.GROQ_MODEL),
      temperature: 0.9,
      maxHashtags: 12,
      maxCaptionLength: 1800,
      includeFileKeywords: true,
      headlinePool: DEFAULT_HEADLINES,
      vibePool: DEFAULT_VIBES,
      ctaPool: DEFAULT_CTAS
    },
    filters: {
      nameMustContain: [],
      nameMustNotContain: []
    },
    instagram: {
      mediaType: "REELS"
    },
    dryRun: false
  };
}

function parseConfig(rawConfig, env) {
  const merged = mergeDeep(buildDefaultConfig(env), rawConfig || {});
  if (merged.schedule) {
    merged.schedule.cron = normalizeString(merged.schedule.cron);
    merged.schedule.timezone = normalizeString(merged.schedule.timezone, "UTC");
  }
  return ConfigSchema.parse(merged);
}

module.exports = {
  parseConfig
};
