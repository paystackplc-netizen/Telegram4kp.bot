import { logger } from "../lib/logger";

const GEMINI_MODEL = process.env["GEMINI_MODEL"] || "gemini-2.5-flash";

const SYSTEM_PROMPT = `You rewrite written text into natural spoken language for a TTS engine.

RULES:
- Preserve the original meaning exactly. Do not add new facts.
- Rewrite for the ear, not the eye: contractions, natural rhythm, short clauses.
- Insert "..." for natural breathing pauses where a speaker would pause.
- Add emotion tags inline using parentheses where appropriate, chosen from:
  (calm) (whisper) (excited) (serious) (warm) (confident) (soft) (energetic)
- Convert numbers, symbols, abbreviations and acronyms into spoken form.
- Replace [PAUSE N] markers with "..." (longer pauses with more dots).
- Strip markdown, code fences, URLs, emojis, and any non-speech characters.
- Output ONLY the rewritten text. No preamble, no quotes, no explanations.`;

function basicFallback(text: string): string {
  return text
    .replace(/\[PAUSE\s+(\d+)\]/gi, (_m, n) => ".".repeat(Math.min(6, Number(n) + 2)))
    .replace(/[*_`>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { code?: string; message?: string };
}

export async function speechAgent(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];

  if (!baseUrl || !apiKey) {
    logger.warn("Replit Gemini integration not configured, using fallback formatter");
    return basicFallback(text);
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\nTEXT:\n${text}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 2048,
        },
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error(
        { status: res.status, body: body.slice(0, 500), model: GEMINI_MODEL },
        "Gemini error",
      );
      return basicFallback(text);
    }

    const data = (await res.json()) as GeminiResponse;
    const out = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim();

    if (!out) {
      logger.warn(
        { data: JSON.stringify(data).slice(0, 300) },
        "Gemini returned empty output, using fallback",
      );
      return basicFallback(text);
    }
    return out;
  } catch (err) {
    logger.error({ err }, "speechAgent failed, using fallback");
    return basicFallback(text);
  }
}
