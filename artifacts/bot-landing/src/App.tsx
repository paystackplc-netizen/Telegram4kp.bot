import { useEffect, useState } from "react";

const BOT_USERNAME = "makanakibot4kpbot";
const BOT_URL = `https://t.me/${BOT_USERNAME}`;

const VOICES: Array<{ id: string; emoji: string; name: string; desc: string }> = [
  { id: "default", emoji: "🔊", name: "Default", desc: "Natural, clear, conversational" },
  { id: "male", emoji: "👨", name: "Male", desc: "Warm, confident, articulate" },
  { id: "female", emoji: "👩", name: "Female", desc: "Clear, warm, expressive" },
  { id: "deep", emoji: "🎙️", name: "Deep", desc: "Deep, resonant, authoritative" },
  { id: "calm", emoji: "😌", name: "Calm", desc: "Soft, calming, soothing" },
  { id: "energetic", emoji: "⚡", name: "Energetic", desc: "Energetic, enthusiastic" },
  { id: "whisper", emoji: "🤫", name: "Whisper", desc: "Soft whisper, intimate" },
  { id: "professional", emoji: "💼", name: "Professional", desc: "Polished, broadcast quality" },
];

function StatusDot() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}api/healthz`)
      .then((r) => r.ok)
      .then((v) => !cancelled && setOk(v))
      .catch(() => !cancelled && setOk(false));
    return () => {
      cancelled = true;
    };
  }, []);
  const color = ok === null ? "#888" : ok ? "#10b981" : "#ef4444";
  const label = ok === null ? "checking…" : ok ? "online" : "offline";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "#9ca3af" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, boxShadow: `0 0 12px ${color}` }} />
      bot {label}
    </span>
  );
}

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        background: "#0b0d12",
        border: "1px solid #1f2330",
        borderRadius: 12,
        padding: "14px 16px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 14,
        color: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        overflow: "hidden",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        style={{
          background: "transparent",
          border: "1px solid #2a2f3d",
          color: "#9ca3af",
          padding: "4px 10px",
          borderRadius: 8,
          fontSize: 12,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, #1a1530 0%, #07080d 55%)",
        color: "#e5e7eb",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "48px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#9ca3af" }}>
            <span style={{ fontSize: 22 }}>🎙️</span>
            <span style={{ fontWeight: 600, color: "#e5e7eb" }}>4kpnote</span>
          </div>
          <StatusDot />
        </header>

        <section style={{ marginBottom: 56 }}>
          <h1
            style={{
              fontSize: "clamp(36px, 6vw, 56px)",
              lineHeight: 1.05,
              fontWeight: 800,
              margin: "0 0 18px",
              letterSpacing: "-0.02em",
              background: "linear-gradient(180deg, #fff 0%, #a78bfa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Turn text into natural voice notes.
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#9ca3af", margin: "0 0 28px", maxWidth: 580 }}>
            A Telegram bot that rewrites your text for natural speech, adds pauses and emotion, and replies with an AI-generated voice note.
          </p>
          <a
            href={BOT_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
              color: "white",
              padding: "14px 22px",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 16,
              boxShadow: "0 12px 40px -10px rgba(139, 92, 246, 0.6)",
            }}
          >
            Open in Telegram →
          </a>
        </section>

        <section style={{ marginBottom: 56 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", margin: "0 0 14px" }}>
            How to use
          </h2>
          <div style={{ display: "grid", gap: 10 }}>
            <Code>{"4kpnote Hello world, this is my first voice note"}</Code>
            <Code>{"4kpnote|deep|In a world of infinite possibilities"}</Code>
            <Code>{"4kpnote|whisper|I have a secret to tell you"}</Code>
          </div>
          <p style={{ fontSize: 14, color: "#6b7280", margin: "14px 0 0" }}>
            Format: <code style={{ color: "#a78bfa" }}>4kpnote|voice|text</code> — voice is optional. Use <code style={{ color: "#a78bfa" }}>/voices</code> to set a default.
          </p>
        </section>

        <section style={{ marginBottom: 56 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", margin: "0 0 14px" }}>
            Voice presets
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {VOICES.map((v) => (
              <div
                key={v.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 20 }}>{v.emoji}</span>
                  <span style={{ fontWeight: 600, color: "#e5e7eb" }}>{v.name}</span>
                  <code style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>{v.id}</code>
                </div>
                <p style={{ fontSize: 13, color: "#9ca3af", margin: 0, lineHeight: 1.45 }}>{v.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 56 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", margin: "0 0 14px" }}>
            Commands
          </h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8, color: "#9ca3af", fontSize: 15 }}>
            <li>
              <code style={{ color: "#a78bfa" }}>/start</code> — welcome and quick guide
            </li>
            <li>
              <code style={{ color: "#a78bfa" }}>/voices</code> — pick your default voice
            </li>
            <li>
              <code style={{ color: "#a78bfa" }}>/help</code> — full instructions and examples
            </li>
          </ul>
        </section>

        <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24, fontSize: 13, color: "#6b7280" }}>
          Powered by Telegram Bot API · Gemini · Resemble AI · Up to 1500 characters per message.
        </footer>
      </div>
    </div>
  );
}
