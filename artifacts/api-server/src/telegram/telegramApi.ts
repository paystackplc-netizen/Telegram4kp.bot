import { logger } from "../lib/logger";

const API_BASE = "https://api.telegram.org";

function token(): string {
  const raw = process.env["BOT_TOKEN"];
  if (!raw) throw new Error("BOT_TOKEN not configured");
  const trimmed = raw.trim();
  // Telegram tokens are <bot_id>:<35+ char alphanumeric/_-> — extract from any wrapping text
  const match = trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  if (!match) {
    throw new Error(
      "BOT_TOKEN does not contain a valid Telegram bot token (expected <id>:<key>)",
    );
  }
  return match[1]!;
}

async function call<T = unknown>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    logger.error({ method, description: data.description }, "Telegram API error");
    throw new Error(`Telegram ${method} failed: ${data.description}`);
  }
  return data.result as T;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  opts: {
    reply_to_message_id?: number;
    reply_markup?: { inline_keyboard: InlineButton[][] };
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
    disable_web_page_preview?: boolean;
  } = {},
): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text, ...opts });
}

export async function answerCallbackQuery(
  id: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: id, text });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  opts: { reply_markup?: { inline_keyboard: InlineButton[][] } } = {},
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...opts,
  });
}

export async function sendChatAction(
  chatId: number | string,
  action: "record_voice" | "upload_voice" | "upload_video" | "typing",
): Promise<void> {
  try {
    await call("sendChatAction", { chat_id: chatId, action });
  } catch {
    // non-critical
  }
}

export async function sendVoice(
  chatId: number | string,
  audio: Buffer,
  opts: {
    reply_to_message_id?: number;
    caption?: string;
    filename?: string;
    contentType?: string;
  } = {},
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (opts.reply_to_message_id != null) {
    form.append("reply_to_message_id", String(opts.reply_to_message_id));
  }
  if (opts.caption) form.append("caption", opts.caption);

  const ct = opts.contentType || "audio/ogg";
  const filename = opts.filename || "voice.ogg";
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.append("voice", new Blob([ab], { type: ct }), filename);

  const res = await fetch(`${API_BASE}/bot${token()}/sendVoice`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    logger.error({ description: data.description }, "sendVoice failed");
    throw new Error(`sendVoice failed: ${data.description}`);
  }
}

export async function sendAudio(
  chatId: number | string,
  audio: Buffer,
  opts: {
    reply_to_message_id?: number;
    caption?: string;
    filename?: string;
    contentType?: string;
  } = {},
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (opts.reply_to_message_id != null) {
    form.append("reply_to_message_id", String(opts.reply_to_message_id));
  }
  if (opts.caption) form.append("caption", opts.caption);

  const ct = opts.contentType || "audio/mpeg";
  const filename = opts.filename || "audio.mp3";
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.append("audio", new Blob([ab], { type: ct }), filename);

  const res = await fetch(`${API_BASE}/bot${token()}/sendAudio`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    logger.error({ description: data.description }, "sendAudio failed");
    throw new Error(`sendAudio failed: ${data.description}`);
  }
}

export async function sendVideoNote(
  chatId: number | string,
  video: Buffer,
  opts: {
    reply_to_message_id?: number;
    duration?: number;
    length?: number;
  } = {},
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (opts.reply_to_message_id != null) {
    form.append("reply_to_message_id", String(opts.reply_to_message_id));
  }
  if (opts.duration != null) form.append("duration", String(opts.duration));
  form.append("length", String(opts.length ?? 240));
  const ab = video.buffer.slice(video.byteOffset, video.byteOffset + video.byteLength) as ArrayBuffer;
  form.append("video_note", new Blob([ab], { type: "video/mp4" }), "video_note.mp4");
  const res = await fetch(`${API_BASE}/bot${token()}/sendVideoNote`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    logger.error({ description: data.description }, "sendVideoNote failed");
    throw new Error(`sendVideoNote failed: ${data.description}`);
  }
}

export async function getFile(fileId: string): Promise<string> {
  const data = await call<{ file_path: string }>("getFile", { file_id: fileId });
  return data.file_path;
}

export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const tok = token();
  const res = await fetch(`${API_BASE}/file/bot${tok}/${filePath}`);
  if (!res.ok) throw new Error(`Failed to download Telegram file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

export async function setWebhook(
  url: string,
  secretToken: string,
): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "edited_message", "channel_post", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function deleteWebhook(): Promise<void> {
  await call("deleteWebhook", { drop_pending_updates: false });
}

export async function getWebhookInfo(): Promise<WebhookInfo> {
  return call<WebhookInfo>("getWebhookInfo", {});
}

export async function setMyCommands(): Promise<void> {
  await call("setMyCommands", {
    commands: [
      { command: "start", description: "Welcome and quick guide" },
      { command: "voices", description: "Choose your default voice" },
      { command: "help", description: "Detailed help and examples" },
    ],
  });
}
