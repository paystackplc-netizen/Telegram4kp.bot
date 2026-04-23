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
  audio_content_type?: string;
  audio_url?: string;
  url?: string;
  message?: string;
  error?: string;
  error_name?: string;
}

export async function synthesize(
  text: string,
  voiceUuid: string,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const apiKey = process.env["RESEMBLE_API_KEY"];
  if (!apiKey) throw new Error("RESEMBLE_API_KEY not configured");
  if (!voiceUuid) throw new Error("Resemble voice UUID is empty");

  const projectUuid = (process.env["RESEMBLE_PROJECT_UUID"] || "").trim();

  const payload: Record<string, unknown> = {
    voice_uuid: voiceUuid,
    data: text,
    sample_rate: 22050,
    output_format: "wav",
    precision: "PCM_16",
  };
  if (projectUuid) payload["project_uuid"] = projectUuid;

  const res = await fetch(RESEMBLE_ENDPOINT, {
    method: "POST",
    headers: {
      // Resemble streaming/cluster endpoint expects x-access-token
      "x-access-token": apiKey,
      // Some Resemble endpoints also accept Authorization: Token <key>
      Authorization: `Token ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json, audio/*",
    },
    body: JSON.stringify(payload),
    signal,
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: body.slice(0, 500), voiceUuid },
      "Resemble TTS error",
    );
    throw new Error(`Resemble TTS failed: ${res.status} ${body.slice(0, 200)}`);
  }

  // Some endpoints return raw audio
  if (contentType.startsWith("audio/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: buf, contentType };
  }

  // JSON response with audio_content (base64) or audio_url
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as ResembleResponse;
    if (data.audio_content) {
      return {
        audio: Buffer.from(data.audio_content, "base64"),
        contentType: data.audio_content_type || "audio/wav",
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
