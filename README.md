# Agendaí Social Studio

Standalone Instagram content pipeline for [Agendaí](https://agendai.space), the online-scheduling product for salons, barbershops, spas and beauty studios. This app is intentionally separate from the main product repository (`agendatmstudio`) — it owns its own database, deploy, and lifecycle.

An AI generation routine reads the product knowledge in `docs/` and creates draft content pieces via API. The founder reviews and approves each piece (uploading the image generated from the piece's image prompt) in a web interface. A daily cron then publishes approved pieces automatically via the Instagram Graph API.

## Piece lifecycle

```
draft ──(owner approves + uploads image)──▶ approved ──(daily cron, Graph API)──▶ published
                                                                              └─▶ failed
```

- **draft** — created by the AI routine via `POST /api/pieces`. The caption is validated against `docs/promessas-proibidas.json` before it is stored.
- **approved** — a human (the founder) reviewed the copy and uploaded the image generated from the piece's `imagePrompt`. Nothing is published without this step.
- **published** / **failed** — set by the daily publish cron depending on whether the Instagram Graph API call succeeded.

See `docs/02-playbook-conteudo.md` for the full editorial contract (content pillars, anti-repetition rotation, forbidden claims, tone rules) that every generated piece must follow.

## Stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS
- Prisma + PostgreSQL
- pnpm

## Setup

```bash
pnpm install
cp .env.example .env   # fill in the values described below
pnpm db:up              # starts local Postgres via docker-compose (port 5433)
pnpm db:migrate          # applies Prisma migrations
pnpm dev
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Local/production Postgres connection string. Local dev uses port **5433** (5432 is used by the main `agendatmstudio` product's local DB). |
| `APP_PASSWORD` | Shared password gate for the approval web UI (single-owner tool, no multi-user auth yet). |
| `GENERATION_API_TOKEN` | Bearer token the AI generation routine sends when calling `POST /api/pieces`. |
| `CRON_SECRET` | Shared secret the daily publish cron must present to trigger a run. |
| `META_IG_USER_ID` | Instagram Business account ID used to publish approved pieces. |
| `META_IG_TOKEN` | Instagram Graph API access token. |
| `META_TOKEN_EXPIRES_AT` | Expiry timestamp for `META_IG_TOKEN`, used to warn before it lapses. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token — stores the approved piece image before publish. |

## Product knowledge (`docs/`)

- `docs/01-produto-referencia.md` — single source of truth for what the product does, for whom, and on which plan. Copied verbatim from `agendatmstudio/docs/instagram/01-produto-referencia.md`.
- `docs/02-playbook-conteudo.md` — the editorial contract the AI generation routine follows every round. Adapted from the main repo's playbook for the draft → approved → published lifecycle described above.
- `docs/promessas-proibidas.json` — machine-readable list of forbidden product claims, consumed by `scripts/claim-check.mjs`.

## Claim check

Validates a caption against `docs/promessas-proibidas.json`. Exits `1` and prints the violated terms if a banned promise is found, `0` otherwise.

```bash
pnpm claim-check --text "Lembrete automático 24h antes do seu horário"
# {"ok":false,"violations":[{"id":"lembrete-automatico", ...}]}

pnpm claim-check --text "Seus clientes marcam horário sozinhos, pelo link."
# {"ok":true,"violations":[]}
```

`checkText`/`loadRules` are also exported from `scripts/claim-check.mjs` so the piece-creation API route can reuse the same validation server-side.

## Status

This is the scaffold. The `Piece` Prisma model, the pieces API, the approval web UI, and the Instagram Graph API publish/insights crons are implemented in follow-up work.
