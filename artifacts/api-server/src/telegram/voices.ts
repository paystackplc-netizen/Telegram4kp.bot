export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  emoji: string;
  style: string;
  resembleVoiceEnvKey: string;
}

export const VOICE_PRESETS: Record<string, VoicePreset> = {
  default: {
    id: "default",
    name: "Default",
    description: "Natural, clear, conversational",
    emoji: "🔊",
    style: "natural conversational tone, clear and balanced pacing",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_DEFAULT",
  },
  male: {
    id: "male",
    name: "Male",
    description: "Warm, confident, articulate",
    emoji: "👨",
    style: "warm confident male voice, articulate and grounded",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_MALE",
  },
  female: {
    id: "female",
    name: "Female",
    description: "Clear, warm, expressive",
    emoji: "👩",
    style: "clear expressive female voice, warm and engaging",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_FEMALE",
  },
  deep: {
    id: "deep",
    name: "Deep",
    description: "Deep, resonant, authoritative",
    emoji: "🎙️",
    style: "deep resonant authoritative voice, slow and deliberate",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_DEEP",
  },
  calm: {
    id: "calm",
    name: "Calm",
    description: "Soft, calming, soothing",
    emoji: "😌",
    style: "soft calming soothing voice, gentle pacing with longer pauses",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_CALM",
  },
  energetic: {
    id: "energetic",
    name: "Energetic",
    description: "Energetic, enthusiastic",
    emoji: "⚡",
    style: "energetic enthusiastic voice, upbeat with strong dynamics",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_ENERGETIC",
  },
  whisper: {
    id: "whisper",
    name: "Whisper",
    description: "Soft whisper, intimate",
    emoji: "🤫",
    style: "soft whisper, intimate and breathy",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_WHISPER",
  },
  professional: {
    id: "professional",
    name: "Professional",
    description: "Professional, polished",
    emoji: "💼",
    style: "professional polished voice, broadcast quality",
    resembleVoiceEnvKey: "RESEMBLE_VOICE_PROFESSIONAL",
  },
};

export function getPreset(id: string | null | undefined): VoicePreset {
  if (!id) return VOICE_PRESETS["default"]!;
  return VOICE_PRESETS[id] ?? VOICE_PRESETS["default"]!;
}

export function resolveResembleVoiceId(preset: VoicePreset): string {
  const specific = process.env[preset.resembleVoiceEnvKey];
  const fallback = process.env["RESEMBLE_VOICE_DEFAULT"];
  return (specific || fallback || "").trim();
}
