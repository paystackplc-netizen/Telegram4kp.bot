import type { Logger } from "pino";
import { logger as defaultLogger } from "../lib/logger";
import {
  sendMessage,
  sendVoice,
  sendChatAction,
  answerCallbackQuery,
  editMessageText,
  type InlineButton,
} from "./telegramApi";
import { VOICE_PRESETS, getPreset, resolveResembleVoiceId } from "./voices";
import { getUserVoice, setUserVoice } from "./preferences";
import { speechAgent } from "./speechAgent";
import { synthesize } from "./tts";

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
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
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

function voicesKeyboard(): { inline_keyboard: InlineButton[][] } {
  const ids = Object.keys(VOICE_PRESETS);
  const rows: InlineButton[][] = [];
  for (let i = 0; i < ids.length; i += 2) {
    const row: InlineButton[] = [];
    for (let j = 0; j < 2 && i + j < ids.length; j++) {
      const p = VOICE_PRESETS[ids[i + j]!]!;
      row.push({ text: `${p.emoji} ${p.name}`, callback_data: `voice:${p.id}` });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function welcomeText(): string {
  return [
    "🎙️ 4kpnote Voice Bot",
    "",
    "Send any text starting with the trigger and I'll reply with a natural AI voice note.",
    "",
    "Quick start:",
    `  ${TRIGGER} Hello world, this is my first voice note`,
    `  ${TRIGGER}|female|Welcome to the meeting`,
    "",
    "Commands:",
    "  /voices — pick your default voice",
    "  /help — full guide",
  ].join("\n");
}

function helpText(): string {
  const presets = Object.values(VOICE_PRESETS)
    .map((p) => `  ${p.emoji} ${p.id} — ${p.description}`)
    .join("\n");
  return [
    "📖 4kpnote Voice Bot — Help",
    "",
    "Trigger:",
    `  ${TRIGGER} <your text>`,
    "",
    "With a one-off voice:",
    `  ${TRIGGER}|<voice>|<your text>`,
    "",
    "Voices:",
    presets,
    "",
    "Examples:",
    `  ${TRIGGER} Quick reminder, the sync moves to 3pm`,
    `  ${TRIGGER}|deep|In a world of infinite possibilities`,
    `  ${TRIGGER}|whisper|I have a secret to tell you`,
    "",
    "Tips:",
    "  • Use [PAUSE 2] for an explicit pause",
    "  • Up to 1500 characters per message",
    "  • Use /voices to set your default voice",
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
      const voice = rest.slice(0, sep).trim().toLowerCase();
      const text = rest.slice(sep + 1).trim();
      return { voice, text };
    }
    return { voice: null, text: rest.trim() };
  }
  return { voice: null, text: after };
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

  let voiceId = parsed.voice;
  if (!voiceId) {
    voiceId = await getUserVoice(userId).catch(() => "default");
  }
  if (!VOICE_PRESETS[voiceId]) {
    await sendMessage(
      chatId,
      `Unknown voice "${voiceId}". Use /voices to see available options.`,
      { reply_to_message_id: msg.message_id },
    );
    return;
  }
  const preset = getPreset(voiceId);
  const resembleVoice = resolveResembleVoiceId(preset);
  if (!resembleVoice) {
    await sendMessage(
      chatId,
      "Voice engine isn't configured yet. Ask the bot owner to set RESEMBLE_VOICE_DEFAULT.",
      { reply_to_message_id: msg.message_id },
    );
    return;
  }

  await sendChatAction(chatId, "record_voice");

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 60_000);
  try {
    log.info({ userId, voice: preset.id, len: parsed.text.length }, "processing voice request");
    const processed = await speechAgent(parsed.text, preset, ac.signal);
    await sendChatAction(chatId, "upload_voice");
    const { audio, contentType } = await synthesize(processed, resembleVoice, ac.signal);
    await sendVoice(chatId, audio, {
      reply_to_message_id: msg.message_id,
      contentType,
      filename: `4kpnote-${preset.id}.ogg`,
    });
    log.info({ userId, voice: preset.id, bytes: audio.length }, "voice sent");
  } catch (err) {
    log.error({ err }, "voice request failed");
    await sendMessage(
      chatId,
      "⚠️ Could not generate the voice note. Please try again in a moment.",
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
      const current = msg.from
        ? await getUserVoice(msg.from.id).catch(() => "default")
        : "default";
      const preset = getPreset(current);
      await sendMessage(
        chatId,
        `Current voice: ${preset.emoji} ${preset.name}\nTap a voice to make it your default.`,
        { reply_to_message_id: msg.message_id, reply_markup: voicesKeyboard() },
      );
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
  if (cb.data.startsWith("voice:")) {
    const voiceId = cb.data.slice("voice:".length);
    if (!VOICE_PRESETS[voiceId]) {
      await answerCallbackQuery(cb.id, "Unknown voice");
      return;
    }
    try {
      await setUserVoice(cb.from.id, voiceId);
    } catch (err) {
      log.error({ err }, "failed to save voice preference");
      await answerCallbackQuery(cb.id, "Could not save preference");
      return;
    }
    const preset = getPreset(voiceId);
    await answerCallbackQuery(cb.id, `Default voice: ${preset.name}`);
    await editMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `Default voice set to ${preset.emoji} ${preset.name}.\nNow send: ${TRIGGER} <your text>`,
    ).catch(() => {});
    return;
  }
  await answerCallbackQuery(cb.id);
}

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
