import type { Logger } from "pino";
import { logger as defaultLogger } from "../lib/logger";
import {
  sendMessage,
  sendVoice,
  sendVideoNote,
  sendChatAction,
  answerCallbackQuery,
  editMessageText,
  getFile,
  downloadTelegramFile,
  type InlineButton,
} from "./telegramApi";
import {
  getVoicesPage,
  findVoiceByUuid,
  findVoiceByQuery,
  getDefaultVoice,
  type ResembleVoice,
} from "./resembleVoices";
import { getUserVoice, setUserVoice } from "./preferences";
import { speechAgent } from "./speechAgent";
import { synthesize } from "./tts";
import { convertToVoiceNote, convertToVideoNote } from "./mediaConverter";

const TRIGGER = "4kpnote";
const MAX_TEXT_LEN = 1500;
const MIN_TEXT_LEN = 1;

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  type: string;
}
interface TgFileRef {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  duration?: number;
  width?: number;
  height?: number;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
  // Media attachments
  audio?: TgFileRef;
  voice?: TgFileRef;
  video?: TgFileRef;
  video_note?: TgFileRef;
  document?: TgFileRef;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
}

function voiceLabel(v: ResembleVoice): string {
  const tag = v.gender === "male" ? "👨" : v.gender === "female" ? "👩" : "🎙️";
  return `${tag} ${v.name}`;
}

async function buildVoicesKeyboard(
  page: number,
  currentUuid: string | null,
): Promise<{
  keyboard: { inline_keyboard: InlineButton[][] };
  caption: string;
}> {
  const { items, page: safePage, numPages } = await getVoicesPage(page);
  const rows: InlineButton[][] = [];
  for (const v of items) {
    const marker = currentUuid && v.uuid === currentUuid ? "✓ " : "";
    rows.push([
      { text: `${marker}${voiceLabel(v)}`, callback_data: `v:${v.uuid}` },
    ]);
  }
  const nav: InlineButton[] = [];
  if (safePage > 1) nav.push({ text: "‹ Prev", callback_data: `vp:${safePage - 1}` });
  nav.push({ text: `${safePage}/${numPages}`, callback_data: "noop" });
  if (safePage < numPages) nav.push({ text: "Next ›", callback_data: `vp:${safePage + 1}` });
  if (nav.length) rows.push(nav);
  return {
    keyboard: { inline_keyboard: rows },
    caption: items.length
      ? "Tap a voice to make it your default."
      : "No voices found in your Resemble account.",
  };
}

function welcomeText(): string {
  return [
    "🎙️ 4kpnote Voice Bot",
    "",
    "Send any text starting with the trigger and I'll reply with a natural AI voice note.",
    "",
    "Quick start:",
    `  ${TRIGGER} Hello world, this is my first voice note`,
    `  ${TRIGGER}|<voice name>|Welcome to the meeting`,
    "",
    "Commands:",
    "  /voices — browse and pick a voice from your Resemble library",
    "  /help — full guide",
  ].join("\n");
}

function helpText(): string {
  return [
    "📖 4kpnote Voice Bot — Help",
    "",
    "Trigger:",
    `  ${TRIGGER} <your text>`,
    "",
    "With a one-off voice (name or UUID):",
    `  ${TRIGGER}|<voice>|<your text>`,
    "",
    "Examples:",
    `  ${TRIGGER} Quick reminder, the sync moves to 3pm`,
    `  ${TRIGGER}|Liam|In a world of infinite possibilities`,
    `  ${TRIGGER}|aabbccdd|Use the exact UUID for precision`,
    "",
    "Tips:",
    "  • Use [PAUSE 2] for an explicit pause",
    "  • Up to 1500 characters per message",
    "  • Use /voices to browse all voices in your Resemble account",
  ].join("\n");
}

