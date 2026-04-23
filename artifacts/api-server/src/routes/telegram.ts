import { Router, type IRouter, type Request, type Response } from "express";
import { handleUpdate, type TgUpdate } from "../telegram/handler";
import {
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  setMyCommands,
} from "../telegram/telegramApi";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getWebhookSecret(): string {
  const raw = process.env["WEBHOOK_SECRET"] || process.env["SESSION_SECRET"];
  if (!raw) {
    throw new Error(
      "WEBHOOK_SECRET (or SESSION_SECRET) must be set for webhook validation",
    );
  }
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256);
  if (cleaned.length < 16) {
    throw new Error(
      "Webhook secret too short after sanitization (need 16+ allowed chars)",
    );
  }
  return cleaned;
}

function publicBaseUrl(): string | null {
  const explicit = process.env["PUBLIC_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) return `https://${dev}`;
  return null;
}

router.post("/telegram/webhook", (req: Request, res: Response) => {
  // Always 200 fast — Telegram retries on non-2xx and floods.
  res.status(200).send("OK");

  const headerSecret = req.header("x-telegram-bot-api-secret-token");
  let expected: string;
  try {
    expected = getWebhookSecret();
  } catch (err) {
    logger.error({ err }, "Missing webhook secret");
    return;
  }
  if (headerSecret !== expected) {
    logger.warn("Rejected webhook with invalid secret");
    return;
  }

  const update = req.body as TgUpdate;
  if (!update || typeof update !== "object") return;

  const log = (req as Request & { log?: typeof logger }).log ?? logger;
  // Process async; do not block response.
  Promise.resolve()
    .then(() => handleUpdate(update, log))
    .catch((err) => log.error({ err }, "handleUpdate failed"));
});

router.get("/telegram/setup", async (_req, res) => {
  try {
    const base = publicBaseUrl();
    if (!base) {
      res.status(500).json({
        ok: false,
        error:
          "Could not determine public URL. Set PUBLIC_URL or deploy on Replit.",
      });
      return;
    }
    const url = `${base}/api/telegram/webhook`;
    const secret = getWebhookSecret();
    await setWebhook(url, secret);
    await setMyCommands();
    const info = await getWebhookInfo();
    res.json({ ok: true, url, info });
  } catch (err) {
    logger.error({ err }, "/telegram/setup failed");
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/telegram/webhook-info", async (_req, res) => {
  try {
    const info = await getWebhookInfo();
    res.json({ ok: true, info });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

router.post("/telegram/teardown", async (_req, res) => {
  try {
    await deleteWebhook();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
