import type { NextRequest } from "next/server";
import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePieceEditor } from "@/lib/session";
import { orderedImagesInclude } from "@/lib/piece-images";
import { enqueuePieceImageGeneration, isImageGenActive } from "@/lib/image-generation";
import { isImageGenConfigured } from "@/lib/image-gen/provider";
import { generateImagesSchema } from "@/lib/validation";

export const runtime = "nodejs";
// Mirrors POST /api/pieces' budget — enqueuePieceImageGeneration schedules
// the actual work with next/server's `after`, and that background call
// still has to finish inside this route's own maxDuration.
export const maxDuration = 300;

// POST /api/pieces/[id]/image/generate (JSON body, optional — see
// generateImagesSchema in lib/validation.ts). Manual trigger for the same
// pipeline POST /api/pieces kicks off automatically on piece creation:
// - mode "replace" (default): deletes every existing generated image
//   (including local files) and regenerates the full set from scratch.
// - mode "resume": leaves existing images alone and only fills in the
//   slide indices that don't have one yet — useful after a partial
//   failure, since generatePieceImages is idempotent by
//   PieceImage.sortOrder.
// - mode "recompose": never calls the image provider — reapplies the
//   piece's current overlayText/overlayTexts on top of each existing
//   PieceImage.sourceUrl (see lib/image-generation.ts's
//   recomposePieceImages). Doesn't require an image provider to be
//   configured, so it skips the 503 guard below; 422s instead when no
//   image has a sourceUrl to recompose from.
// Owner/approver only (lib/session.ts requirePieceEditor), draft-only (once
// approved, images are frozen — same rule as POST .../image), and refuses
// to double-fire while a generation is already queued/running
// (isImageGenActive, which also reclaims a stale "running" lock older than
// IMAGE_GEN_STALE_RUNNING_MS — see lib/image-generation.ts). Every mode
// responds 202 with the piece in "queued" — recompose runs through the same
// after()-scheduled background path as generatePieceImages, not inline.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePieceEditor(req);
  if (authError) return authError;

  const { id } = await params;

  const existing = await prisma.piece.findUnique({ where: { id }, include: orderedImagesInclude });
  if (!existing) {
    return Response.json({ error: "piece not found" }, { status: 404 });
  }
  if (existing.status !== PieceStatus.draft) {
    return Response.json({ error: "apenas rascunhos podem gerar imagens" }, { status: 409 });
  }
  if (existing.format === PieceFormat.reels) {
    return Response.json({ error: "reels usa vídeo, não gera imagem" }, { status: 422 });
  }

  // Body is optional — no Content-Length/empty body means the default
  // ({ mode: "replace" }). Only attempt to parse JSON when something was
  // actually sent. Parsed before the provider-configured check below since
  // "recompose" doesn't need a provider at all.
  const raw = await req.text();
  let body: unknown = {};
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  const parsed = generateImagesSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { mode } = parsed.data;

  if (mode !== "recompose" && !isImageGenConfigured()) {
    return Response.json(
      { error: "geração de imagem não configurada (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN)" },
      { status: 503 },
    );
  }
  if (mode === "recompose" && !existing.images.some((img) => img.kind === "image" && img.sourceUrl)) {
    return Response.json({ error: "nenhuma imagem gerada para recompor" }, { status: 422 });
  }
  if (isImageGenActive(existing)) {
    return Response.json({ error: "geração já em andamento" }, { status: 409 });
  }

  await enqueuePieceImageGeneration(id, { mode });

  const piece = await prisma.piece.findUniqueOrThrow({ where: { id }, include: orderedImagesInclude });

  return Response.json({ piece }, { status: 202 });
}
