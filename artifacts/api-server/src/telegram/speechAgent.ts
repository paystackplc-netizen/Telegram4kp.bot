import { logger } from "../lib/logger";

const OLLAMA_ENDPOINT =
  process.env["OLLAMA_ENDPOINT"] || "https://ollama.com/api/chat";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] || "gpt-oss:20b";

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

interface OllamaChatResponse {
  message?: { role: string; content: string };
  done?: boolean;
  error?: string;
}

export async function speechAgent(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = process.env["OLLAMA_API_KEY"];
  if (!apiKey) {
    logger.warn("OLLAMA_API_KEY not set, using fallback formatter");
    return basicFallback(text);
  }

  try {
    const res = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `TEXT:\n${text}` },
        ],
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 2048,
        },
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error(
        { status: res.status, body: body.slice(0, 500), model: OLLAMA_MODEL },
        "Ollama error",
      );
      return basicFallback(text);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const out = data.message?.content?.trim();
    if (!out) {
      logger.warn({ data: JSON.stringify(data).slice(0, 300) }, "Ollama returned empty output, using fallback");
      return basicFallback(text);
    }
    return out;
  } catch (err) {
    logger.error({ err }, "speechAgent failed, using fallback");
    return basicFallback(text);
  }
}
