import type { NextRequest } from "next/server";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAnalysisOrGenerationToken } from "@/lib/auth";
import { parseSince } from "@/lib/iso-week";
import { SETTLING_WINDOW_MS } from "@/lib/cron-insights";
import { buildRanking } from "@/lib/report";

export const runtime = "nodejs";

const DEFAULT_SINCE = "8w";

// GET /api/analysis/source?since=8w
//
// Read-only data source for the (cloud-scheduled) monthly analysis
// routine. That routine must NEVER hold META_IG_TOKEN — only this app
// talks to the Instagram Graph API, via the weekly insights cron
// (lib/cron-insights.ts) that merges results into Piece.metrics and
// records AccountSnapshot rows. This endpoint hands the routine exactly
// the metrics the app already collected — per-piece reach/saved/likes/
// comments/shares/views/navigation/plays, plus account-level followers —
// so it can build its analysis without ever touching Meta credentials.
export async function GET(req: NextRequest) {
  const authError = requireAnalysisOrGenerationToken(req);
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const sinceParam = searchParams.get("since") ?? DEFAULT_SINCE;
  const since = parseSince(sinceParam);
  if (!since) {
    return Response.json({ error: `invalid since: ${sinceParam}` }, { status: 400 });
  }

  const pieces = await prisma.piece.findMany({
    where: { status: PieceStatus.published, publishAt: { gte: since } },
    orderBy: { publishAt: "asc" },
  });

  const now = Date.now();
  const piecesPayload = pieces.map((piece) => ({
    id: piece.id,
    pillar: piece.pillar,
    segment: piece.segment,
    format: piece.format,
    caption: piece.caption,
    publishAt: piece.publishAt.toISOString(),
    igPermalink: piece.igPermalink,
    metrics: piece.metrics,
    settling: now - piece.publishAt.getTime() < SETTLING_WINDOW_MS,
  }));

  const snapshots = await prisma.accountSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: "asc" },
  });
  const followersTrend = snapshots.map((snapshot) => ({
    capturedAt: snapshot.capturedAt.toISOString(),
    followersCount: snapshot.followersCount,
  }));

  const { ranking, totals } = buildRanking(pieces);

  return Response.json({
    generatedAt: new Date().toISOString(),
    window: { since: since.toISOString(), label: sinceParam },
    pieces: piecesPayload,
    followersTrend,
    rankingPilarFormato: ranking,
    totals,
  });
}