function parseTrigger(raw: string): { voice: string | null; text: string } | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith(TRIGGER)) return null;
  const after = trimmed.slice(TRIGGER.length).trimStart();
  if (after.startsWith("|")) {
    const rest = after.slice(1);
    const sep = rest.indexOf("|");
    if (sep > 0) {
      const voice = rest.slice(0, sep).trim();
      const text = rest.slice(sep + 1).trim();
      return { voice, text };
    }
    return { voice: null, text: rest.trim() };
  }
  return { voice: null, text: after };
}

async function resolveVoiceForUser(
  userId: number,
  oneOff: string | null,
): Promise<{ uuid: string; name: string } | null> {
  if (oneOff) {
    const found = await findVoiceByQuery(oneOff);
    if (found) return { uuid: found.uuid, name: found.name };
    return null;
  }
  const saved = await getUserVoice(userId).catch(() => null);
  if (saved) return { uuid: saved.uuid, name: saved.name ?? "Voice" };
  return getDefaultVoice();
}

async function handleTrigger(
  msg: TgMessage,
  raw: string,
  log: Logger,
): Promise<void> {
  const parsed = parseTrigger(raw);
  if (!parsed) return;

  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? chatId;

  if (!parsed.text || parsed.text.length < MIN_TEXT_LEN) {
    await sendMessage(
      chatId,
      `Send some text after the trigger.\nExample: ${TRIGGER} hello world`,
      { reply_to_message_id: msg.message_id },
    );
    return;
  }
  if (parsed.text.length > MAX_TEXT_LEN) {
    await sendMessage(
      chatId,
      `Text is too long (${parsed.text.length} chars). Limit is ${MAX_TEXT_LEN}.`,
      { reply_to_message_id: msg.message_id },
    );
    return;
  }

  const voice = await resolveVoiceForUser(userId, parsed.voice);
  if (!voice) {
    if (parsed.voice) {
      await sendMessage(
        chatId,
        `Couldn't find a voice matching "${parsed.voice}". Use /voices to browse your library.`,
        { reply_to_message_id: msg.message_id },
      );
    } else {
      await sendMessage(
        chatId,
        "No voice selected yet. Use /voices to pick one.",
        { reply_to_message_id: msg.message_id },
      );
    }
    return;
  }

  await sendChatAction(chatId, "record_voice");

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 60_000);
  try {
    log.info({ userId, voice: voice.name, len: parsed.text.length }, "[VOICE] processing request");

    log.info("[VOICE] step 1/4: rewriting text for natural speech");
    const processed = await speechAgent(parsed.text, ac.signal);

    log.info({ chars: processed.length }, "[VOICE] step 2/4: downloading + converting audio");
    await sendChatAction(chatId, "upload_voice");
    const { audio, contentType } = await synthesize(processed, voice.uuid, ac.signal);

    log.info({ bytes: audio.length, contentType }, "[VOICE] step 3/4: sending voice note to Telegram");
    await sendVoice(chatId, audio, {
      reply_to_message_id: msg.message_id,
      contentType,
      filename: `4kpnote-${voice.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ogg`,
    });
    log.info({ userId, voice: voice.name, bytes: audio.length }, "[VOICE] step 4/4: done ✓");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, message }, "[VOICE] request failed");
    const detail = message.length > 0 && message.length < 200 ? `\n\nDetails: ${message}` : "";
    await sendMessage(
      chatId,
      `⚠️ Could not generate the voice note. Please try again in a moment.${detail}`,
      { reply_to_message_id: msg.message_id },
    ).catch(() => {});
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCommand(
  msg: TgMessage,
  cmd: string,
  log: Logger,
): Promise<void> {
  const chatId = msg.chat.id;
  const base = cmd.split("@")[0]!.toLowerCase();
  switch (base) {
    case "/start":
      await sendMessage(chatId, welcomeText(), { reply_to_message_id: msg.message_id });
      return;
    case "/help":
      await sendMessage(chatId, helpText(), { reply_to_message_id: msg.message_id });
      return;
    case "/voices": {
      const userId = msg.from?.id ?? chatId;
      const saved = await getUserVoice(userId).catch(() => null);
      const currentUuid = saved?.uuid ?? null;
      try {
        const { keyboard, caption } = await buildVoicesKeyboard(1, currentUuid);
        const header = saved
          ? `Current voice: 🎙️ ${saved.name ?? "Voice"}\n${caption}`
          : `No default voice set yet.\n${caption}`;
        await sendMessage(chatId, header, {
          reply_to_message_id: msg.message_id,
          reply_markup: keyboard,
        });
      } catch (err) {
        log.error({ err }, "failed to load voices list");
        await sendMessage(
          chatId,
          "⚠️ Couldn't load voices from Resemble right now. Please try again shortly.",
          { reply_to_message_id: msg.message_id },
        );
      }
      return;
    }
    default:
      log.debug({ cmd: base }, "unknown command");
  }
}

