# 🎙️ 4kpnote Cloud Voice Bot

Production-ready Telegram Voice Bot running on Cloudflare Workers. Transform text into natural AI-powered voice messages with emotion tags, pauses, and multiple voice presets.

## Features

- 🤖 **AI Speech Agent** - Gemini-powered text optimization for natural speech
- 🎙️ **8 Voice Presets** - Default, Male, Female, Deep, Calm, Energetic, Whisper, Professional
- ⚡ **Serverless** - Runs on Cloudflare Workers (no server management)
- 🔒 **Secure** - Webhook secret validation, API keys in Cloudflare Secrets
- 💾 **Smart Caching** - KV-based voice caching for instant responses
- 📊 **Built-in Logging** - Structured logs with Cloudflare Observability
- 🎯 **Easy Commands** - Simple `4kpnote` trigger with voice selection

## Architecture

```
User Message → Telegram → Cloudflare Worker → AI Speech Agent (Gemini) → Resemble AI TTS → Voice Note → User
```

## Quick Deploy Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account (free tier works)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Step 1: Install Wrangler

```bash
npm install -g wrangler
```

### Step 2: Authenticate with Cloudflare

```bash
wrangler login
```

### Step 3: Create KV Namespace

```bash
wrangler kv:namespace create "BOT_KV"
```

Copy the ID from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BOT_KV"
id = "paste_your_kv_id_here"
```

### Step 4: Set Secrets

```bash
# Telegram Bot Token
wrangler secret put BOT_TOKEN
# Enter: 8590699653:AAHjRJYNYi04jGlD94pyF_h98PmPsZVtITM

# Gemini API Key
wrangler secret put GEMINI_API_KEY
# Enter: AIzaSyB3OjqKfRhDLATYPrHSCde08Q7baHTQQcA

# Resemble AI API Key
wrangler secret put RESEMBLE_API_KEY
# Enter: AliTQUorXrCfkHKrStipSgtt

# Webhook Secret (optional but recommended)
wrangler secret put WEBHOOK_SECRET
# Enter: your_random_secret_string
```

### Step 5: Deploy

```bash
npm install
npm run deploy
```

### Step 6: Setup Webhook

After deployment, visit your worker URL:

```
https://4kpnote-voice-bot.your-subdomain.workers.dev/setup
```

Or use the CLI:

```bash
wrangler curl /setup
```

The `/setup` endpoint will automatically configure the Telegram webhook.

### Verify Webhook

```bash
curl "https://api.telegram.org/bot8590699653:AAHjRJYNYi04jGlD94pyF_h98PmPsZVtITM/getWebhookInfo"
```

## Usage

### Basic Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and quick guide |
| `/voices` | Open voice selection menu |
| `/help` | Detailed help and examples |

### Voice Trigger

```
4kpnote Your text here
```

### With Voice Selection

```
4kpnote|male|Hello everyone, welcome to the meeting
4kpnote|female|Let me explain how this works
4kpnote|deep|In a world of infinite possibilities
4kpnote|calm|Take a deep breath and relax completely
4kpnote|energetic|This is amazing news everyone!
4kpnote|whisper|I have a secret to tell you
4kpnote|professional|Welcome to the quarterly review
```

### Using Voice Menu

1. Send `/voices` to open the voice selection menu
2. Tap your preferred voice
3. That voice becomes your default
4. Now just send `4kpnote your text` without specifying voice

## Voice Presets

| Voice | Emoji | Style |
|-------|-------|-------|
| Default | 🔊 | Natural, clear, conversational |
| Male | 👨 | Warm, confident, articulate |
| Female | 👩 | Clear, warm, expressive |
| Deep | 🎙️ | Deep, resonant, authoritative |
| Calm | 😌 | Soft, calming, soothing |
| Energetic | ⚡ | Energetic, enthusiastic |
| Whisper | 🤫 | Soft whisper, intimate |
| Professional | 💼 | Professional, polished |

## Project Structure

```
4kpnote-voice-bot/
├── src/
│   └── index.js          # Main worker code (all modules)
├── wrangler.toml         # Cloudflare Worker config
├── package.json          # Project dependencies
└── README.md             # This file
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | Yes | Telegram Bot API token |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `RESEMBLE_API_KEY` | Yes | Resemble AI API key |
| `WEBHOOK_SECRET` | No | Webhook validation secret |
| `BOT_KV` | Yes | KV namespace binding |

## API Integration Details

### AI Speech Agent (Gemini)

The speech agent transforms written text into natural spoken language:

- **Rewrites** text for spoken clarity
- **Adds pauses** using `...` for breathing rhythm
- **Inserts emotion tags** like `(calm)`, `(excited)`, `(whisper)`
- **Converts numbers** to spoken form
- **Expands abbreviations** for TTS clarity
- **Removes markdown** and special formatting
- **Maintains original meaning**

### Resemble AI TTS

Voice generation endpoint:
```
POST https://f.cluster.resemble.ai/synthesize
Authorization: Token YOUR_API_KEY
Content-Type: application/json

{
  "body": "processed text with emotions and pauses",
  "voice": "voice_id"
}
```

## Error Handling

The bot includes comprehensive error handling:

- **AI Agent Failures** - Falls back to original text with basic formatting
- **Voice Generation Errors** - User-friendly error messages
- **Telegram API Errors** - Automatic retry suggestions
- **Rate Limiting** - Built-in cooldown between requests
- **Text Validation** - Length and content validation

## Monitoring

View real-time logs:

```bash
npm run logs
```

Or check the Cloudflare Dashboard > Workers & Pages > 4kpnote-voice-bot > Logs.

## Development

### Local Testing

```bash
npm run dev
```

This starts a local development server. Use a tool like [ngrok](https://ngrok.com/) to expose it for Telegram webhook testing.

### Staging Deployment

```bash
npm run deploy:staging
```

### Production Deployment

```bash
npm run deploy:production
```

## Customization

### Adding New Voices

Edit `VOICE_PRESETS` in `src/index.js`:

```javascript
mycustomvoice: {
  id: 'mycustomvoice',
  name: 'Custom Voice',
  description: 'My custom voice description',
  resemble_voice_id: 'your_resemble_voice_id',
  emoji: '🎵',
  style: 'description for AI agent'
}
```

### Adjusting AI Temperature

In `SpeechAgent.process()`, modify the `generationConfig`:

```javascript
generationConfig: {
  temperature: 0.7,  // Lower = more predictable, Higher = more creative
  maxOutputTokens: 2048,
  topP: 0.9
}
```

## License

MIT

## Support

For issues or questions, check the Cloudflare Workers documentation or Telegram Bot API documentation.