const { normalizeHashtag, trimCaptionToLength } = require("./utils");

function buildSystemPrompt(config) {
  return (
    config.captions.systemPrompt ||
    [
      "You write elite Instagram Reel captions for a luxury lifestyle car channel.",
      "Your tone is cinematic, expensive, confident, polished, aspirational, and concise.",
      "Avoid cringe, generic hype, slang overload, and fake wealth clichés.",
      "Write in clean natural English with strong taste.",
      "Return only valid JSON with keys: headline, body, cta, hashtags.",
      "hashtags must be an array of hashtag strings without explanations."
    ].join(" ")
  );
}

function buildUserPrompt(file, config, templateCaption) {
  return JSON.stringify(
    {
      task: "Create an Instagram Reel caption for a luxury lifestyle car post.",
      channel: {
        name: config.channel.name,
        handle: config.channel.handle || "",
        voice: config.channel.voice,
        signature: config.channel.signature || "",
        cta: config.channel.cta || ""
      },
      asset: {
        fileName: file.name,
        keywords: templateCaption.keywords,
        fallbackHashtags: templateCaption.hashtags
      },
      rules: {
        maxHashtags: config.captions.maxHashtags,
        maxCaptionLength: config.captions.maxCaptionLength,
        includeLuxuryLifestyleTone: true,
        avoidEmojis: true,
        avoidMarkdown: true,
        avoidQuotesAroundSentences: true
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
  const lines = [
    String(payload.headline || "").trim(),
    String(payload.body || "").trim(),
    String(payload.cta || config.channel.cta || "").trim(),
    String(config.channel.signature || "").trim()
  ].filter(Boolean);

  const hashtags = sanitizeHashtags(payload.hashtags, fallback.hashtags).slice(0, config.captions.maxHashtags);
  const caption = trimCaptionToLength(`${lines.join("\n\n")}\n\n${hashtags.join(" ")}`, config.captions.maxCaptionLength);

  return {
    caption,
    hashtags,
    keywords: fallback.keywords,
    source: "groq"
  };
}

async function generateGroqCaption(file, config, env, templateCaption) {
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
        temperature: config.captions.temperature,
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
            content: buildUserPrompt(file, config, templateCaption)
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
    const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;

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
