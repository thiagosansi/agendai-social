import { PieceFormat, PieceStatus, type PieceImage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkText, loadRules } from "@/lib/claim-check";
import { isVideoMedia, orderedImagesInclude } from "@/lib/piece-images";
import { getSetting } from "@/lib/settings";
import { isLocalUploadUrl } from "@/lib/uploads";
import {
  InstagramApiError,
  createCarouselContainer,
  createImageContainer,
  createReelsContainer,
  createStoryContainer,
  createVideoStoryContainer,
  getContainerStatus,
  getMediaPermalink,
  publishContainer,
  publishFinishedContainer,
  type ContainerStatusResult,
} from "@/lib/instagram";

export type ContainerKind = "image" | "carousel" | "story" | "story_video" | "reels";

type FormatResolution = { kind: ContainerKind } | { kind: "unsupported"; reason: string };

// Maps a Piece.format + its media (PieceImage rows, including `kind`) to
// the Graph API container it publishes as (lib/instagram.ts):
// - estatico -> single image; any video attached is unsupported (video is
//   reels/stories only).
// - stories -> Stories container. A video row -> "story_video"
//   (createVideoStoryContainer); otherwise the first/only image ->
//   "story" (createStoryContainer). Stories has no multi-media concept.
// - carrossel with >=2 images -> true multi-image carousel
//   (createCarouselContainer); with exactly 1 image, falls back to a plain
//   image post (flagged via a `note` on the result, not a failure) — this
//   only happens for a carrossel piece approved before this feature existed,
//   or a piece that lost images some other way. Any video attached is
//   unsupported, same as estatico.
// - reels -> requires exactly 1 media item and it must be a video; anything
//   else (no media, an image, more than one item) is unsupported.
export function resolveContainerKind(format: PieceFormat, media: Pick<PieceImage, "kind">[]): FormatResolution {
  const videoCount = media.filter(isVideoMedia).length;

  switch (format) {
    case PieceFormat.estatico:
      if (videoCount > 0) {
        return { kind: "unsupported", reason: "vídeo só é permitido em reels/stories" };
      }
      return { kind: "image" };
    case PieceFormat.stories:
      return { kind: videoCount > 0 ? "story_video" : "story" };
    case PieceFormat.carrossel:
      if (videoCount > 0) {
        return { kind: "unsupported", reason: "vídeo só é permitido em reels/stories" };
      }
      return { kind: media.length >= 2 ? "carousel" : "image" };
    case PieceFormat.reels:
      if (media.length !== 1 || videoCount !== 1) {
        return { kind: "unsupported", reason: "reels exige 1 vídeo (MP4)" };
      }
      return { kind: "reels" };
    default:
      return { kind: "unsupported", reason: `formato não suportado: ${String(format)}` };
  }
}

export interface PublishResult {
  id: string;
  format: PieceFormat;
  outcome: "published" | "failed" | "skipped" | "pending";
  containerType?: ContainerKind;
  imageUrl: string | null;
  imageUrls?: string[];
  igMediaId?: string;
  igPermalink?: string | null;
  error?: string;
  note?: string;
}

export interface PublishPayload {
  processed: number;
  published: number;
  failed: number;
  skipped: number;
  pending: number;
  results: PublishResult[];
  paused?: true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown): string {
  return error instanceof InstagramApiError
    ? error.toActionableMessage()
    : error instanceof Error
      ? error.message
      : String(error);
}

// Per-run wall-clock budget for video container processing (create + poll +
// publish) — a video container can legitimately take Meta several minutes
// to finish processing, well beyond what fits in a single cron invocation
// alongside every other piece. When the budget runs out mid-poll, the piece
// is left `approved` with `pendingContainerId` set so the next cron run
// resumes by polling that same container instead of creating a new one
// (see the pending-container pass at the top of runPublish).
const RUN_BUDGET_MS = 240_000;
const VIDEO_POLL_INTERVAL_MS = 5000;

// A pending container older than this is treated as stuck/abandoned rather
// than keep polling it forever.
const PENDING_CONTAINER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Polls a video container's status until it leaves IN_PROGRESS or the
 * remaining run budget (measured from `runStart`) can't fit another poll
 * attempt. Returns the last observed status either way — the caller
 * decides what IN_PROGRESS-at-budget-exhaustion means (defer to next run).
 */
