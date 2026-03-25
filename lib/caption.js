const {
  dedupe,
  normalizeHashtag,
  pickFromPool,
  stableHash,
  titleCase,
  trimCaptionToLength
} = require("./utils");
const { generateGroqCaption } = require("./groq");

const STOP_WORDS = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "reel",
  "reels",
  "video",
  "clip",
  "final",
  "edit",
  "export",
  "luxury",
  "lifestyle",
  "black",
  "white",
  "night",
  "drive",
  "badge",
  "official",
  "trending"
]);

function extractKeywords(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function sentenceFromKeywords(keywords) {
  if (!keywords.length) {
    return "Luxury is what happens when patience, discipline, and self-respect finally share the same address.";
  }

  const pretty = keywords.slice(0, 3).map(titleCase).join(" · ");
  return `${pretty}. A reminder that the life you want starts with the standards you refuse to lower.`;
}

function buildHashtags(file, config, seed) {
  const base = Array.isArray(config.channel.hashtags) ? config.channel.hashtags : [];
  const keywordTags = extractKeywords(file.name)
    .slice(0, 4)
    .map((keyword) => normalizeHashtag(titleCase(keyword).replace(/\s+/g, "")));

  const curated = dedupe([...base, ...keywordTags]).filter(Boolean);
  const limited = curated.slice(0, config.captions.maxHashtags);

  if (limited.length >= config.captions.maxHashtags) {
    return limited;
  }

  const backup = [
    "#LuxuryLifestyle",
    "#LuxuryCars",
    "#SupercarDreams",
    "#ExoticCars",
    "#LuxuryMotivation",
    "#QuietLuxury",
    "#DrivenToSucceed",
    "#MillionaireMindset",
    "#EliteMindset"
  ];

  const rotated = [];
  for (let index = 0; index < backup.length; index += 1) {
    rotated.push(backup[(seed + index) % backup.length]);
  }

  return dedupe([...limited, ...rotated]).slice(0, config.captions.maxHashtags);
}

function buildTemplateCaption(file, config) {
  const seed = stableHash(`${file.id}:${file.name}`);
  const keywords = extractKeywords(file.name);
  const headline = pickFromPool(config.captions.headlinePool, seed, "Luxury is not loud. It is unforgettable.");
  const vibe = pickFromPool(config.captions.vibePool, seed + 1, "Every detail feels like a promise finally kept.");
  const angle = pickFromPool(config.channel.angleKeywords, seed + 2, "quiet wealth");
  const cta =
    config.channel.cta ||
    pickFromPool(config.captions.ctaPool, seed + 3, "Follow for more emotional luxury, motivation, and machine poetry.");
  const keywordSentence = config.captions.includeFileKeywords
    ? sentenceFromKeywords(keywords)
    : "Luxury is what happens when discipline, taste, and patience finally move in the same direction.";

  const lines = [
    headline,
    `${keywordSentence} ${vibe} Built with ${angle}.`,
    cta,
    config.channel.signature || ""
  ].filter(Boolean);

  const hashtags = buildHashtags(file, config, seed);
  const caption = trimCaptionToLength(`${lines.join("\n\n")}\n\n${hashtags.join(" ")}`, config.captions.maxCaptionLength);

  return {
    caption,
    hashtags,
    keywords,
    source: "template"
  };
}

async function generateCaption(file, config, env) {
  const templateCaption = buildTemplateCaption(file, config);
  const mode = config.captions.mode;
  const canUseGroq = Boolean(env.GROQ_API_KEY);

  if (mode === "template") {
    return templateCaption;
  }

  if (!canUseGroq) {
    if (mode === "groq" && !config.captions.fallbackToTemplate) {
      throw new Error("GROQ_API_KEY is missing and captions.mode is set to groq without fallback.");
    }

    return {
      ...templateCaption,
      source: "template-fallback"
    };
  }

  try {
    return await generateGroqCaption(config, env, templateCaption);
  } catch (error) {
    if (!config.captions.fallbackToTemplate) {
      throw error;
    }

    return {
      ...templateCaption,
      source: "template-fallback",
      warning: error.message
    };
  }
}

module.exports = {
  buildTemplateCaption,
  generateCaption
};
