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
  "lifestyle"
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
    return "Curated for a lifestyle that never needs to introduce itself.";
  }

  const pretty = keywords.slice(0, 3).map(titleCase).join(" · ");
  return `${pretty}. The kind of motion that looks effortless and costs attention.`;
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
    "#SupercarLife",
    "#ExoticCars",
    "#LuxuryReels",
    "#DriveInStyle",
    "#RichVibesOnly",
    "#HighTaste"
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
  const headline = pickFromPool(config.captions.headlinePool, seed, "Luxury, framed with intent.");
  const vibe = pickFromPool(config.captions.vibePool, seed + 1, "Every detail carries presence.");
  const angle = pickFromPool(config.channel.angleKeywords, seed + 2, "quiet wealth");
  const cta = config.channel.cta || pickFromPool(config.captions.ctaPool, seed + 3, "Follow for more luxury machine moments.");
  const keywordSentence = config.captions.includeFileKeywords
    ? sentenceFromKeywords(keywords)
    : "Curated motion for people who understand the difference between loud and expensive.";

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
    return await generateGroqCaption(file, config, env, templateCaption);
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
