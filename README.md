# Agendaí Social Studio

Standalone Instagram content pipeline for [Agendaí](https://agendai.space), the online-scheduling product for salons, barbershops, spas and beauty studios. This app is intentionally separate from the main product repository (`agendatmstudio`) — it owns its own database, deploy, and lifecycle.

An AI generation routine reads the product knowledge in `docs/` and creates draft content pieces via API. The founder reviews and approves each piece (uploading the image generated from the piece's image prompt) in a web interface. A daily cron then publishes approved pieces automatically via the Instagram Graph API.

## Piece lifecycle

```
draft ──(owner approves + uploads image)──▶ approved ──(daily cron, Graph API)──▶ published
                                                                              └─▶ failed
```

- **draft** — created by the AI routine via `POST /api/pieces`. The caption is validated against `docs/promessas-proibidas.json` before it is stored.
- **approved** — a human (the founder) reviewed the copy and uploaded the image(s) generated from the piece's `imagePrompt`. Nothing is published without this step.
- **published** / **failed** — set by the daily publish cron depending on whether the Instagram Graph API call succeeded.

See `docs/02-playbook-conteudo.md` for the full editorial contract (content pillars, anti-repetition rotation, forbidden claims, tone rules) that every generated piece must follow, and `docs/rotina-geracao.md` for the operational guide to configure the weekly scheduled generation routine (prompt to paste, env vars, `/schedule` steps, guard-rails) — that routine now also reads `GET /api/analysis/latest` to bias hook/caption/imagePrompt style, and may rewrite at most 1 of the 2 pieces per round from a `contentProposal` in that report (still subject to rotation, anti-repetition and the claim-check). See `docs/rotina-analise.md` for the monthly analysis routine that produces those reports.

Scheduled cloud routines get their content expertise from repo-checked-in skills under `.claude/skills/` (`agendai-social-strategist` for the generation routine; `analise-desempenho` and `analise-mercado` for the analysis routine) — see the routine docs above for how each routine invokes its skill.

### Images

Each `Piece` owns an ordered list of `PieceImage` rows (`sortOrder`, 0-based) instead of a single URL — this is what makes real Instagram carousels possible (see "Publicação" below).

- `POST /api/pieces/[id]/image` (multipart, field `file`) — adds one image. `carrossel` pieces append up to 10; every other format holds a single "cover" image, so a second upload **replaces** the first.
- `DELETE /api/pieces/[id]/image/[imageId]` — removes one image or video and resequences the rest (also cleans up its local `/uploads/...` file and cover file, if any — Blob uploads are left in place, same as image uploads always have been).
- `PATCH /api/pieces/[id]/image/reorder` (`{ imageOrder: string[] }`, the piece's current image ids in the desired order) — sets the publish order. Index 0 is the carousel's first slide.
- Image mutations (add/remove/reorder) are only allowed while `status=draft`. Once a piece is `approved`, its images are frozen — the queued publish always ships exactly what was reviewed — and these routes return `409`.
- Approving (`PATCH /api/pieces/[id]` with `status=approved`) requires ≥1 image, and ≥2 for `carrossel` (`422 "Carrossel precisa de pelo menos 2 imagens"` otherwise). `reels` requires exactly 1 video (`422 "reels exige exatamente 1 vídeo"`); `stories` requires exactly 1 media item, image or video (`422 "stories exige exatamente 1 mídia (imagem ou vídeo)"`, plus `422` if a story video exceeds 60s); `estatico`/`carrossel` reject video entirely (`422 "vídeo só é permitido em reels/stories"`).

### Vídeo (reels/stories)

`reels` and `stories` accept a single video instead of an image (`PieceImage.kind="image"|"video"`, `lib/piece-images.ts`'s `isVideoMedia`). Limits (`lib/validation.ts`): MP4/MOV (H.264/AAC), 200MB max (`MAX_VIDEO_BYTES`), reels up to 15min per Meta's cap (`MAX_REELS_DURATION_SEC` — keep it ≤90s in practice, Reels engagement drops sharply past that), stories up to 60s (`MAX_STORY_VIDEO_DURATION_SEC`). 9:16 vertical is the expected aspect ratio for both, though not enforced server-side.

- `POST /api/pieces/[id]/video/upload-token` — issues a `@vercel/blob/client` client-upload token so the video goes straight from the browser to Blob storage (bypassing this server's request-body limit). Returns `{ mode: "local" }` instead when `BLOB_READ_WRITE_TOKEN` is unset, so the client falls back to option 2 below. Only for `reels`/`stories` in `draft`, and only when the piece has no video yet (`409` otherwise).
- `POST /api/pieces/[id]/video` — registers the video. Two shapes: (1) JSON `{ url, contentType, size, durationSec? }` for a video already uploaded to Blob via the token above (rejects any `url` that isn't a real Blob URL under this piece's `pieces/[id]-video...` prefix); (2) `multipart/form-data` (field `file`, optional `durationSec`) for local dev (writes to `public/uploads`, same as the image route) or a direct server-side upload. Same `reels`/`stories`/`draft`/no-existing-video guard rails as the token route.
- `POST /api/pieces/[id]/video/cover` (multipart, field `file`) — optional still-image thumbnail for the video (`PieceImage.coverUrl`, becomes Meta's `cover_url` on the Reels container). `422` if the piece has no video yet; a second call replaces the previous cover.
- All three routes are `draft`-only, same freeze-after-approval rule as the image routes.

In the `/fila` UI (`components/fila/PieceCard.tsx`), the reels uploader accepts video only and the stories uploader accepts image or video; on selecting a video it reads the duration client-side (rejecting stories videos over 60s outright, warning but allowing reels videos over the recommended 90s), then uploads it — straight to Blob via `upload()` from `@vercel/blob/client` in production (with a live progress %), or through the local-dev multipart fallback when `BLOB_READ_WRITE_TOKEN` is unset — and shows an inline player with an optional cover-image upload (reels only).

**Async processing** — a video container can take Meta well over a minute to finish processing (unlike images, which are near-instant). The publish cron polls with a per-run time budget (`RUN_BUDGET_MS`, 240s) instead of blocking indefinitely: if the container hasn't reached `FINISHED` by the time the budget runs out, the piece stays `approved` with `pendingContainerId`/`pendingContainerCreatedAt` set, and the **next cron run resumes by polling that same container** (no new container is created) instead of failing the piece. A container still `IN_PROGRESS` after 24h is treated as stuck and fails the piece (`"container expirou"`).

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
| `APP_PASSWORD` | Shared password gate for the approval web UI (single-owner tool, no multi-user auth yet). Used both for the `/login` cookie session and the HTTP Basic Auth fallback. |
| `GENERATION_API_TOKEN` | Bearer token the AI generation routine sends when calling `POST /api/pieces`. |
| `ANALYSIS_API_TOKEN` | Bearer token the analysis routine sends when calling `POST /api/analysis`. `GET /api/analysis/latest` also accepts `GENERATION_API_TOKEN`. |
| `CRON_SECRET` | Shared secret the daily publish cron must present to trigger a run. |
| `META_IG_USER_ID` | Instagram Business account ID used to publish approved pieces. |
| `META_IG_TOKEN` | Instagram Graph API access token. |
| `META_TOKEN_EXPIRES_AT` | Expiry timestamp for `META_IG_TOKEN`, used to warn before it lapses. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token — stores the approved piece's image(s)/video before publish. **Required in production** for video: without it, video uploads fall back to local `public/uploads/...` files that Meta's servers can't fetch, so reels/stories video publish would always fail. |
| `VAPID_PUBLIC_KEY` | Public half of the Web Push key pair. Served to the browser by `GET /api/push/subscribe`. |
| `VAPID_PRIVATE_KEY` | Private half of the Web Push key pair — signs push requests, never leaves the server. |
| `VAPID_SUBJECT` | Contact string required by the Web Push spec, e.g. `mailto:voce@exemplo.com`. |

## Autenticação

A UI usa uma sessão em cookie (`/login`) em vez de depender só de HTTP Basic
Auth. Motivo: PWAs instalados na tela de início do iOS (modo standalone)
nunca exibem o prompt nativo do Basic Auth — o app instalado ficava preso em
"Authentication required." sem forma de digitar a senha. `middleware.ts`
agora aceita, nesta ordem: (1) o cookie de sessão, (2) o header
`Authorization: Basic` (mantido para curl/scripts existentes). Sem nenhum
dos dois, uma navegação de página (`Accept: text/html`) é redirecionada para
`/login?next=...`; qualquer outra requisição (curl sem esse header, scripts)
continua recebendo `401` + `WWW-Authenticate` como antes.

Existem três papéis. **Dono**: usuário `admin` + `APP_PASSWORD`, sessão de
180 dias, acesso total. **Aprovador**: cadastrado em Config → "Acessos"
(usuário 3–30 chars `[a-z0-9._]`, senha ≥8, hash scrypt), sessão de 30 dias —
fluxo completo de peça (edita legenda/prompt, envia/remove/reordena imagens,
aprova/desaprova), mas sem Config, sem "Gerar rodada agora" e sem acesso a
`/api/settings`, push ou `/api/users`. **Visualizador**: mesmo cadastro e
sessão de 30 dias, mas somente leitura — vê tudo exceto Config e não pode
mutar nada (a API responde `403 sem permissão`). Desativar/remover uma conta
bloqueia o acesso na próxima navegação (o layout confere o status no banco) e
as sessões expiram sozinhas em 30 dias; **rotacionar `APP_PASSWORD` invalida
todas as sessões** (dono, aprovador e visualizador) imediatamente, junto com
o Basic Auth. `PATCH /api/pieces/:id` e as rotas de imagem (upload/reorder/
delete) aceitam dono ou aprovador; `PATCH /api/settings`, push e `/api/users`
continuam exigindo dono. Basic Auth continua aceito para curl (como dono).
Para sair de uma sessão específica sem trocar a senha, use
**Config → Sessão → Sair**, que limpa o cookie deste aparelho.

## Notificações

Notificações push avisam no celular quando algo precisa de ação humana. Sem
elas o app continua funcionando normalmente — a Config apenas mostra que estão
desativadas.

Dois gatilhos, ambos em `lib/notifications.ts`:

| Gatilho | Quando dispara | Leva para |
|---|---|---|
| Peças aguardando aprovação | `POST /api/pieces` (rodada de geração) e o cron diário | `/fila` |
| Falha ao publicar | Cron diário, quando `runPublish` marca uma peça como `failed` | `/publicados` |

A geração cria uma peça por request, então o aviso de aprovação tem um
cooldown de 30 minutos: uma rodada inteira vira uma única notificação, que
conta a fila real no momento do envio. O aviso de falha não tem cooldown —
o cron roda uma vez por dia e toda falha é um post perdido.

### Setup

1. Gere o par de chaves uma vez:

```bash
npx web-push generate-vapid-keys
```

2. Defina `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no deploy.
3. Abra **Config → Notificações** no aparelho e toque em **Ativar**.
4. Use **Enviar notificação de teste** para confirmar a ponta a ponta.

Repita os passos 3–4 em cada aparelho: cada um vira uma linha em
`PushSubscription` e todas recebem os avisos. Assinaturas mortas (app
desinstalado, dados limpos) são removidas sozinhas quando o serviço de push
responde 404/410.

> **iPhone**: o iOS só entrega push para PWA instalado na tela de início
> (iOS 16.4+). Compartilhar → "Adicionar à Tela de Início", abrir o app por
> lá e ativar de dentro dele. No Safari em aba comum a permissão até é
> concedida, mas nada chega.

O service worker (`public/sw.js`) só trata push — não faz cache. A fila de
aprovação precisa refletir o estado do servidor sempre, então cache offline
atrapalharia mais do que ajudaria. Ele fica fora do basic auth em
`middleware.ts`: o navegador busca o script sem o header `Authorization` da
página, e um `/sw.js` protegido daria 401 no registro.

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

   Format → Graph API container mapping (`lib/instagram.ts`, resolved by `lib/cron-publish.ts`'s `resolveContainerKind`):
   - `estatico` → single-image post (first/only `PieceImage`); a video attached is unsupported (`"vídeo só é permitido em reels/stories"`).
   - `stories` → Stories container. The single `PieceImage` is either an image (`createStoryContainer`) or a video (`createVideoStoryContainer`) — Stories has no multi-media concept either way.
   - `carrossel` → **real multi-image carousel** via `createCarouselContainer`: one child container per image (in `sortOrder`), then a parent `CAROUSEL` container referencing all of them. Requires ≥2 images to approve (`PATCH /api/pieces/[id]` returns 422 `"Carrossel precisa de pelo menos 2 imagens"` otherwise). A `carrossel` piece with exactly 1 image (only possible if it was approved before this feature existed) falls back to a single-image post instead of failing, flagged with a `note` in the publish result. A video attached is unsupported, same as `estatico`.
   - `reels` → `createReelsContainer` (`media_type=REELS`, `video_url`, `caption`, `share_to_feed=true`, plus `cover_url` when `PieceImage.coverUrl` is set). Requires exactly 1 video `PieceImage`; anything else is unsupported (`"reels exige 1 vídeo (MP4)"`).

   Before calling Meta, re-runs claim-check on caption (violation fails the piece) and rejects local dev uploads (any `PieceImage.url` starting with `/uploads/`, the fallback the image/video upload routes use when `BLOB_READ_WRITE_TOKEN` is unset) — Meta's servers can't fetch a local URL, so pieces fail with actionable guidance to configure Vercel Blob. For a carousel this checks every slide — one unreachable image fails the whole piece.

   **Video containers (reels / stories video)** process asynchronously on Meta's side and can take well over a minute to finish — see "Vídeo (reels/stories)" above for the pending-container/next-run-resume behavior. `GET /api/cron/publish`'s response reports these with `outcome: "pending"` (and a `pending` count alongside `published`/`failed`/`skipped`) while a container is still processing.

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

**Status**: `META_IG_USER_ID`/`META_IG_TOKEN` are **not configured in this environment** — a real end-to-end publish is **pending those credentials**. Everything up to that point (idempotency, claim-check, format mapping, video upload/registration, local-upload rejection, dry-run) is implemented; once credentials are available, `pnpm publish:dry` without `?dry=1` (a real un-flagged cron hit) validates the first live post.

## Performance Report

**`GET /api/report/latest`** — read-only report over the last 8 weeks of published Pieces: totals, a `pillar+format` ranking by average engagement (`likes+comments+saved+shares`), the last 8 `AccountSnapshot` follower counts, and 1-3 mechanical recommendations (best combo → "priorize X+Y", a distinct worst combo with ≥2 data points → "evite/reformule X+Y", or a single "sem dados suficientes" when window is empty — no LLM call). Also carries a `tokenWarning` string derived from `META_TOKEN_EXPIRES_AT` (missing env, expiring in under 10 days, or already expired all produce a message; otherwise `null`) and a `markdown` field rendering the same data as prose, meant to be embedded by the generation routine ahead of its next round (`docs/02-playbook-conteudo.md` §6). Requires `GENERATION_API_TOKEN`.

**Fixture / smoke check** — `scripts/insights-fixture.mjs` seeds 6 already-published Pieces (fake `igMediaId` + metrics, spanning 3 pillar/format combos) and 2 `AccountSnapshot` rows directly via Prisma (there's no API path to create an already-`published` Piece with metrics — that's the two crons' job), hits `GET /api/report/latest` against a running dev server, prints the ranking + recommendations, then deletes every row it created (tracked by id, not by a broad sweep):

```bash
PORT=3030 pnpm dev     # one terminal
pnpm report:fixture     # another — seeds, calls the endpoint, cleans up
```

### Analysis reports

`AnalysisReport` stores a periodic (or on-demand) AI-generated review of recent performance — `summaryMarkdown` prose plus structured `insights` (top pillar/format combos, hook/caption patterns, format tactics, image-prompt guidelines, raw deltas) and up to 5 `recommendations` (see `lib/validation.ts`'s `createAnalysisReportSchema` for the exact shape). See `docs/rotina-analise.md` for the operational guide to configure the monthly scheduled analysis routine that produces these reports.

- **`POST /api/analysis`** — creates a report from a fully-formed payload. Requires `ANALYSIS_API_TOKEN`. `400` on invalid JSON or a payload that fails validation.
- **`GET /api/analysis/latest`** — returns the most recently created report, or `404 {"error":"no analysis report yet"}` when none exists. Accepts either `ANALYSIS_API_TOKEN` or `GENERATION_API_TOKEN`.
- **`GET /api/analysis/source?since=8w`** — app-mediated data source for the analysis routine (which never holds `META_IG_TOKEN`): published pieces (with `settling` flag, permalink, and raw `metrics` as collected by the insights cron) plus `followersTrend` and the same `rankingPilarFormato`/`totals` as `report/latest`, windowed by `since` (default `8w`, same parsing as `GET /api/pieces`). Accepts either `ANALYSIS_API_TOKEN` or `GENERATION_API_TOKEN`; `400` on an invalid `since`.
- **`GET /api/analysis/market?fresh=1`** — app-mediated Instagram market scan for the competitors/hashtags configured on `/config` (same reasoning as `analysis/source`: the analysis routine never holds `META_IG_TOKEN`). Returns `competitors` (`username`/`followersCount`/`mediaCount`/`avgLikes`/`avgComments`/`topPosts`, top 5 posts by likes+comments) and `hashtags` (`tag`/`hashtagId`/`topPosts`, or `{skipped:"quota"}` when the safety limit is hit), plus a structured `errors[]` (`item`/`kind`/`code?`/`message`) for any competitor or hashtag that failed without aborting the rest of the scan. Every caption is sanitized (URLs/@mentions stripped, collapsed whitespace, truncated to 220 chars) and claim-checked, with per-post `forbiddenClaimHits` listing any violated rule ids. Results are cached in `MarketSnapshot` for 7 days — a cached response sets `cached: true` and does not call the Graph API; pass `?fresh=1` to force a rescan (still subject to the hashtag quota guard below). If no competitors/hashtags are configured, returns `{empty: true}`; if `META_IG_USER_ID`/`META_IG_TOKEN` aren't set, returns `{unavailable: true, reason: "..."}` — both `200`. Accepts either `ANALYSIS_API_TOKEN` or `GENERATION_API_TOKEN`.

`MarketSnapshot` stores one market scan run: sanitized/claim-checked `competitors`/`hashtags` results, per-item `errors`, and `hashtagsQueried` — the hashtags a Graph call was *actually attempted* for (skipped-by-quota tags are excluded). `hashtagsQueried` exists so `GET /api/analysis/market` can sum unique hashtags across the last 7 days and enforce a 25-hashtag safety margin under Meta's cap of **30 unique hashtags searched per 7 days per account** — once the margin is hit, remaining configured hashtags come back as `{tag, skipped:"quota"}` instead of risking a hard Graph API rejection.

**Market settings** — Config → "Inteligência de mercado" lets you configure up to 8 competitor Instagram usernames and up to 10 hashtags (`marketCompetitors`/`marketHashtags` `AppSetting` keys, `lib/settings.ts`), which `GET /api/analysis/market` scans on every non-cached call.

**Meta prerequisites for the market scan**: the connected account must be an Instagram **Business** or **Creator** account with the `instagram_basic` + `instagram_manage_insights` permissions (both `business_discovery` and hashtag search require them, beyond the `instagram_content_publish` permission needed for publishing). Competitor accounts being scanned must also be public Business/Creator accounts — a private or personal account makes `business_discovery` fail for that username only (isolated into `errors[]`, per the per-item isolation above).

**Como testar o market scan**: configure 1 hashtag (e.g. `skincare`) on `/config` → "Inteligência de mercado", then `curl -H "Authorization: Bearer $ANALYSIS_API_TOKEN" "http://localhost:3000/api/analysis/market?fresh=1"`, and inspect `errors[]` for any permission/private-account failures.

`schemaVersion: 2` extends a report with `insights.market` (competitor/hashtag/web-trend research — all optional) and up to 5 root-level `contentProposals` (pillar/segment/format/hook/captionDraft/imagePrompt/rationale/sources, see `contentProposalSchema`). `POST /api/analysis` runs the same forbidden-claims check as piece creation against every proposal's `captionDraft`; the first violation aborts the whole request with `422 {"error":"captionDraft violates forbidden claims","proposalIndex":N,"violations":[...]}` and nothing is persisted. `schemaVersion: 1` reports are unaffected and keep rendering as before on `/analise`.

## Frequência de geração

`generationIntervalWeeks` (Config → Controles → "Frequência de geração": Semanal/Quinzenal/A cada 3 semanas/Mensal, default weekly) controls how often a new content round should be generated, stored as an `AppSetting` string ("1".."4"). The generation routine's schedule stays weekly — it wakes up every week regardless — but `GET /api/report/latest` now also returns `generationIntervalWeeks` and a computed `generationDue: boolean`, and the routine aborts cheaply (no draft created, no Claude quota spent) when `generationDue` is `false`. `generationDue` is `true` when there's no `Piece` yet, or when the time since the most recently created `Piece` (any status) is at least `generationIntervalWeeks * 7 days - 12h` — the 12h grace keeps a slightly-late weekly run from being flagged as off-schedule. Longer intervals just mean most weekly wake-ups are cheap no-op aborts.

The Fila page's "Gerar rodada agora" button bypasses this check: it PATCHes the one-shot `forceNextGeneration` flag to `true` before opening the routine, which forces `generationDue: true` on the next read regardless of the configured interval; the flag is automatically cleared back to `false` by `POST /api/pieces` the next time a piece is actually created, so it only forces a single round.

## Status

This is the scaffold. The `Piece` Prisma model, the pieces API, the Instagram Graph API publish cron, and the insights cron + performance report are implemented.
