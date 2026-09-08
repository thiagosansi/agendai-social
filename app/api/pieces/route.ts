import type { NextRequest } from "next/server";
import { PieceFormat, PieceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireGenerationToken } from "@/lib/auth";
import { checkText, loadRules } from "@/lib/claim-check";
import { enqueuePieceImageGeneration } from "@/lib/image-generation";
import { isImageGenConfigured } from "@/lib/image-gen/provider";
import { notifyPendingApproval, notifySafely } from "@/lib/notifications";
import { orderedImagesInclude } from "@/lib/piece-images";
import { setSetting } from "@/lib/settings";
import { createPieceSchema } from "@/lib/validation";
import { isoWeekRange, parseSince } from "@/lib/iso-week";

export const runtime = "nodejs";

// The image-generation `after()` callback scheduled below (see POST) runs
// within this route's execution budget (Vercel Fluid Compute) even though
// the HTTP response itself returns immediately — 300s covers a full
// carrossel (up to 10 slides) comfortably.
export const maxDuration = 300;

// GET /api/pieces?status=&since=
// Lists pieces ordered by publishAt. Not gated by the generation token — see
// lib/auth.ts for why. `since` accepts "6w" (weeks back from now) or an ISO
// date string, filtered against `publishAt` (the anti-repetition rule in
// docs/02-playbook-conteudo.md §2 keys off the same field).
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status");
  const sinceParam = searchParams.get("since");

  if (statusParam && !Object.values(PieceStatus).includes(statusParam as PieceStatus)) {
    return Response.json(
      { error: `invalid status: ${statusParam}` },
      { status: 400 },
    );
  }

  let since: Date | null = null;
  if (sinceParam) {
    since = parseSince(sinceParam);
    if (!since) {
      return Response.json({ error: `invalid since: ${sinceParam}` }, { status: 400 });
    }
  }

  const where: Prisma.PieceWhereInput = {
    ...(statusParam ? { status: statusParam as PieceStatus } : {}),
    ...(since ? { publishAt: { gte: since } } : {}),
  };

  const pieces = await prisma.piece.findMany({
    where,
    orderBy: { publishAt: "asc" },
    include: orderedImagesInclude,
  });

  return Response.json({ pieces });
}

// POST /api/pieces
// Creates a draft piece. Requires the generation bearer token. Runs the
// same claim-check the founder sees in the approval UI, and enforces the
// pillar+segment+format-per-ISO-week anti-repetition rule from
// docs/02-playbook-conteudo.md §2.
export async function POST(req: NextRequest) {
  const authError = requireGenerationToken(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = createPieceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { pillar, segment, format, caption, imagePrompt, imagePrompts, overlayText, overlayTexts, publishAt } =
    parsed.data;

  // imagePrompts (one prompt per carrossel slide) only makes sense for the
  // carrossel format — every other format drives off imagePrompt alone.
  if (imagePrompts !== undefined && format !== "carrossel") {
    return Response.json({ error: "imagePrompts só é permitido em carrossel" }, { status: 400 });
  }

  // overlayTexts (one overlay per carrossel slide) mirrors imagePrompts:
  // only makes sense for carrossel, and must pair 1:1 with imagePrompts —
  // there's nothing to pair it against on create if imagePrompts is absent.
  if (overlayTexts !== undefined) {
    if (format !== "carrossel") {
      return Response.json({ error: "overlayTexts só é permitido em carrossel" }, { status: 400 });
    }
    if (imagePrompts === undefined || overlayTexts.length !== imagePrompts.length) {
      return Response.json(
        { error: "overlayTexts deve ter o mesmo tamanho de imagePrompts" },
        { status: 400 },
      );
    }
  }

  const { ok, violations } = checkText(caption, loadRules());
  if (!ok) {
    return Response.json({ error: "caption violates forbidden claims", violations }, { status: 422 });
  }

  const { start, end } = isoWeekRange(publishAt);
  const duplicate = await prisma.piece.findFirst({
    where: {
      pillar,
      segment,
      format,
      publishAt: { gte: start, lt: end },
    },
  });
  if (duplicate) {
    return Response.json(
      {
        error: `a piece with pillar=${pillar} segment=${segment} format=${format} already exists in this ISO week`,
      },
      { status: 409 },
    );
  }

  const piece = await prisma.piece.create({
    data: {
      pillar,
      segment,
      format,
      caption,
      imagePrompt,
      imagePrompts: imagePrompts ?? [],
      overlayText: overlayText ?? null,
      overlayTexts: overlayTexts ?? [],
      publishAt,
      status: PieceStatus.draft,
      claimCheckPassed: true,
    },
    include: orderedImagesInclude,
  });

  // Kick off automated image generation in the background (never for reels,
  // which is video-only, and only when an AI image provider is configured —
  // otherwise the founder falls back to manual upload and imageGenStatus
  // just stays "idle"). enqueuePieceImageGeneration flips imageGenStatus to
  // "queued" before we respond, and schedules the actual generation with
  // next/server's `after` so it runs after this response is sent instead of
  // holding up the generation routine's POST.
  if (format !== PieceFormat.reels && isImageGenConfigured()) {
    await enqueuePieceImageGeneration(piece.id);
    piece.imageGenStatus = "queued";
  }

  // One-shot override consumed: whether or not this round was manually
  // forced (Fila "Gerar rodada agora"), a successful generation always
  // resets it so the next report/latest read goes back to computed due math.
  await setSetting("forceNextGeneration", false);

  // A new draft is work waiting on the founder, so this is the moment to
  // notify. The generation routine posts one piece per request, so a whole
  // round would fire this several times in a row — notifyPendingApproval
  // applies its own cooldown and counts the real queue depth, collapsing the
  // burst into a single "N peças aguardando aprovação". Never allowed to fail
  // the creation itself.
  await notifySafely("pending approval", notifyPendingApproval);

  return Response.json({ piece }, { status: 201 });
}
