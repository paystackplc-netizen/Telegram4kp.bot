import { logger } from "../lib/logger";

const RESEMBLE_ENDPOINT =
  process.env["RESEMBLE_ENDPOINT"] || "https://f.cluster.resemble.ai/synthesize";

export interface TtsResult {
  audio: Buffer;
  contentType: string;
}

interface ResembleResponse {
  success?: boolean;
  audio_content?: string;
  audio_url?: string;
  url?: string;
  message?: string;
  error?: string;
}

export async function synthesize(
  text: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const apiKey = process.env["RESEMBLE_API_KEY"];
  if (!apiKey) throw new Error("RESEMBLE_API_KEY not configured");
  if (!voiceId) throw new Error("Resemble voice ID not configured. Set RESEMBLE_VOICE_DEFAULT.");

  const res = await fetch(RESEMBLE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ body: text, voice: voiceId }),
    signal,
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: body.slice(0, 500) },
      "Resemble TTS error",
    );
    throw new Error(`Resemble TTS failed: ${res.status}`);
  }

  // Some endpoints return raw audio, others return JSON with audio_content (base64) or audio_url
  if (contentType.startsWith("audio/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: buf, contentType };
  }

  if (contentType.includes("application/json")) {
    const data = (await res.json()) as ResembleResponse;
    if (data.audio_content) {
      return {
        audio: Buffer.from(data.audio_content, "base64"),
        contentType: "audio/wav",
      };
    }
    const url = data.audio_url || data.url;
    if (url) {
      const a = await fetch(url, { signal });
      if (!a.ok) throw new Error(`Failed to download audio: ${a.status}`);
      return {
        audio: Buffer.from(await a.arrayBuffer()),
        contentType: a.headers.get("content-type") || "audio/wav",
      };
    }
    throw new Error(`Resemble unexpected JSON: ${JSON.stringify(data).slice(0, 200)}`);
  }

  // Unknown content type — assume raw audio
  const buf = Buffer.from(await res.arrayBuffer());
  return { audio: buf, contentType: contentType || "audio/wav" };
}
