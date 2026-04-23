# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- `artifacts/api-server` — Express API + Telegram bot (`/api/telegram/*`, `/api/healthz`). Auto-registers webhook on boot via `REPLIT_DOMAINS`.
- `artifacts/bot-landing` — public landing page at `/` for the 4kpnote Telegram bot.
- `artifacts/mockup-sandbox` — design preview server (unused for production).

## 4kpnote Telegram Bot

Source: `artifacts/api-server/src/telegram/`. Trigger word `4kpnote`. Pipeline: Replit AI Gemini proxy rewrites text for natural speech → Resemble synthesizes audio → reply as Telegram voice note. Voices are pulled live from the user's full Resemble account (`/voices` shows a paginated picker). Per-user voice UUID + name stored in `userPreferencesTable` (lib/db). Required secrets: `BOT_TOKEN`, `RESEMBLE_API_KEY`, `RESEMBLE_VOICE_DEFAULT`, `SESSION_SECRET`. Auto-provisioned via Replit AI integrations: `AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY`. Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`), `RESEMBLE_PROJECT_UUID`.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