async function pollContainerWithBudget(containerId: string, runStart: number): Promise<ContainerStatusResult> {
  for (;;) {
    const status = await getContainerStatus(containerId);
    if (status.statusCode !== "IN_PROGRESS") return status;

    const elapsed = Date.now() - runStart;
    if (elapsed + VIDEO_POLL_INTERVAL_MS > RUN_BUDGET_MS) {
      return status;
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);
  }
}

function containerFailureMessage(status: ContainerStatusResult): string {
  return `container falhou ao processar (status_code=${status.statusCode}${status.status ? `, status=${status.status}` : ""})`;
}

// Publishes every approved Piece whose publishAt has passed and that hasn't
// been published yet (igMediaId IS NULL is the idempotency guard — a piece is
// only ever attempted again after a human resets it back to draft/approved).
//
// Processes pieces sequentially and never lets one piece's failure abort
// the run: each piece is wrapped so a Meta error, claim-check violation, or
// unsupported format only fails that piece (status=failed + lastError) and
// the loop continues.
//
// Two passes:
// 1. Pieces already carrying a `pendingContainerId` from a previous run
//    (a video container that was still IN_PROGRESS when that run's budget
//    ran out) — re-check status and finish the job instead of creating a
//    new container.
// 2. Every other approved+due piece, in publishAt order — new video
//    containers created here that don't finish within RUN_BUDGET_MS become
//    pending containers for the next run instead of failing.
//
// Dry-run: runs every check (claim-check, format support, imageUrl
// reachability) but never calls the Graph API and never mutates the DB —
// eligible pieces are reported with outcome "skipped" (they would be
// published, but the real Meta call was skipped), not "published". Pending
// containers are reported as "pending" without a status check (still a
// Graph API call, so skipped entirely in dry-run).
export async function runPublish(options: { dryRun: boolean }): Promise<PublishPayload> {
  const { dryRun } = options;
  const runStart = Date.now();

  // Kill switch (Config page "Pausar publicações" toggle). Checked before
  // touching anything else — no query, no claim-check, no Graph API call —
  // so approved pieces just sit and wait for the next unpaused run.
  const publishingPaused = await getSetting("publishingPaused");
  if (publishingPaused) {
    return { paused: true, processed: 0, published: 0, failed: 0, skipped: 0, pending: 0, results: [] };
  }

  const results: PublishResult[] = [];
  let published = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;

  const markFailed = async (pieceId: string, message: string, clearPending = false) => {
    if (!dryRun) {
      await prisma.piece.update({
        where: { id: pieceId },
        data: {
          status: PieceStatus.failed,
          lastError: message,
          ...(clearPending ? { pendingContainerId: null, pendingContainerCreatedAt: null } : {}),
        },
      });
    }
    failed += 1;
  };

  // --- Pass 1: resume pieces already carrying a pending video container ---
  const pendingPieces = await prisma.piece.findMany({
    where: {
      status: PieceStatus.approved,
      igMediaId: null,
      pendingContainerId: { not: null },
    },
    orderBy: { publishAt: "asc" },
    include: orderedImagesInclude,
  });

  for (const piece of pendingPieces) {
    const containerId = piece.pendingContainerId!;
    const imageUrls = piece.images.map((image) => image.url);
    const firstUrl = imageUrls[0] ?? null;
    const resolved = resolveContainerKind(piece.format, piece.images);
    const containerType = resolved.kind === "unsupported" ? undefined : resolved.kind;

    if (dryRun) {
      pending += 1;
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "pending",
        containerType,
        imageUrl: firstUrl,
        note: "container pendente — dry-run não consulta status",
      });
      continue;
    }

    try {
      const status = await getContainerStatus(containerId);

      if (status.statusCode === "FINISHED") {
        const { mediaId } = await publishFinishedContainer(containerId);
        const permalink = await getMediaPermalink(mediaId).catch(() => null);
        await prisma.piece.update({
          where: { id: piece.id },
          data: {
            status: PieceStatus.published,
            igMediaId: mediaId,
            igPermalink: permalink,
            lastError: null,
            pendingContainerId: null,
            pendingContainerCreatedAt: null,
          },
        });
        published += 1;
        results.push({
          id: piece.id,
          format: piece.format,
          outcome: "published",
          containerType,
          imageUrl: firstUrl,
          igMediaId: mediaId,
          igPermalink: permalink,
        });
        continue;
      }

      if (status.statusCode === "ERROR" || status.statusCode === "EXPIRED") {
        const message = containerFailureMessage(status);
        await markFailed(piece.id, message, true);
        results.push({
          id: piece.id,
          format: piece.format,
          outcome: "failed",
          containerType,
          imageUrl: firstUrl,
          error: message,
        });
        continue;
      }

      // Still IN_PROGRESS — give up only once the container has been
      // pending for too long; otherwise keep waiting for a future run.
      const pendingSince = piece.pendingContainerCreatedAt?.getTime() ?? 0;
      if (Date.now() - pendingSince > PENDING_CONTAINER_MAX_AGE_MS) {
        const message = "container expirou (mais de 24h em processamento)";
        await markFailed(piece.id, message, true);
        results.push({
          id: piece.id,
          format: piece.format,
          outcome: "failed",
          containerType,
          imageUrl: firstUrl,
          error: message,
        });
        continue;
      }

      pending += 1;
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "pending",
        containerType,
        imageUrl: firstUrl,
        note: "vídeo em processamento na Meta — publicação continua no próximo cron",
      });
    } catch (error) {
      const message = toErrorMessage(error);
      await markFailed(piece.id, message, true);
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "failed",
        containerType,
        imageUrl: firstUrl,
        error: message,
      });
    }
  }

  // --- Pass 2: every other approved+due piece (excludes pass 1's pieces) ---
  const now = new Date();
  const pieces = await prisma.piece.findMany({
    where: {
      status: PieceStatus.approved,
      publishAt: { lte: now },
      igMediaId: null,
      pendingContainerId: null,
    },
    orderBy: { publishAt: "asc" },
    include: orderedImagesInclude,
  });

  for (const piece of pieces) {
    const imageUrls = piece.images.map((image) => image.url);
    const firstImageUrl = imageUrls[0] ?? null;

    // 1. Re-run claim-check — a caption can be edited after approval never
    // happens today (PATCH requires re-approval), but re-checking here
    // means the cron never trusts a stale claimCheckPassed flag.
    const claimResult = checkText(piece.caption, loadRules());
    if (!claimResult.ok) {
      const message = `legenda viola promessa(s) proibida(s): ${claimResult.violations
        .map((v) => v.label)
        .join(", ")}`;
      await markFailed(piece.id, message);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: firstImageUrl, error: message });
      continue;
    }

    // 2. Resolve format -> Graph API container type.
    const resolved = resolveContainerKind(piece.format, piece.images);
    if (resolved.kind === "unsupported") {
      await markFailed(piece.id, resolved.reason);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: firstImageUrl, error: resolved.reason });
      continue;
    }

    if (imageUrls.length === 0) {
      const message = "nenhuma mídia definida — peça não deveria estar aprovada sem imagem/vídeo";
      await markFailed(piece.id, message);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: firstImageUrl, error: message });
      continue;
    }

    // carrossel approved before this feature existed (or that lost images
    // some other way) has exactly 1 image at this point — resolveContainerKind
    // already fell back its kind to "image" above, so it just publishes as a
    // single-image post; flag that with a note instead of a hard failure.
    const note =
      piece.format === PieceFormat.carrossel && resolved.kind === "image"
        ? "carrossel com apenas 1 imagem — publicado como imagem única, não como carrossel"
        : undefined;

    // 3. Local dev uploads (image or video) aren't fetchable by Meta. Fine
    // in dry-run (nothing is actually called), fatal in real mode. Checks
    // every media item — a carousel is only as reachable as its least
    // reachable slide.
    const localUrls = imageUrls.filter(isLocalUploadUrl);
    const hasLocalUrl = localUrls.length > 0;
    if (hasLocalUrl && !dryRun) {
      const message =
        "arquivo (imagem/vídeo) local (/uploads/...) não é acessível publicamente pela Meta — configure BLOB_READ_WRITE_TOKEN e reenvie antes de publicar.";
      await markFailed(piece.id, message);
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "failed",
        containerType: resolved.kind,
        imageUrl: firstImageUrl,
        imageUrls,
        error: message,
      });
      continue;
    }

    if (dryRun) {
      skipped += 1;
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "skipped",
        containerType: resolved.kind,
        imageUrl: firstImageUrl,
        imageUrls,
        ...(note ? { note } : {}),
        ...(hasLocalUrl
          ? { error: "aviso: arquivo local — falharia em modo real sem BLOB_READ_WRITE_TOKEN" }
          : {}),
      });
      continue;
    }

    // 4. Video formats (reels / story_video): create the container, then
    // poll with a run-scoped time budget instead of publishContainer's
    // fixed short retry loop — a video container can take several minutes.
    if (resolved.kind === "reels" || resolved.kind === "story_video") {
      const videoMedia = piece.images.find(isVideoMedia)!;
      try {
        const containerId =
          resolved.kind === "reels"
            ? await createReelsContainer({
                videoUrl: videoMedia.url,
                caption: piece.caption,
                coverUrl: videoMedia.coverUrl ?? undefined,
              })
            : await createVideoStoryContainer({ videoUrl: videoMedia.url });

        const status = await pollContainerWithBudget(containerId, runStart);

        if (status.statusCode === "FINISHED") {
          const { mediaId } = await publishFinishedContainer(containerId);
          const permalink = await getMediaPermalink(mediaId).catch(() => null);
          await prisma.piece.update({
            where: { id: piece.id },
            data: {
              status: PieceStatus.published,
              igMediaId: mediaId,
              igPermalink: permalink,
              lastError: null,
            },
          });
          published += 1;
          results.push({
            id: piece.id,
            format: piece.format,
            outcome: "published",
            containerType: resolved.kind,
            imageUrl: videoMedia.url,
            igMediaId: mediaId,
            igPermalink: permalink,
          });
        } else if (status.statusCode === "ERROR" || status.statusCode === "EXPIRED") {
          const message = containerFailureMessage(status);
          await markFailed(piece.id, message);
          results.push({
            id: piece.id,
            format: piece.format,
            outcome: "failed",
            containerType: resolved.kind,
            imageUrl: videoMedia.url,
            error: message,
          });
        } else {
          // Budget exhausted while still IN_PROGRESS — defer to next run.
          const message = "vídeo em processamento na Meta — publicação continua no próximo cron";
          await prisma.piece.update({
            where: { id: piece.id },
            data: {
              pendingContainerId: containerId,
              pendingContainerCreatedAt: new Date(),
              lastError: message,
            },
          });
          pending += 1;
          results.push({
            id: piece.id,
            format: piece.format,
            outcome: "pending",
            containerType: resolved.kind,
            imageUrl: videoMedia.url,
            note: message,
          });
        }
      } catch (error) {
        const message = toErrorMessage(error);
        await markFailed(piece.id, message);
        results.push({
          id: piece.id,
          format: piece.format,
          outcome: "failed",
          containerType: resolved.kind,
          imageUrl: videoMedia.url,
          error: message,
        });
      }
      continue;
    }

    // 5. Real publish (image/carousel/story): create the container, poll
    // until FINISHED, publish, fetch the permalink. Any failure here
    // (including expired token / rate limit) is caught below and only
    // fails this one piece.
    try {
      const containerId =
        resolved.kind === "story"
          ? await createStoryContainer({ imageUrl: firstImageUrl! })
          : resolved.kind === "carousel"
            ? await createCarouselContainer({ imageUrls, caption: piece.caption })
            : await createImageContainer({ imageUrl: firstImageUrl!, caption: piece.caption });

      const { mediaId } = await publishContainer(containerId);
      const permalink = await getMediaPermalink(mediaId).catch(() => null);

      await prisma.piece.update({
        where: { id: piece.id },
        data: {
          status: PieceStatus.published,
          igMediaId: mediaId,
          igPermalink: permalink,
          lastError: null,
        },
      });
      published += 1;
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "published",
        containerType: resolved.kind,
        imageUrl: firstImageUrl,
        imageUrls,
        igMediaId: mediaId,
        igPermalink: permalink,
        ...(note ? { note } : {}),
      });
    } catch (error) {
      const message = toErrorMessage(error);
      await markFailed(piece.id, message);
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "failed",
        containerType: resolved.kind,
        imageUrl: firstImageUrl,
        imageUrls,
        error: message,
      });
    }
  }

  return {
    processed: pendingPieces.length + pieces.length,
    published,
    failed,
    skipped,
    pending,
    results,
  };
}
