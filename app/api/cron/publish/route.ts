import type { NextRequest } from "next/server";
import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/auth";
import { checkText, loadRules } from "@/lib/claim-check";
import {
  InstagramApiError,
  createImageContainer,
  createStoryContainer,
  getMediaPermalink,
  publishContainer,
} from "@/lib/instagram";

export const runtime = "nodejs";

// Local dev image uploads (app/api/pieces/[id]/image falls back to
// public/uploads when BLOB_READ_WRITE_TOKEN is unset) are served under this
// prefix and are NOT reachable by Meta's servers — only a real host can
// fetch image_url.
const LOCAL_UPLOAD_PREFIX = "/uploads/";

type ContainerKind = "image" | "story";

type FormatResolution = { kind: ContainerKind } | { kind: "unsupported"; reason: string };

// Maps a Piece.format to the Graph API container it publishes as.
//
// v1 simplification: `carrossel` publishes as a single-image post, not a
// true multi-image carousel — Piece only stores one `imageUrl` today, and
// lib/instagram.ts's createCarouselContainer (which does support real
// carousels) is unused until the schema grows an imageUrls[] field. `reels`
// is not supported at all yet (no video upload in this app), so it always
// fails with an actionable lastError.
function resolveContainerKind(format: PieceFormat): FormatResolution {
  switch (format) {
    case PieceFormat.estatico:
      return { kind: "image" };
    case PieceFormat.stories:
      return { kind: "story" };
    case PieceFormat.carrossel:
      return { kind: "image" };
    case PieceFormat.reels:
      return { kind: "unsupported", reason: "vídeo ainda não suportado" };
    default:
      return { kind: "unsupported", reason: `formato não suportado: ${String(format)}` };
  }
}

function isLocalUploadUrl(imageUrl: string): boolean {
  return imageUrl.startsWith(LOCAL_UPLOAD_PREFIX);
}

interface PublishResult {
  id: string;
  format: PieceFormat;
  outcome: "published" | "failed" | "skipped";
  containerType?: ContainerKind;
  imageUrl: string | null;
  igMediaId?: string;
  igPermalink?: string | null;
  error?: string;
}

// GET /api/cron/publish[?dry=1]
// Called daily by Vercel Cron (see vercel.json). Publishes every approved
// Piece whose publishAt has passed and that hasn't been published yet
// (igMediaId IS NULL is the idempotency guard — a piece is only ever
// attempted again after a human resets it back to draft/approved).
//
// Processes pieces sequentially and never lets one piece's failure abort
// the run: each piece is wrapped so a Meta error, claim-check violation, or
// unsupported format only fails that piece (status=failed + lastError) and
// the loop continues.
//
// Dry-run (?dry=1 or env PUBLISH_DRY_RUN=1): runs every check (claim-check,
// format support, imageUrl reachability) but never calls the Graph API and
// never mutates the DB — eligible pieces are reported with outcome
// "skipped" (they would be published, but the real Meta call was skipped),
// not "published".
export async function GET(req: NextRequest) {
  const authError = requireCronSecret(req);
  if (authError) return authError;

  const dryRun = req.nextUrl.searchParams.get("dry") === "1" || process.env.PUBLISH_DRY_RUN === "1";

  const now = new Date();
  const pieces = await prisma.piece.findMany({
    where: {
      status: PieceStatus.approved,
      publishAt: { lte: now },
      igMediaId: null,
    },
    orderBy: { publishAt: "asc" },
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
    // 1. Re-run claim-check — a caption can be edited after approval never
    // happens today (PATCH requires re-approval), but re-checking here
    // means the cron never trusts a stale claimCheckPassed flag.
    const claimResult = checkText(piece.caption, loadRules());
    if (!claimResult.ok) {
      const message = `legenda viola promessa(s) proibida(s): ${claimResult.violations
        .map((v) => v.label)
        .join(", ")}`;
      await markFailed(piece.id, message);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: piece.imageUrl, error: message });
      continue;
    }

    // 2. Resolve format -> Graph API container type (reels always fails here).
    const resolved = resolveContainerKind(piece.format);
    if (resolved.kind === "unsupported") {
      await markFailed(piece.id, resolved.reason);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: piece.imageUrl, error: resolved.reason });
      continue;
    }

    if (!piece.imageUrl) {
      const message = "imageUrl ausente — peça não deveria estar aprovada sem imagem";
      await markFailed(piece.id, message);
      results.push({ id: piece.id, format: piece.format, outcome: "failed", imageUrl: piece.imageUrl, error: message });
      continue;
    }

    // 3. Local dev uploads aren't fetchable by Meta. Fine in dry-run
    // (nothing is actually called), fatal in real mode.
    const isLocalUrl = isLocalUploadUrl(piece.imageUrl);
    if (isLocalUrl && !dryRun) {
      const message =
        "imageUrl local (/uploads/...) não é acessível publicamente pela Meta — configure BLOB_READ_WRITE_TOKEN e reenvie a imagem antes de publicar.";
      await markFailed(piece.id, message);
      results.push({
        id: piece.id,
        format: piece.format,
        outcome: "failed",
        containerType: resolved.kind,
        imageUrl: piece.imageUrl,
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
        imageUrl: piece.imageUrl,
        ...(isLocalUrl
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
          ? await createStoryContainer({ imageUrl: piece.imageUrl })
          : await createImageContainer({ imageUrl: piece.imageUrl, caption: piece.caption });

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
        imageUrl: piece.imageUrl,
        igMediaId: mediaId,
        igPermalink: permalink,
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
        imageUrl: piece.imageUrl,
        error: message,
      });
    }
  }

  return Response.json({ processed: pieces.length, published, failed, skipped, results });
}
