import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderedImagesInclude } from "@/lib/piece-images";
import { deleteLocalUploadFile, isLocalUploadUrl, storePieceMediaBytes } from "@/lib/uploads";
import { getImageProvider, type ImageAspect, type ImageProvider } from "@/lib/image-gen/provider";
import { composeOverlay, NO_TEXT_PROMPT_SUFFIX } from "@/lib/image-gen/overlay";

// Automated image-generation pipeline for draft pieces. Triggered from
// POST /api/pieces via enqueuePieceImageGeneration (scheduled with
// next/server's `after` so it never blocks the generation routine's HTTP
// response) and safe to re-run manually via
// POST /api/pieces/[id]/image/generate since every step is idempotent by
// sortOrder.

const IMAGE_GEN_ERROR_MAX_LEN = 500;

// A "running" execution is presumed dead once its Piece.updatedAt hasn't
// moved in this long. next/server's `after()` has no retry and no
// observability if the serverless instance running it gets recycled or hits
// maxDuration mid-generation — the row is left stuck at imageGenStatus
// "running" forever with nothing to clear it. 10 minutes comfortably
// exceeds the POST /api/pieces/[id]/image/generate route's own
// maxDuration=300 (5min) budget, so a lock this old can only be orphaned,
// never a slow-but-alive run.
export const IMAGE_GEN_STALE_RUNNING_MS = 10 * 60 * 1000;

/**
 * True when a piece has a generation that should be treated as still
 * owning the lock: queued (about to start) or running, both with a recent
 * enough updatedAt to not be considered orphaned (see
 * IMAGE_GEN_STALE_RUNNING_MS above). A queued status whose `after()`
 * callback never started — e.g. the serverless instance died right after
 * enqueue — is also considered orphaned after the staleness window and
 * will be reclaimed by the optimistic lock. Used by the manual regenerate
 * endpoint to return 409 without racing the optimistic lock in
 * generatePieceImages itself.
 */
export function isImageGenActive(piece: { imageGenStatus: string; updatedAt: Date }): boolean {
  const status = piece.imageGenStatus;
  if (status === "queued" || status === "running") {
    return Date.now() - piece.updatedAt.getTime() < IMAGE_GEN_STALE_RUNNING_MS;
  }
  return false;
}

