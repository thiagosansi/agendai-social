import type { NextRequest } from "next/server";
import { PieceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireGenerationToken } from "@/lib/auth";
import { checkText, loadRules } from "@/lib/claim-check";
import { setSetting } from "@/lib/settings";
import { createPieceSchema } from "@/lib/validation";
import { isoWeekRange, parseSince } from "@/lib/iso-week";

export const runtime = "nodejs";

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

  const { pillar, segment, format, caption, imagePrompt, publishAt } = parsed.data;

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
      publishAt,
      status: PieceStatus.draft,
      claimCheckPassed: true,
    },
  });

  // One-shot override consumed: whether or not this round was manually
  // forced (Fila "Gerar rodada agora"), a successful generation always
  // resets it so the next report/latest read goes back to computed due math.
  await setSetting("forceNextGeneration", false);

  return Response.json({ piece }, { status: 201 });
}
