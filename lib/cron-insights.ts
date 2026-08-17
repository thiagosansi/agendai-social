import { PieceFormat, PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  InstagramApiError,
  getAccountInfo,
  getMediaInsights,
  type MediaInsights,
  type MediaProductType,
} from "@/lib/instagram";

const INSIGHTS_WINDOW_MS = 8 * 7 * 24 * 60 * 60 * 1000; // 8 weeks — same lookback as GET /api/report/latest

// metrics are still settling right after publish — exported so
// GET /api/analysis/source can flag freshly-published pieces the same way
// this cron does, without duplicating the constant.
export const SETTLING_WINDOW_MS = 48 * 60 * 60 * 1000;

// Maps a Piece.format to the Graph API media_product_type insights need —
// mirrors resolveContainerKind in lib/cron-publish.ts, but for
// reads instead of the publish container type.
function mediaProductTypeFor(format: PieceFormat): MediaProductType {
  switch (format) {
    case PieceFormat.stories:
      return "STORY";
    case PieceFormat.reels:
      return "REELS";
    case PieceFormat.estatico:
    case PieceFormat.carrossel:
    default:
      return "FEED";
  }
}

interface InsightsResult {
  id: string;
  outcome: "updated" | "skipped";
  reason?: string;
  metrics?: MediaInsights;
}

export interface InsightsPayload {
  updated: number;
  skipped: number;
  snapshot: { followersCount: number } | null;
  results: InsightsResult[];
}

// For every published Piece from the last 8 weeks with an igMediaId, fetches
// Instagram insights and merges them into Piece.metrics (preserving any fields
// already there — e.g. a manually entered metric from before this cron existed).
// Also records one AccountSnapshot (follower count) per run.
//
// Same error-isolation pattern as the publish cron: a single piece's Meta API
// failure is caught and only skips that piece — it never aborts the run.
//
// If Meta credentials aren't configured, returns early with a skipped result.
export async function runInsights(): Promise<InsightsPayload> {
  // No Meta credentials configured — nothing to do, but this must not read
  // as a cron failure.
  if (!process.env.META_IG_USER_ID || !process.env.META_IG_TOKEN) {
    return { updated: 0, skipped: 1, snapshot: null, results: [] };
  }

  const now = Date.now();
  const since = new Date(now - INSIGHTS_WINDOW_MS);

  const pieces = await prisma.piece.findMany({
    where: {
      status: PieceStatus.published,
      igMediaId: { not: null },
      publishAt: { gte: since },
    },
    orderBy: { publishAt: "desc" },
  });

  const results: InsightsResult[] = [];
  let updated = 0;
  let skipped = 0;

  for (const piece of pieces) {
    if (now - piece.publishAt.getTime() < SETTLING_WINDOW_MS) {
      skipped += 1;
      results.push({
        id: piece.id,
        outcome: "skipped",
        reason: "publicado há menos de 48h — métricas ainda assentando",
      });
      continue;
    }

    try {
      const mediaProductType = mediaProductTypeFor(piece.format);
      const insights = await getMediaInsights(piece.igMediaId as string, mediaProductType);

      const previous = (piece.metrics as Record<string, unknown> | null) ?? {};
      const merged = {
        ...previous,
        ...insights,
        fetchedAt: new Date().toISOString(),
      };

      await prisma.piece.update({ where: { id: piece.id }, data: { metrics: merged } });
      updated += 1;
      results.push({ id: piece.id, outcome: "updated", metrics: insights });
    } catch (error) {
      skipped += 1;
      const message =
        error instanceof InstagramApiError
          ? error.toActionableMessage()
          : error instanceof Error
            ? error.message
            : String(error);
      results.push({ id: piece.id, outcome: "skipped", reason: message });
    }
  }

  // One account-level snapshot per run, independent of how many (if any)
  // pieces were updated above — followersTrend in GET /api/report/latest
  // needs a steady cadence even during weeks with nothing to publish.
  let snapshot: { followersCount: number } | null = null;
  try {
    const { followersCount } = await getAccountInfo();
    if (followersCount !== null) {
      await prisma.accountSnapshot.create({ data: { followersCount } });
      snapshot = { followersCount };
    }
  } catch {
    // A transient account-info failure must not fail the whole run — the
    // per-piece metrics fetched above are still valid and already saved.
  }

  return { updated, skipped, snapshot, results };
}
