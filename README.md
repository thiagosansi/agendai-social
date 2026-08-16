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

## Publicação

`GET /api/cron/publish` is the daily publish cron. It picks up every `Piece` with `status=approved`, `publishAt <= now` and `igMediaId IS NULL` (that last condition is the idempotency guard — a piece already carrying an `igMediaId` is never reprocessed; the only way back into the queue is a human resetting it, e.g. via `PATCH` back to `draft`/`approved`), processes them **sequentially**, and never lets one piece's failure abort the run — each piece is wrapped individually, so a bad caption, an unsupported format, or a Meta API error only marks that one piece `failed` (with an actionable `lastError`) and the loop continues to the next piece.

Format → Graph API container mapping (`lib/instagram.ts`):

- `estatico` → single-image post
- `stories` → Stories container
- `carrossel` → **v1 simplification**: publishes as a single-image post, not a true multi-image carousel. `Piece` only stores one `imageUrl` today; `createCarouselContainer` (real multi-image carousels, one child container per image) is implemented in `lib/instagram.ts` but unused until the schema grows an `imageUrls[]` field.
- `reels` → always fails with `lastError: "vídeo ainda não suportado"` — no video upload support yet.

Before calling Meta, the cron also re-runs the claim-check on the caption (a violation fails the piece, same as the API routes) and rejects local dev image uploads (`imageUrl` starting with `/uploads/`, the fallback path `POST /api/pieces/[id]/image` uses when `BLOB_READ_WRITE_TOKEN` is unset) — Meta's servers can't fetch a `localhost`/relative URL, so those pieces fail with an actionable `lastError` telling you to configure Vercel Blob and re-upload.

**Dry-run** — `GET /api/cron/publish?dry=1` (or set `PUBLISH_DRY_RUN=1`) runs every check above but never calls the Graph API and never mutates the database. Eligible pieces come back with `outcome: "skipped"` (they *would* publish, the real call was just held back) instead of `"published"`. Use it to sanity-check the queue before flipping a piece — or the whole cron — live:

```bash
PORT=3020 pnpm dev   # one terminal
pnpm publish:dry      # another — GETs /api/cron/publish?dry=1 with CRON_SECRET from .env
```

Auth: same bearer-token pattern as `GENERATION_API_TOKEN` (see `lib/auth.ts`) — `Authorization: Bearer <CRON_SECRET>`, 401 otherwise. Vercel Cron sends this header automatically when the `CRON_SECRET` env var is set on the project (Project Settings → Environment Variables), so no extra wiring is needed once it's deployed.

**Schedule**: `vercel.json` sets `0 14 * * *` (UTC — `vercel.json` doesn't support comments, hence the note here) which is **11:00 America/Sao_Paulo**. Adjust the cron expression if the target timezone's UTC offset changes (e.g. DST elsewhere is irrelevant, but Brazil's own historical DST rules would matter if reintroduced).

**Meta setup**: you need an Instagram **Business** or **Creator** account connected to a Facebook Page, a Meta app with the `instagram_content_publish` permission, and a long-lived Page/IG access token — see [Meta's Content Publishing docs](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing). Set `META_IG_USER_ID` and `META_IG_TOKEN` accordingly; `META_TOKEN_EXPIRES_AT` is informational only today (no automated warning yet).

**Status**: `META_IG_USER_ID`/`META_IG_TOKEN` are **not configured in this environment** — a real end-to-end publish (creating a container, polling it to `FINISHED`, calling `media_publish`, and confirming a live post) is **pending those credentials**. Everything up to that point (idempotency guard, claim-check re-run, format mapping, local-upload rejection, dry-run) is implemented and covered by the dry-run script; once credentials are available, `pnpm publish:dry` without `?dry=1` semantics (i.e. a real un-flagged cron hit) is the way to validate the first live post.

## Análise de desempenho

Two more pieces close the loop between "what got published" and "what to generate next":

- **`GET /api/cron/insights`** — weekly cron (`vercel.json`, Monday 09:00 America/Sao_Paulo). For every `published` Piece with an `igMediaId` from the last 8 weeks, fetches Instagram insights (`lib/instagram.ts`'s `getMediaInsights`, metric set chosen by `format`: feed image/carrossel gets `reach/saved/likes/comments/shares/views`, `stories` gets `reach/navigation` — only available while the story exists, ~24h) and merges them into `Piece.metrics`, preserving any fields already there. Pieces published less than 48h ago are skipped (metrics are still settling), not failed. Also records one `AccountSnapshot` (follower count, via `getAccountInfo`) per run, independent of whether any piece was updated. Same error-isolation pattern as the publish cron: one piece's Meta API failure only skips that piece. If `META_IG_USER_ID`/`META_IG_TOKEN` aren't configured, the cron returns `200 {"skipped": "credentials not configured"}` instead of failing — same non-fatal posture as the publish cron's missing-credentials case.
- **`GET /api/report/latest`** — read-only report over the last 8 weeks of published Pieces: totals, a `pillar+format` ranking by average engagement (`likes+comments+saved+shares`), the last 8 `AccountSnapshot` follower counts, and 1-3 mechanical recommendations (best combo → "priorize X+Y", a distinct worst combo with ≥2 data points → "evite/reformule X+Y", or a single "sem dados suficientes" line when the window is empty — no LLM call happens in this route). Also carries a `tokenWarning` string derived from `META_TOKEN_EXPIRES_AT` (missing env, expiring in under 10 days, or already expired all produce a message; otherwise `null`) and a `markdown` field rendering the same data as prose, meant to be embedded directly by the generation routine ahead of its next round (`docs/02-playbook-conteudo.md` §6). Requires `GENERATION_API_TOKEN`, same as `POST /api/pieces`.

**Fixture / smoke check** — `scripts/insights-fixture.mjs` seeds 6 already-published Pieces (fake `igMediaId` + metrics, spanning 3 pillar/format combos) and 2 `AccountSnapshot` rows directly via Prisma (there's no API path to create an already-`published` Piece with metrics — that's the two crons' job), hits `GET /api/report/latest` against a running dev server, prints the ranking + recommendations, then deletes every row it created (tracked by id, not by a broad sweep):

```bash
PORT=3030 pnpm dev     # one terminal
pnpm report:fixture     # another — seeds, calls the endpoint, cleans up
```

## Status

This is the scaffold. The `Piece` Prisma model, the pieces API, the Instagram Graph API publish cron, and the insights cron + performance report are implemented.
