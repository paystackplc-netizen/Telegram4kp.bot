import { logger } from "../lib/logger";
import { setWebhook, setMyCommands, getWebhookInfo } from "./telegramApi";

function publicBaseUrl(): string | null {
  const explicit = process.env["PUBLIC_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return null;
}

function sanitizeSecret(s: string): string {
  // Telegram allows only A-Z, a-z, 0-9, _ and - in webhook secrets, max 256 chars
  return s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256);
}

function getWebhookSecret(): string | null {
  const raw = process.env["WEBHOOK_SECRET"] || process.env["SESSION_SECRET"];
  if (!raw) return null;
  const cleaned = sanitizeSecret(raw);
  return cleaned.length >= 16 ? cleaned : null;
}

export async function autoRegisterWebhook(): Promise<void> {
  if (!process.env["BOT_TOKEN"]) {
    logger.warn("BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  if (process.env["TELEGRAM_AUTO_WEBHOOK"] === "0") {
    logger.info("TELEGRAM_AUTO_WEBHOOK=0, skipping webhook registration");
    return;
  }

  const base = publicBaseUrl();
  if (!base) {
    logger.warn(
      "No PUBLIC_URL or REPLIT_DOMAINS — skipping webhook auto-registration",
    );
    return;
  }
  const secret = getWebhookSecret();
  if (!secret) {
    logger.warn("No WEBHOOK_SECRET/SESSION_SECRET — skipping webhook registration");
    return;
  }
  const url = `${base}/api/telegram/webhook`;
  try {
    const existing = await getWebhookInfo();
    if (existing.url === url) {
      logger.info({ url }, "Telegram webhook already registered");
    } else {
      await setWebhook(url, secret);
      logger.info({ url }, "Telegram webhook registered");
    }
    await setMyCommands();
  } catch (err) {
    logger.error({ err }, "Failed to register Telegram webhook");
  }
}
