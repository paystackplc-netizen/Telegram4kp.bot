import { spawn } from "node:child_process";
import { logger } from "../lib/logger";

const RESEMBLE_ENDPOINT =
  process.env["RESEMBLE_ENDPOINT"] || "https://f.cluster.resemble.ai/synthesize";

export interface TtsResult {
  audio: Buffer;
  contentType: string;
}

// Convert any audio Buffer to OGG/Opus, the format Telegram requires
// for real "voice note" playback (otherwise it falls back to a generic file).
async function toOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-vn",
        "-ac", "1",
        "-ar", "48000",
        "-c:a", "libopus",
        "-b:a", "48k",
        "-application", "voip",
        "-f", "ogg",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => errs.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited ${code}: ${Buffer.concat(errs).toString().slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.end(input);
  });
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

  let raw: Buffer | null = null;

  if (contentType.startsWith("audio/")) {
    raw = Buffer.from(await res.arrayBuffer());
  } else if (contentType.includes("application/json")) {
    const data = (await res.json()) as ResembleResponse;
    if (data.audio_content) {
      raw = Buffer.from(data.audio_content, "base64");
    } else {
      const url = data.audio_url || data.url;
      if (url) {
        const a = await fetch(url, { signal });
        if (!a.ok) throw new Error(`Failed to download audio: ${a.status}`);
        raw = Buffer.from(await a.arrayBuffer());
      } else {
        throw new Error(
          `Resemble unexpected JSON: ${JSON.stringify(data).slice(0, 200)}`,
        );
      }
    }
  } else {
    raw = Buffer.from(await res.arrayBuffer());
  }

  if (!raw || raw.length === 0) {
    throw new Error("Resemble returned empty audio payload");
  }

  // Telegram requires OGG/Opus for native voice-note playback.
  try {
    const ogg = await toOggOpus(raw);
    return { audio: ogg, contentType: "audio/ogg" };
  } catch (err) {
    logger.error({ err }, "ffmpeg conversion to OGG/Opus failed");
    throw new Error("Failed to convert audio to OGG/Opus for Telegram voice note");
  }
}
