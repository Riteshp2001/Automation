const { normalizeHashtag, trimCaptionToLength } = require("./utils");

function buildSystemPrompt(config) {
  return (
    config.captions.systemPrompt ||
    [
      "You are the ghostwriter for an elite, ultra-luxury lifestyle and automotive brand.",
      "Your primary task is to write a powerful, cinematic, emotionally resonant luxury quote that serves as the hook.",
      "Tone: Expensive, confident, polished, aspirational, motivational, and minimalist. Think quiet luxury and old money.",
      "Keep the writing premium, clean, tasteful, and memorable.",
      "Strictly avoid cringe hustle-culture lines, emoji overuse, generic hype, slang, fake wealth cliches, and empty flexing.",
      "Do not mention or label the raw file name, source asset, or any video title.",
      "Never write phrases like Video title, Title:, File name:, Filename:, Quote:, or Caption:.",
      "Return ONLY valid JSON with the exact keys: quote, body, cta, hashtags.",
      "The quote must be a standalone, impactful one-liner.",
      "The hashtags must be an array of premium, relevant hashtag strings."
    ].join(" ")
  );
}

function buildUserPrompt(config, templateCaption) {
  // Rotate themes so AI captions stay varied without depending on raw file names.
  const luxuryThemes = [
    "Late night drives and clear minds",
    "Building a timeless legacy",
    "Precision, engineering, and perfection",
    "Silent success and quiet moves",
    "Outworking the competition",
    "The art of exclusivity"
  ];
  const randomTheme = luxuryThemes[Math.floor(Math.random() * luxuryThemes.length)];

  return JSON.stringify(
    {
      task: "Generate a luxury automotive quote and short caption with emotional, motivational, premium language.",
      creativeDirection: {
        focusTheme: randomTheme,
        keywords: templateCaption.keywords || ["luxury", "cars", "lifestyle"],
        fallbackHashtags: templateCaption.hashtags
      },
      channelContext: {
        name: config.channel.name,
        handle: config.channel.handle || "",
        voice: config.channel.voice,
        signature: config.channel.signature || "",
        preferredCta: config.channel.cta || ""
      },
      rules: {
        maxHashtags: config.captions.maxHashtags,
        maxCaptionLength: config.captions.maxCaptionLength,
        includeLuxuryLifestyleTone: true,
        includeEmotionalLuxuryMotivation: true,
        avoidEmojis: true,
        avoidMarkdown: true,
        avoidRawFileName: true,
        avoidVideoTitleLabels: true,
        keepHashtagsPremiumAndRelevant: true
      }
    },
    null,
    2
  );
}

function sanitizeHashtags(hashtags, fallback) {
  if (!Array.isArray(hashtags)) {
    return fallback;
  }

  const normalized = hashtags
    .map((item) => normalizeHashtag(item))
    .filter(Boolean);

  return normalized.length ? [...new Set(normalized)] : fallback;
}

function buildCaptionFromGroqPayload(payload, config, fallback) {
  const quote = String(payload.quote || payload.headline || "").trim();

  const lines = [
    quote ? `"${quote}"` : "",
    String(payload.body || "").trim(),
    String(payload.cta || config.channel.cta || "").trim(),
    String(config.channel.signature || "").trim()
  ].filter(Boolean);

  const hashtags = sanitizeHashtags(payload.hashtags, fallback.hashtags).slice(0, config.captions.maxHashtags);
  const rawCaption = `${lines.join("\n\n")}\n\n${hashtags.join(" ")}`;
  const caption = trimCaptionToLength(rawCaption, config.captions.maxCaptionLength);

  return {
    caption,
    hashtags,
    keywords: fallback.keywords,
    source: "groq"
  };
}

async function generateGroqCaption(config, env, templateCaption) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.groqTimeoutMs);

  try {
    const response = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.captions.model || env.GROQ_MODEL,
        temperature: config.captions.temperature ?? 0.7,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(config)
          },
          {
            role: "user",
            content: buildUserPrompt(config, templateCaption)
          }
        ]
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Groq request failed: ${response.status} ${raw}`);
    }

    const parsed = JSON.parse(raw);
    const content = parsed.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Groq response did not include message content.");
    }

    const payload = JSON.parse(content);
    return buildCaptionFromGroqPayload(payload, config, templateCaption);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateGroqCaption
};
