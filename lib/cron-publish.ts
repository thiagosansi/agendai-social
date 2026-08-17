import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkText, loadRules } from "@/lib/claim-check";
import { orderedImagesInclude } from "@/lib/piece-images";
import { getSetting } from "@/lib/settings";
import { isLocalUploadUrl } from "@/lib/uploads";
import {
  InstagramApiError,
  createCarouselContainer,
  createImageContainer,
  createStoryContainer,
  getMediaPermalink,
  publishContainer,
} from "@/lib/instagram";

type ContainerKind = "image" | "carousel" | "story";

type FormatResolution = { kind: ContainerKind } | { kind: "unsupported"; reason: string };

// Maps a Piece.format (+ how many images it has) to the Graph API container
// it publishes as (lib/instagram.ts):
// - estatico -> single image
// - stories -> Stories container (first image only — Stories has no
//   multi-image concept)
// - carrossel with >=2 images -> true multi-image carousel
//   (createCarouselContainer); with exactly 1 image, falls back to a plain
//   image post (flagged via a `note` on the result, not a failure) — this
//   only happens for a carrossel piece approved before this feature existed,
//   or a piece that lost images some other way.
// - reels -> not supported at all yet (no video upload in this app), always
//   fails with an actionable lastError.
function resolveContainerKind(format: PieceFormat, imageCount: number): FormatResolution {
  switch (format) {
    case PieceFormat.estatico:
      return { kind: "image" };
    case PieceFormat.stories:
      return { kind: "story" };
    case PieceFormat.carrossel:
      return { kind: imageCount >= 2 ? "carousel" : "image" };
    case PieceFormat.reels:
      return { kind: "unsupported", reason: "vídeo ainda não suportado" };
    default:
      return { kind: "unsupported", reason: `formato não suportado: ${String(format)}` };
  }
}

export interface PublishResult {
  id: string;
  format: PieceFormat;
  outcome: "published" | "failed" | "skipped";
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
  results: PublishResult[];
  paused?: true;
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
// Dry-run: runs every check (claim-check, format support, imageUrl
// reachability) but never calls the Graph API and never mutates the DB —
// eligible pieces are reported with outcome "skipped" (they would be
// published, but the real Meta call was skipped), not "published".
export async function runPublish(options: { dryRun: boolean }): Promise<PublishPayload> {
  const { dryRun } = options;

  // Kill switch (Config page "Pausar publicações" toggle). Checked before
  // touching anything else — no query, no claim-check, no Graph API call —
  // so approved pieces just sit and wait for the next unpaused run.
  const publishingPaused = await getSetting("publishingPaused");
  if (publishingPaused) {
    return { paused: true, processed: 0, published: 0, failed: 0, skipped: 0, results: [] };
  }

  const now = new Date();
  const pieces = await prisma.piece.findMany({
    where: {
      status: PieceStatus.approved,
      publishAt: { lte: now },
      igMediaId: null,
    },
    orderBy: { publishAt: "asc" },
    include: orderedImagesInclude,
  });

  const results: PublishResult[] = [];
  let published = 0;
  let failed = 0;
  let skipped = 0;

  const markFailed = async (pieceId: string, message: string) => {
    if (!dryRun) {
      await prisma.piece.update({
        where: { id: pieceId },
        data: { status: PieceStatus.failed, lastError: message },
      });
    }
    failed += 1;
  };

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

    // 2. Resolve format -> Graph API container type (reels always fails here).
    const resolved = resolveContainerKind(piece.format, imageUrls.length);
    if (resolved.kind === "unsupported") {
      await markFailed(piece.id, resolved.reason);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: firstImageUrl, error: resolved.reason });
      continue;
    }

    if (imageUrls.length === 0) {
      const message = "nenhuma imagem definida — peça não deveria estar aprovada sem imagem";
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

    // 3. Local dev uploads aren't fetchable by Meta. Fine in dry-run
    // (nothing is actually called), fatal in real mode. Checks every image
    // — a carousel is only as reachable as its least reachable slide.
    const localUrls = imageUrls.filter(isLocalUploadUrl);
    const hasLocalUrl = localUrls.length > 0;
    if (hasLocalUrl && !dryRun) {
      const message =
        "imageUrl local (/uploads/...) não é acessível publicamente pela Meta — configure BLOB_READ_WRITE_TOKEN e reenvie a(s) imagem(ns) antes de publicar.";
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
          ? { error: "aviso: imageUrl local — falharia em modo real sem BLOB_READ_WRITE_TOKEN" }
          : {}),
      });
      continue;
    }

    // 4. Real publish: create the container, poll until FINISHED, publish,
    // fetch the permalink. Any failure here (including expired token / rate
    // limit) is caught below and only fails this one piece.
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
      const message =
        error instanceof InstagramApiError
          ? error.toActionableMessage()
          : error instanceof Error
            ? error.message
            : String(error);
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

  return { processed: pieces.length, published, failed, skipped, results };
}
