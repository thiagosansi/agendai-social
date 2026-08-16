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

See `docs/02-playbook-conteudo.md` for the full editorial contract (content pillars, anti-repetition rotation, forbidden claims, tone rules) that every generated piece must follow, and `docs/rotina-geracao.md` for the operational guide to configure the weekly scheduled generation routine (prompt to paste, env vars, `/schedule` steps, guard-rails).

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

## Publicação e Análise

**Daily cron** — `GET /api/cron/daily` runs daily at `0 14 * * *` (UTC) = **11:00 America/Sao_Paulo** (see `vercel.json`):

1. **Always runs publish** — picks up every `Piece` with `status=approved`, `publishAt <= now` and `igMediaId IS NULL` (the idempotency guard — a piece carrying an `igMediaId` is never reprocessed; only a human reset back to `draft`/`approved` re-queues it). Processes pieces **sequentially** and never lets one failure abort the run — each piece is wrapped individually, so a bad caption, unsupported format, or Meta API error only marks that one piece `failed` (with an actionable `lastError`) and continues to the next.

   Format → Graph API container mapping (`lib/instagram.ts`):
   - `estatico` → single-image post
   - `stories` → Stories container
   - `carrossel` → **v1 simplification**: publishes as single-image, not true carousel. `Piece` stores one `imageUrl` today; `createCarouselContainer` is implemented but unused until schema grows `imageUrls[]`.
   - `reels` → always fails with `"vídeo ainda não suportado"` — no video upload support yet.

   Before calling Meta, re-runs claim-check on caption (violation fails the piece) and rejects local dev uploads (`imageUrl` starting with `/uploads/`, the fallback `POST /api/pieces/[id]/image` uses when `BLOB_READ_WRITE_TOKEN` is unset) — Meta's servers can't fetch a local URL, so pieces fail with actionable guidance to configure Vercel Blob.

2. **Runs insights on Monday only** (UTC weekday detection) — for every `published` Piece from the last 8 weeks with an `igMediaId`, fetches Instagram insights (`lib/instagram.ts`'s `getMediaInsights`, metric set by `format`: feed/carrossel get `reach/saved/likes/comments/shares/views`, stories get `reach/navigation`) and merges into `Piece.metrics`, preserving existing fields. Pieces published less than 48h ago are skipped (metrics settling), not failed. Also records one `AccountSnapshot` (follower count via `getAccountInfo`) per run, independent of piece updates. Same error-isolation: one piece's Meta API failure only skips that piece. If `META_IG_USER_ID`/`META_IG_TOKEN` aren't configured, returns `200 {"skipped": "credentials not configured"}` — non-fatal.

   Each half (publish / insights) is isolated: a failure in one does not prevent the other from running and reporting in the response.

**Manual runs** — both original routes remain for testing:
- `GET /api/cron/publish[?dry=1]` — publish only, with optional dry-run
- `GET /api/cron/insights` — insights only

**Dry-run** — `GET /api/cron/publish?dry=1` (or set `PUBLISH_DRY_RUN=1`) runs every check but never calls the Graph API and never mutates the database. Eligible pieces come back with `outcome: "skipped"` instead of `"published"`. Use it to sanity-check the queue:

```bash
PORT=3020 pnpm dev   # one terminal
pnpm publish:dry      # another — GETs /api/cron/publish?dry=1 with CRON_SECRET from .env
```

**Auth**: same bearer-token pattern as `GENERATION_API_TOKEN` (see `lib/auth.ts`) — `Authorization: Bearer <CRON_SECRET>`, 401 otherwise. Vercel Cron sends this header automatically when `CRON_SECRET` env var is set on the project.

**Meta setup**: you need an Instagram **Business** or **Creator** account connected to a Facebook Page, a Meta app with the `instagram_content_publish` permission, and a long-lived Page/IG access token — see [Meta's Content Publishing docs](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing). Set `META_IG_USER_ID` and `META_IG_TOKEN` accordingly; `META_TOKEN_EXPIRES_AT` is informational only.

**Status**: `META_IG_USER_ID`/`META_IG_TOKEN` are **not configured in this environment** — a real end-to-end publish is **pending those credentials**. Everything up to that point (idempotency, claim-check, format mapping, local-upload rejection, dry-run) is implemented; once credentials are available, `pnpm publish:dry` without `?dry=1` (a real un-flagged cron hit) validates the first live post.

## Performance Report

**`GET /api/report/latest`** — read-only report over the last 8 weeks of published Pieces: totals, a `pillar+format` ranking by average engagement (`likes+comments+saved+shares`), the last 8 `AccountSnapshot` follower counts, and 1-3 mechanical recommendations (best combo → "priorize X+Y", a distinct worst combo with ≥2 data points → "evite/reformule X+Y", or a single "sem dados suficientes" when window is empty — no LLM call). Also carries a `tokenWarning` string derived from `META_TOKEN_EXPIRES_AT` (missing env, expiring in under 10 days, or already expired all produce a message; otherwise `null`) and a `markdown` field rendering the same data as prose, meant to be embedded by the generation routine ahead of its next round (`docs/02-playbook-conteudo.md` §6). Requires `GENERATION_API_TOKEN`.

**Fixture / smoke check** — `scripts/insights-fixture.mjs` seeds 6 already-published Pieces (fake `igMediaId` + metrics, spanning 3 pillar/format combos) and 2 `AccountSnapshot` rows directly via Prisma (there's no API path to create an already-`published` Piece with metrics — that's the two crons' job), hits `GET /api/report/latest` against a running dev server, prints the ranking + recommendations, then deletes every row it created (tracked by id, not by a broad sweep):

```bash
PORT=3030 pnpm dev     # one terminal
pnpm report:fixture     # another — seeds, calls the endpoint, cleans up
```

## Frequência de geração

`generationIntervalWeeks` (Config → Controles → "Frequência de geração": Semanal/Quinzenal/A cada 3 semanas/Mensal, default weekly) controls how often a new content round should be generated, stored as an `AppSetting` string ("1".."4"). The generation routine's schedule stays weekly — it wakes up every week regardless — but `GET /api/report/latest` now also returns `generationIntervalWeeks` and a computed `generationDue: boolean`, and the routine aborts cheaply (no draft created, no Claude quota spent) when `generationDue` is `false`. `generationDue` is `true` when there's no `Piece` yet, or when the time since the most recently created `Piece` (any status) is at least `generationIntervalWeeks * 7 days - 12h` — the 12h grace keeps a slightly-late weekly run from being flagged as off-schedule. Longer intervals just mean most weekly wake-ups are cheap no-op aborts.

The Fila page's "Gerar rodada agora" button bypasses this check: it PATCHes the one-shot `forceNextGeneration` flag to `true` before opening the routine, which forces `generationDue: true` on the next read regardless of the configured interval; the flag is automatically cleared back to `false` by `POST /api/pieces` the next time a piece is actually created, so it only forces a single round.

## Status

This is the scaffold. The `Piece` Prisma model, the pieces API, the Instagram Graph API publish cron, and the insights cron + performance report are implemented.