function truncateError(message: string): string {
  return message.length > IMAGE_GEN_ERROR_MAX_LEN
    ? `${message.slice(0, IMAGE_GEN_ERROR_MAX_LEN - 1)}…`
    : message;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// carrossel/estatico feed posts use Instagram's 4:5 crop; stories use the
// full 9:16 vertical. reels is image-free (video only, see VIDEO_FORMATS in
// lib/validation.ts) — generatePieceImages short-circuits before this is
// ever called for that format, but the mapping is included for completeness.
export function aspectForFormat(format: PieceFormat): ImageAspect {
  return format === PieceFormat.stories || format === PieceFormat.reels ? "9:16" : "4:5";
}

// If the prompt text doesn't already speak to aspect/framing, append a
// short instruction so the model favors the right crop — most imagePrompts
// written by the content strategist skill focus on subject/composition and
// leave aspect implicit.
const ASPECT_HINT_PATTERN = /4:5|9:16|1:1|aspect|ratio/i;

function promptForAspect(basePrompt: string, aspect: ImageAspect): string {
  if (ASPECT_HINT_PATTERN.test(basePrompt)) return basePrompt;

  const suffix =
    aspect === "9:16"
      ? " Vertical 9:16 Instagram story image."
      : " Vertical 4:5 Instagram feed image.";
  return `${basePrompt}${suffix}`;
}

// Appends NO_TEXT_PROMPT_SUFFIX (lib/image-gen/overlay.ts) to every prompt
// sent to the image model, so the scene comes back clean and the headline is
// composited afterwards instead of drawn by the model (which misspells
// pt-BR text). Idempotent — a prompt that already carries the suffix (e.g. a
// caller re-generating from a stored prompt) isn't given it twice.
function appendNoTextSuffix(prompt: string): string {
  const suffix = NO_TEXT_PROMPT_SUFFIX.trim();
  if (prompt.includes(suffix)) return prompt;
  return `${prompt.replace(/\s+$/, "")}${NO_TEXT_PROMPT_SUFFIX}`;
}

// The overlay text to burn onto a given slide index: carrossel pulls from
// overlayTexts (parallel to imagePrompts by index, "" for absent entries —
// including a legacy piece whose overlayTexts is shorter than imagePrompts);
// every other format uses the single overlayText field.
function overlayFor(
  piece: { format: PieceFormat; overlayText: string | null; overlayTexts: string[] },
  index: number,
): string {
  if (piece.format === PieceFormat.carrossel) {
    return piece.overlayTexts[index] ?? "";
  }
  return piece.overlayText ?? "";
}

/**
 * Optimistic lock shared by generatePieceImages and recomposePieceImages:
 * only one execution should actually own a piece's generation at a time (a
 * duplicate enqueue, or a manual regenerate/recompose racing the automatic
 * pipeline). See the comment at the generatePieceImages call site for the
 * staleness rationale.
 */
async function acquireGenerationLock(pieceId: string): Promise<boolean> {
  const locked = await prisma.piece.updateMany({
    where: {
      id: pieceId,
      OR: [
        { imageGenStatus: { not: "running" } },
        {
          imageGenStatus: "running",
          updatedAt: { lt: new Date(Date.now() - IMAGE_GEN_STALE_RUNNING_MS) },
        },
      ],
    },
    data: { imageGenStatus: "running", imageGenError: null },
  });
  return locked.count > 0;
}

// Reads the bytes of a clean source photo (PieceImage.sourceUrl) for
// recompose: a local /uploads/... path is read straight off disk, anything
// else (a Vercel Blob URL) is fetched over http(s).
async function readSourceBytes(sourceUrl: string): Promise<Uint8Array> {
  if (isLocalUploadUrl(sourceUrl)) {
    const buf = await readFile(join(process.cwd(), "public", sourceUrl));
    return new Uint8Array(buf);
  }
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`failed to fetch source image (HTTP ${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

type PieceForGeneration = {
  id: string;
  status: PieceStatus;
  format: PieceFormat;
  imagePrompt: string;
  imagePrompts: string[];
  images: { sortOrder: number; kind: string; url: string }[];
};

/**
 * Resolves the ordered list of prompts to generate for a piece: one per
 * carrossel slide (when at least 2 imagePrompts were provided), or a single
 * cover prompt for every other format — and for a carrossel that didn't get
 * per-slide prompts (older pieces, or a caller that only sent imagePrompt).
 * Returns a warning message when the carrossel fallback kicked in, since
 * that piece will only get a cover image instead of a full carousel.
 */
function resolvePrompts(piece: PieceForGeneration): { prompts: string[]; warning: string | null } {
  if (piece.format === PieceFormat.carrossel && piece.imagePrompts.length >= 2) {
    return { prompts: piece.imagePrompts, warning: null };
  }
  if (piece.format === PieceFormat.carrossel) {
    return {
      prompts: [piece.imagePrompt],
      warning: "carrossel sem imagePrompts por slide: gerada apenas a capa",
    };
  }
  return { prompts: [piece.imagePrompt], warning: null };
}

/**
 * Generates (or resumes generating) the images for a draft piece using the
 * configured AI image provider. Never throws — every failure path is caught
 * and persisted onto imageGenStatus/imageGenError so callers (in particular
 * the `after()` background call from enqueuePieceImageGeneration) can fire
 * and forget.
 *
 * Idempotent by PieceImage.sortOrder: re-running only fills in the slide
 * indices that don't have an image yet, so a partial failure (or a second
 * concurrent enqueue) never regenerates or duplicates existing slides.
 */
export async function generatePieceImages(
  pieceId: string,
  opts?: { replace?: boolean; provider?: ImageProvider },
): Promise<void> {
  try {
    let piece = await prisma.piece.findUnique({
      where: { id: pieceId },
      include: orderedImagesInclude,
    });
    if (!piece || piece.status !== PieceStatus.draft) return;

    if (piece.format === PieceFormat.reels) {
      await prisma.piece.update({ where: { id: pieceId }, data: { imageGenStatus: "idle" } });
      return;
    }

    const provider = opts?.provider ?? getImageProvider();
    if (!provider) {
      await prisma.piece.update({ where: { id: pieceId }, data: { imageGenStatus: "idle" } });
      return;
    }

    // Optimistic lock: only one execution should actually generate at a
    // time for a given piece (a duplicate enqueue, or a manual regenerate
    // racing the automatic one). Losing the race is not an error — the
    // other execution owns this run. Anything that is not currently running
    // can acquire the lock (first branch), including a fresh `queued` from
    // enqueuePieceImageGeneration — the normal handoff. A `running` lock is
    // only reclaimable by the second branch when its updatedAt is older than
    // IMAGE_GEN_STALE_RUNNING_MS, since after() has no retry or observability
    // if the serverless instance that owned it got recycled mid-run or hit
    // maxDuration, leaving the row stuck at "running" forever.
    if (!(await acquireGenerationLock(pieceId))) return;

    if (opts?.replace) {
      const toDelete = piece.images.filter((img) => img.kind === "image");
      for (const img of toDelete) {
        await deleteLocalUploadFile(img.url);
        if (img.sourceUrl && img.sourceUrl !== img.url) {
          await deleteLocalUploadFile(img.sourceUrl);
        }
      }
      if (toDelete.length > 0) {
        await prisma.pieceImage.deleteMany({ where: { pieceId, kind: "image" } });
      }
      piece = await prisma.piece.findUnique({ where: { id: pieceId }, include: orderedImagesInclude });
      if (!piece) return;
    }

    const { prompts, warning } = resolvePrompts(piece);
    const aspect = aspectForFormat(piece.format);

    const existingSortOrders = new Set(
      piece.images.filter((img) => img.kind === "image").map((img) => img.sortOrder),
    );

    for (let i = 0; i < prompts.length; i += 1) {
      if (existingSortOrders.has(i)) continue;

      // Re-check draft status before every slide: the founder may approve
      // the piece mid-generation (e.g. after seeing the first images in the
      // UI), and we must stop writing more images the moment that happens.
      const current = await prisma.piece.findUnique({ where: { id: pieceId }, select: { status: true } });
      if (!current || current.status !== PieceStatus.draft) return;

      try {
        const prompt = appendNoTextSuffix(promptForAspect(prompts[i], aspect));
        const photo = await provider.generate({ prompt, aspect });
        console.info(`image-gen: piece ${pieceId} slide ${i} via ${photo.model ?? provider.name}`);
        const sourceUrl = await storePieceMediaBytes({
          pieceId,
          sortOrder: i,
          variant: "source",
          contentType: photo.contentType,
          bytes: photo.bytes,
        });

        const text = overlayFor(piece, i);
        let url: string;
        let contentType: string;
        if (text.trim()) {
          const composed = await composeOverlay({ photo: photo.bytes, aspect, text });
          url = await storePieceMediaBytes({
            pieceId,
            sortOrder: i,
            contentType: composed.contentType,
            bytes: composed.bytes,
          });
          contentType = composed.contentType;
        } else {
          url = sourceUrl;
          contentType = photo.contentType;
        }

        await prisma.pieceImage.create({
          data: { pieceId, url, sourceUrl, sortOrder: i, kind: "image", contentType },
        });
      } catch (err) {
        await prisma.piece.update({
          where: { id: pieceId },
          data: {
            imageGenStatus: "failed",
            imageGenError: truncateError(`slide ${i + 1}/${prompts.length}: ${errorMessage(err)}`),
            imageGenAt: new Date(),
          },
        });
        return;
      }
    }

    await prisma.piece.update({
      where: { id: pieceId },
      data: {
        imageGenStatus: "done",
        imageGenAt: new Date(),
        imageGenError: warning ? truncateError(warning) : null,
      },
    });
  } catch (err) {
    try {
      await prisma.piece.update({
        where: { id: pieceId },
        data: { imageGenStatus: "failed", imageGenError: truncateError(errorMessage(err)) },
      });
    } catch (persistErr) {
      console.error(
        `generatePieceImages: failed to persist error state for piece ${pieceId}`,
        persistErr,
      );
    }
  }
}

/**
 * Reapplies the piece's current overlayText/overlayTexts on top of each
 * image's clean source photo (PieceImage.sourceUrl) without ever calling
 * the AI image provider — for when the founder tweaks the overlay copy
 * after the photos were already generated. Same lock/status lifecycle and
 * "never throws" contract as generatePieceImages (see its doc comment);
 * draft-only, and images without a sourceUrl (manually uploaded) are left
 * untouched.
 */
export async function recomposePieceImages(pieceId: string): Promise<void> {
  try {
    const piece = await prisma.piece.findUnique({ where: { id: pieceId }, include: orderedImagesInclude });
    if (!piece || piece.status !== PieceStatus.draft) return;

    if (!(await acquireGenerationLock(pieceId))) return;

    const images = piece.images.filter((img) => img.kind === "image" && img.sourceUrl);
    const aspect = aspectForFormat(piece.format);

    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      const sourceUrl = image.sourceUrl as string;

      // Re-check draft status before every slide, same reasoning as
      // generatePieceImages: the founder may approve the piece mid-run.
      const current = await prisma.piece.findUnique({ where: { id: pieceId }, select: { status: true } });
      if (!current || current.status !== PieceStatus.draft) return;

      try {
        const photoBytes = await readSourceBytes(sourceUrl);
        const text = overlayFor(piece, image.sortOrder);

        let url: string;
        let contentType: string;
        if (text.trim()) {
          const composed = await composeOverlay({ photo: photoBytes, aspect, text });
          url = await storePieceMediaBytes({
            pieceId,
            sortOrder: image.sortOrder,
            contentType: composed.contentType,
            bytes: composed.bytes,
          });
          contentType = composed.contentType;
        } else {
          url = sourceUrl;
          contentType = image.contentType ?? "image/jpeg";
        }

        if (isLocalUploadUrl(image.url) && image.url !== sourceUrl) {
          await deleteLocalUploadFile(image.url);
        }

        await prisma.pieceImage.update({ where: { id: image.id }, data: { url, contentType } });
      } catch (err) {
        await prisma.piece.update({
          where: { id: pieceId },
          data: {
            imageGenStatus: "failed",
            imageGenError: truncateError(`slide ${i + 1}/${images.length}: ${errorMessage(err)}`),
            imageGenAt: new Date(),
          },
        });
        return;
      }
    }

    await prisma.piece.update({
      where: { id: pieceId },
      data: { imageGenStatus: "done", imageGenAt: new Date(), imageGenError: null },
    });
  } catch (err) {
    try {
      await prisma.piece.update({
        where: { id: pieceId },
        data: { imageGenStatus: "failed", imageGenError: truncateError(errorMessage(err)) },
      });
    } catch (persistErr) {
      console.error(
        `recomposePieceImages: failed to persist error state for piece ${pieceId}`,
        persistErr,
      );
    }
  }
}

/**
 * Marks a draft piece as queued for image generation and schedules the
 * actual work with next/server's `after`, so the caller (POST /api/pieces)
 * can return its response immediately without waiting on the AI provider.
 * `mode` "recompose" runs recomposePieceImages instead (no provider call);
 * "replace"/"resume" (default "replace") run generatePieceImages as before.
 */
export async function enqueuePieceImageGeneration(
  pieceId: string,
  opts?: { mode?: "replace" | "resume" | "recompose" },
): Promise<void> {
  await prisma.piece.update({
    where: { id: pieceId },
    data: { imageGenStatus: "queued", imageGenError: null },
  });

  const mode = opts?.mode ?? "replace";
  const { after } = await import("next/server");
  after(() =>
    mode === "recompose" ? recomposePieceImages(pieceId) : generatePieceImages(pieceId, { replace: mode === "replace" }),
  );
}