async function handleCallback(
  cb: TgCallbackQuery,
  log: Logger,
): Promise<void> {
  if (!cb.data || !cb.message) {
    await answerCallbackQuery(cb.id);
    return;
  }
  if (cb.data === "noop") {
    await answerCallbackQuery(cb.id);
    return;
  }
  if (cb.data.startsWith("vp:")) {
    const page = parseInt(cb.data.slice(3), 10) || 1;
    const saved = await getUserVoice(cb.from.id).catch(() => null);
    try {
      const { keyboard, caption } = await buildVoicesKeyboard(page, saved?.uuid ?? null);
      const header = saved
        ? `Current voice: 🎙️ ${saved.name ?? "Voice"}\n${caption}`
        : `No default voice set yet.\n${caption}`;
      await editMessageText(
        cb.message.chat.id,
        cb.message.message_id,
        header,
        { reply_markup: keyboard },
      ).catch(() => {});
      await answerCallbackQuery(cb.id);
    } catch (err) {
      log.error({ err }, "failed to paginate voices");
      await answerCallbackQuery(cb.id, "Couldn't load page");
    }
    return;
  }
  if (cb.data.startsWith("v:")) {
    const uuid = cb.data.slice(2);
    const voice = await findVoiceByUuid(uuid);
    if (!voice) {
      await answerCallbackQuery(cb.id, "Voice not found");
      return;
    }
    try {
      await setUserVoice(cb.from.id, voice.uuid, voice.name);
    } catch (err) {
      log.error({ err }, "failed to save voice preference");
      await answerCallbackQuery(cb.id, "Could not save preference");
      return;
    }
    await answerCallbackQuery(cb.id, `Default voice: ${voice.name}`);
    await editMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `Default voice set to 🎙️ ${voice.name}.\nNow send: ${TRIGGER} <your text>`,
    ).catch(() => {});
    return;
  }
  await answerCallbackQuery(cb.id);
}

// ─── Media-drop handler ──────────────────────────────────────────────────────

const AUDIO_EXTS = new Set(["mp3","m4a","aac","ogg","oga","opus","wav","flac","wma","aiff","aif","3gp","3gpp","amr","weba"]);
const VIDEO_EXTS = new Set(["mp4","mov","avi","mkv","webm","flv","wmv","m4v","3gp","3gpp","mpeg","mpg","ts","mts"]);

function fileKindFromDoc(ref: TgFileRef): "audio" | "video" | null {
  const mime = (ref.mime_type ?? "").toLowerCase();
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  // Fallback: check file extension from file_name
  const name = (ref.file_name ?? "").toLowerCase();
  const ext = name.split(".").pop() ?? "";
  if (ext && AUDIO_EXTS.has(ext)) return "audio";
  if (ext && VIDEO_EXTS.has(ext)) return "video";
  return null;
}

