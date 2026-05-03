import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "../lib/logger";

function tempPath(ext: string): string {
  const id = crypto.randomBytes(8).toString("hex");
  return path.join(os.tmpdir(), `4kpnote-media-${Date.now()}-${id}.${ext}`);
}

async function safeUnlink(p: string): Promise<void> {
  try { await fs.unlink(p); } catch { /* ignore */ }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug({ cmd: `ffmpeg ${args.join(" ")}` }, "[MEDIA] running ffmpeg");
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const errs: Buffer[] = [];
    ff.stderr.on("data", (c: Buffer) => errs.push(c));
    ff.on("error", (e) => reject(new Error(`Failed to spawn ffmpeg: ${e.message}`)));
    ff.on("close", (code) => {
      const stderr = Buffer.concat(errs).toString();
      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(0, 1000) }, "[MEDIA] ffmpeg failed");
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300) || "(no stderr)"}`));
        return;
      }
      if (stderr.trim()) logger.debug({ stderr: stderr.slice(0, 400) }, "[MEDIA] ffmpeg stderr");
      resolve();
    });
  });
}

async function verifyFile(p: string, label: string): Promise<void> {
  if (!existsSync(p)) throw new Error(`${label} file missing: ${p}`);
  const s = await fs.stat(p);
  if (s.size === 0) throw new Error(`${label} file is empty: ${p}`);
}

/**
 * Convert any audio buffer to OGG/Opus for Telegram sendVoice.
 */
export async function convertToVoiceNote(input: Buffer, inputExt = "bin"): Promise<Buffer> {
  const inputPath = tempPath(inputExt);
  const outputPath = tempPath("ogg");
  try {
    await fs.writeFile(inputPath, input);
    await verifyFile(inputPath, "audio input");

    logger.info({ inputPath, outputPath }, "[MEDIA] converting to OGG/Opus voice note");
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-application", "voip",
      "-f", "ogg",
      outputPath,
    ]);

    await verifyFile(outputPath, "OGG output");
    const buf = await fs.readFile(outputPath);
    logger.info({ bytes: buf.length }, "[MEDIA] voice note ready");
    return buf;
  } finally {
    await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
  }
}

/**
 * Convert any video buffer to a square 240×240 MP4 for Telegram sendVideoNote.
 * Returns { buffer, duration } where duration is in seconds (capped at 60s).
 */
export async function convertToVideoNote(
  input: Buffer,
  inputExt = "bin",
): Promise<{ buffer: Buffer; duration: number }> {
  const inputPath = tempPath(inputExt);
  const outputPath = tempPath("mp4");
  try {
    await fs.writeFile(inputPath, input);
    await verifyFile(inputPath, "video input");

    // Probe duration first
    const duration = await probeDuration(inputPath);
    const cappedDuration = Math.min(duration, 60);

    logger.info({ inputPath, outputPath, duration, cappedDuration }, "[MEDIA] converting to video note");

    // Crop to square, scale to 240×240, cap at 60s, AAC audio
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-t", String(cappedDuration),
      // Crop to largest centered square then scale to 240×240
      "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=240:240",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "28",
      "-c:a", "aac",
      "-b:a", "64k",
      "-movflags", "+faststart",
      "-pix_fmt", "yuv420p",
      outputPath,
    ]);

    await verifyFile(outputPath, "MP4 output");
    const buf = await fs.readFile(outputPath);
    logger.info({ bytes: buf.length, duration: cappedDuration }, "[MEDIA] video note ready");
    return { buffer: buf, duration: Math.round(cappedDuration) };
  } finally {
    await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
  }
}

async function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => out.push(c));
    ff.on("close", () => {
      const val = parseFloat(Buffer.concat(out).toString().trim());
      resolve(isNaN(val) ? 60 : val);
    });
    ff.on("error", () => resolve(60));
  });
}
