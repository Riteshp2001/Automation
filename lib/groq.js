const { normalizeHashtag, trimCaptionToLength } = require("./utils");

function buildSystemPrompt(config) {
  return (
    config.captions.systemPrompt ||
    [
      "You are the ghostwriter for an elite, ultra-luxury lifestyle and automotive brand.",
      "Your primary task is to write powerful, cinematic, and stoic luxury quotes that serve as the hook.",
      "Tone: Expensive, highly confident, minimalist, and aspirational. Think 'quiet luxury' and 'old money'.",
      "Strictly avoid: Cringe hustle-culture quotes, emoji overuse, generic hype, slang, and fake wealth clichés.",
      "Return ONLY valid JSON with the following exact keys: quote, body, cta, hashtags.",
      "The 'quote' must be a standalone, impactful one-liner.",
      "The 'hashtags' must be an array of string values."
    ].join(" ")
  );
}

function buildUserPrompt(config, templateCaption) {
  // Instead of relying on a file name, we force the AI to rotate through luxury themes
  // so your content doesn't get repetitive.
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
      task: "Generate a luxury automotive quote and short caption.",
      creativeDirection: {
        focusTheme: randomTheme,
        keywords: templateCaption.keywords || ["luxury", "cars", "lifestyle"]
      },
      channelContext: {
        name: config.channel.name,
        voice: config.channel.voice,
        signature: config.channel.signature || "",
        preferredCta: config.channel.cta || ""
      },
      rules: {
        maxHashtags: config.captions.maxHashtags,
        maxCaptionLength: config.captions.maxCaptionLength,
        avoidMarkdown: true,
        avoidEmojis: true
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
  // Format the quote to stand out at the top of the reel
  const formattedQuote = payload.quote ? `"${payload.quote.trim()}"` : "";
  
  const lines = [
    formattedQuote,
    String(payload.body || "").trim(),
    String(payload.cta || config.channel.cta || "").trim(),
    String(config.channel.signature || "").trim()
  ].filter(Boolean); // removes empty lines

  const hashtags = sanitizeHashtags(payload.hashtags, fallback.hashtags).slice(0, config.captions.maxHashtags);
  
  // Assemble final string
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
        temperature: config.captions.temperature || 0.7, // 0.7 gives good creative variance for quotes
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
            // Note: 'file' is no longer passed in here
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