function extFromRef(ref: TgFileRef): string {
  const name = (ref.file_name ?? "").toLowerCase();
  const extFromName = name.split(".").pop() ?? "";
  if (extFromName) return extFromName;
  const mime = (ref.mime_type ?? "").toLowerCase();
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("aac")) return "aac";
  if (mime.includes("3gpp")) return "3gp";
  if (mime.startsWith("audio/")) return "mp3";
  if (mime.startsWith("video/")) return "mp4";
  return "bin";
}

async function handleMediaDrop(
  msg: TgMessage,
  log: Logger,
): Promise<boolean> {
  const chatId = msg.chat.id;
  const replyOpts = { reply_to_message_id: msg.message_id };

  // Native Telegram media types (voice, audio, video, video_note)
  const audioRef = msg.voice ?? msg.audio;
  const videoRef = msg.video ?? msg.video_note;

  // Documents — detect kind from mime_type AND file extension
  let docAudioRef: TgFileRef | undefined;
  let docVideoRef: TgFileRef | undefined;
  if (msg.document) {
    const kind = fileKindFromDoc(msg.document);
    if (kind === "audio") docAudioRef = msg.document;
    else if (kind === "video") docVideoRef = msg.document;
  }

  const effectiveAudio = audioRef ?? docAudioRef;
  const effectiveVideo = videoRef ?? docVideoRef;

  if (!effectiveAudio && !effectiveVideo) return false; // nothing to handle

  const isVideo = !!effectiveVideo;
  const fileRef = (effectiveVideo ?? effectiveAudio)!;
  const mime = fileRef.mime_type ?? "";
  const ext = extFromRef(fileRef);
  const sizeMB = ((fileRef.file_size ?? 0) / 1024 / 1024).toFixed(1);

  log.info(
    { fileId: fileRef.file_id, mime, ext, sizeMB, isVideo },
    "[MEDIA] media drop received",
  );

  try {
    await sendChatAction(chatId, isVideo ? "upload_video" : "upload_voice");

    log.info("[MEDIA] step 1/3: downloading file from Telegram");
    const filePath = await getFile(fileRef.file_id);
    const raw = await downloadTelegramFile(filePath);
    log.info({ bytes: raw.length }, "[MEDIA] step 2/3: converting");

    if (isVideo) {
      await sendChatAction(chatId, "upload_video");
      const { buffer, duration } = await convertToVideoNote(raw, ext);
      log.info({ bytes: buffer.length, duration }, "[MEDIA] step 3/3: sending video note");
      await sendVideoNote(chatId, buffer, { ...replyOpts, duration, length: 240 });
    } else {
      await sendChatAction(chatId, "upload_voice");
      const buffer = await convertToVoiceNote(raw, ext);
      log.info({ bytes: buffer.length }, "[MEDIA] step 3/3: sending voice note");
      await sendVoice(chatId, buffer, { ...replyOpts, contentType: "audio/ogg", filename: "voice.ogg" });
    }

    log.info("[MEDIA] done ✓");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, message }, "[MEDIA] conversion failed");
    const detail = message.length > 0 && message.length < 200 ? `\n\nDetails: ${message}` : "";
    await sendMessage(
      chatId,
      `⚠️ Could not convert the ${isVideo ? "video" : "audio"} file. Please try again.${detail}`,
      replyOpts,
    ).catch(() => {});
  }

  return true;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function handleUpdate(
  update: TgUpdate,
  log: Logger = defaultLogger,
): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query, log);
    return;
  }
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  if (!msg) return;

  // Media-drop takes priority over text parsing
  if (await handleMediaDrop(msg, log)) return;

  const text = msg.text ?? msg.caption ?? "";
  if (!text) return;

  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    const firstSpace = trimmed.indexOf(" ");
    const cmd = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    await handleCommand(msg, cmd, log);
    return;
  }
  if (trimmed.toLowerCase().startsWith(TRIGGER)) {
    await handleTrigger(msg, trimmed, log);
  }
}
