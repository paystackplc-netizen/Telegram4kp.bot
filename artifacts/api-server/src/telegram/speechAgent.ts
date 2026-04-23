import { logger } from "../lib/logger";

const GEMINI_MODEL = process.env["GEMINI_MODEL"] || "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function buildPrompt(text: string): string {
  return `You rewrite written text into natural spoken language for a TTS engine.

RULES:
- Preserve the original meaning exactly. Do not add new facts.
- Rewrite for the ear, not the eye: contractions, natural rhythm, short clauses.
- Insert "..." for natural breathing pauses where a speaker would pause.
- Add emotion tags inline using parentheses where appropriate, chosen from:
  (calm) (whisper) (excited) (serious) (warm) (confident) (soft) (energetic)
- Convert numbers, symbols, abbreviations and acronyms into spoken form.
- Replace [PAUSE N] markers with "..." (longer pauses with more dots).
- Strip markdown, code fences, URLs, emojis, and any non-speech characters.
- Output ONLY the rewritten text. No preamble, no quotes, no explanations.

TEXT:
${text}`;
}

function basicFallback(text: string): string {
  return text
    .replace(/\[PAUSE\s+(\d+)\]/gi, (_m, n) => ".".repeat(Math.min(6, Number(n) + 2)))
    .replace(/[*_`>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function speechAgent(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    logger.warn("GEMINI_API_KEY not set, using fallback formatter");
    return basicFallback(text);
  }

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(text) }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body: body.slice(0, 500) }, "Gemini error");
      return basicFallback(text);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const out = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim();

    if (!out) {
      logger.warn("Gemini returned empty output, using fallback");
      return basicFallback(text);
    }
    return out;
  } catch (err) {
    logger.error({ err }, "speechAgent failed, using fallback");
    return basicFallback(text);
  }
}
