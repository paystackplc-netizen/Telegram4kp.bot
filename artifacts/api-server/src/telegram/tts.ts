import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
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

function tempPath(ext: string): string {
  const id = crypto.randomBytes(8).toString("hex");
  return path.join(os.tmpdir(), `4kpnote-${Date.now()}-${id}.${ext}`);
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    /* ignore */
  }
}

function detectExt(contentType: string, bytes: Buffer): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("flac")) return "flac";
  // Sniff magic bytes as fallback
  const head = bytes.subarray(0, 4).toString("ascii");
  if (head === "RIFF") return "wav";
  if (head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return "mp3";
  if (head === "OggS") return "ogg";
  if (head === "fLaC") return "flac";
  return "bin";
}

/**
 * Convert an audio file on disk to OGG/Opus (the format Telegram requires
 * for native voice-note playback). Returns the output path.
 */
async function convertToOggOpus(inputPath: string, outputPath: string): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error(`ffmpeg input file does not exist: ${inputPath}`);
  }
  const stat = await fs.stat(inputPath);
  if (stat.size === 0) {
    throw new Error(`ffmpeg input file is empty: ${inputPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-application", "voip",
      "-f", "ogg",
      outputPath,
    ];
    logger.debug({ cmd: `ffmpeg ${args.join(" ")}` }, "running ffmpeg");
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const errs: Buffer[] = [];
    ff.stderr.on("data", (c: Buffer) => errs.push(c));
    ff.on("error", (e) => {
      reject(new Error(`Failed to spawn ffmpeg: ${e.message}`));
    });
    ff.on("close", (code) => {
      const stderr = Buffer.concat(errs).toString();
      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(0, 1000) }, "ffmpeg failed");
        reject(
          new Error(
            `ffmpeg exited with code ${code}: ${stderr.slice(0, 300) || "(no stderr)"}`,
          ),
        );
        return;
      }
      if (stderr.trim()) {
        logger.debug({ stderr: stderr.slice(0, 500) }, "ffmpeg stderr (non-fatal)");
      }
      resolve();
    });
  });

  if (!existsSync(outputPath)) {
    throw new Error(`ffmpeg reported success but output file is missing: ${outputPath}`);
  }
  const out = await fs.stat(outputPath);
  if (out.size === 0) {
    throw new Error(`ffmpeg produced an empty output file: ${outputPath}`);
  }
}

async function fetchResembleAudio(
  text: string,
  voiceUuid: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; contentType: string }> {
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

  logger.info({ voiceUuid, len: text.length }, "[TTS] requesting Resemble synthesis");
  const res = await fetch(RESEMBLE_ENDPOINT, {
    method: "POST",
    headers: {
      "x-access-token": apiKey,
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
      "[TTS] Resemble error response",
    );
    throw new Error(`Resemble TTS failed: ${res.status} ${body.slice(0, 200)}`);
  }

  if (contentType.startsWith("audio/")) {
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType };
  }

  if (contentType.includes("application/json")) {
    const data = (await res.json()) as ResembleResponse;
    if (data.audio_content) {
      const bytes = Buffer.from(data.audio_content, "base64");
      return { bytes, contentType: data.audio_content_type || "audio/wav" };
    }
    const url = data.audio_url || data.url;
    if (url) {
      logger.info({ url }, "[TTS] downloading Resemble audio from URL");
      const a = await fetch(url, { signal });
      if (!a.ok) throw new Error(`Failed to download Resemble audio: ${a.status}`);
      const bytes = Buffer.from(await a.arrayBuffer());
      return {
        bytes,
        contentType: a.headers.get("content-type") || "audio/wav",
      };
    }
    throw new Error(
      `Resemble unexpected JSON: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  // Unknown content type — treat as raw audio
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType: contentType || "application/octet-stream" };
}

/**
 * Robust pipeline:
 *   1. Call Resemble (or follow any audio_url) and download the bytes
 *   2. Write them to a temp file (verify non-empty)
 *   3. Run ffmpeg file -> file producing OGG/Opus for Telegram voice notes
 *   4. Verify the output exists and is non-empty
 *   5. Read the OGG into a Buffer for the caller, then clean both temp files
 */
export async function synthesize(
  text: string,
  voiceUuid: string,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const { bytes, contentType } = await fetchResembleAudio(text, voiceUuid, signal);

  if (!bytes || bytes.length === 0) {
    throw new Error("Resemble returned empty audio payload");
  }
  logger.info(
    { bytes: bytes.length, contentType },
    "[TTS] downloaded source audio from Resemble",
  );

  const inExt = detectExt(contentType, bytes);
  const inputPath = tempPath(inExt);
  const outputPath = tempPath("ogg");

  try {
    await fs.writeFile(inputPath, bytes);
    if (!existsSync(inputPath)) {
      throw new Error(`Failed to persist Resemble audio at ${inputPath}`);
    }
    logger.info({ inputPath, ext: inExt }, "[TTS] wrote source audio to disk, converting");

    await convertToOggOpus(inputPath, outputPath);
    logger.info({ outputPath }, "[TTS] converted to OGG/Opus");

    const ogg = await fs.readFile(outputPath);
    if (ogg.length === 0) {
      throw new Error("OGG output read back empty");
    }
    return { audio: ogg, contentType: "audio/ogg" };
  } finally {
    await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
  }
}
