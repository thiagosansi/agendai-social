import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnalysisOrGenerationToken } from "@/lib/auth";
import { runMarketScan } from "@/lib/market-scan";

export const runtime = "nodejs";

// GET /api/analysis/market?fresh=1
//
// App-mediated Instagram market scan for the (cloud-scheduled) monthly
// analysis routine — that routine must NEVER hold META_IG_TOKEN, so this
// route is the only thing that talks to Business Discovery / hashtag
// search on its behalf (mirrors GET /api/analysis/source's mediation of
// performance data). Meta caps hashtag search at 30 unique hashtags per 7
// days per connected account; this route tracks unique hashtags queried
// over the trailing 7 days and stops new hashtag lookups at a 25-hashtag
// safety margin (returning `{skipped:"quota"}` for the rest) rather than
// risking a hard Graph API rejection. Every scanned caption is sanitized
// (URLs/@mentions stripped, truncated to 220 chars) and claim-checked
// against docs/promessas-proibidas.json before it ever leaves the app.
//
// Results are cached in MarketSnapshot for 7 days by default — repeated
// calls (e.g. the routine polling ahead of its schedule) reuse the latest
// snapshot instead of re-hitting Graph. Pass `?fresh=1` to force a new
// scan (still subject to the hashtag quota guard).
const SNAPSHOT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const HASHTAG_QUOTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HASHTAG_QUOTA_LIMIT = 30;
const HASHTAG_QUOTA_SAFETY_LIMIT = 25;

export async function GET(req: NextRequest) {
  const authError = requireAnalysisOrGenerationToken(req);
  if (authError) return authError;

  const forceFresh = req.nextUrl.searchParams.get("fresh") === "1";

  const latest = await prisma.marketSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
  const isFresh = !!latest && Date.now() - latest.createdAt.getTime() < SNAPSHOT_CACHE_MS;

  if (latest && isFresh && !forceFresh) {
    return Response.json({
      snapshotId: latest.id,
      createdAt: latest.createdAt,
      cached: true,
      competitors: latest.competitors,
      hashtags: latest.hashtags,
      errors: latest.errors,
    });
  }

  // Computed BEFORE the new scan runs (and thus before it persists a new
  // MarketSnapshot row), so the snapshot being created is never counted
  // against its own quota.
  const sevenDaysAgo = new Date(Date.now() - HASHTAG_QUOTA_WINDOW_MS);
  const recentSnapshots = await prisma.marketSnapshot.findMany({
    where: { createdAt: { gte: sevenDaysAgo } },
    select: { hashtagsQueried: true },
  });
  const uniqueHashtagsLast7d = new Set(recentSnapshots.flatMap((s) => s.hashtagsQueried)).size;
  const hashtagBudgetRemaining = Math.max(0, HASHTAG_QUOTA_SAFETY_LIMIT - uniqueHashtagsLast7d);

  const result = await runMarketScan({ hashtagBudgetRemaining });

  if ("unavailable" in result || "empty" in result) {
    return Response.json(result);
  }

  return Response.json({
    snapshotId: result.snapshotId,
    createdAt: result.createdAt,
    cached: false,
    competitors: result.competitors,
    hashtags: result.hashtags,
    errors: result.errors,
    quota: {
      uniqueHashtagsLast7d,
      limit: HASHTAG_QUOTA_LIMIT,
      safetyLimit: HASHTAG_QUOTA_SAFETY_LIMIT,
    },
  });
}
