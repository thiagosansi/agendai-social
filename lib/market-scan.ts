// Orchestrates the app-mediated Instagram market scan consumed by
// GET /api/analysis/market — see that route for the caching/quota
// wrapper. This module owns the actual Graph fetch + per-item error
// isolation + caption sanitization + claim-check, so a single competitor
// or hashtag failing (private account, rate limit, hashtag not found)
// never aborts the rest of the scan.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMarketConfig } from "@/lib/settings";
import { checkText, loadRules } from "@/lib/claim-check";
import { average } from "@/lib/report";
import {
  hasInstagramCredentials,
  getBusinessDiscovery,
  getHashtagTopMedia,
  InstagramApiError,
  type BusinessDiscoveryMedia,
  type HashtagMediaItem,
} from "@/lib/instagram";

// Cap applied to every sanitized caption before it ever leaves the app —
// keeps the market scan payload compact and avoids echoing long
// promotional copy verbatim.
const DEFAULT_CAPTION_MAX_LENGTH = 220;

// Business Discovery / hashtag top-media results are capped by Graph
// itself (12/15 respectively); we additionally keep only the top 5 by
// engagement per competitor so the response stays focused on what
// actually performed well.
const TOP_POSTS_PER_COMPETITOR = 5;

export interface MarketScanPost {
  caption: string | null;
  likeCount: number;
  commentsCount: number;
  mediaType: string;
  mediaProductType?: string;
  timestamp: string;
  permalink: string;
  // Violated claim-check rule ids only (see docs/promessas-proibidas.json) —
  // empty array means the sanitized caption passed the check.
  forbiddenClaimHits: string[];
}

export interface CompetitorScan {
  username: string;
  followersCount: number;
  mediaCount: number;
  avgLikes: number;
  avgComments: number;
  topPosts: MarketScanPost[];
}

export interface HashtagScan {
  tag: string;
  hashtagId?: string;
  skipped?: "quota";
  topPosts?: MarketScanPost[];
}

export interface MarketScanError {
  item: string;
  kind: "competitor" | "hashtag";
  code?: number;
  message: string;
}

export type MarketScanOutcome =
  | { unavailable: true; reason: string }
  | { empty: true }
  | {
      snapshotId: string;
      createdAt: Date;
      competitors: CompetitorScan[];
      hashtags: HashtagScan[];
      hashtagsQueried: string[];
      errors: MarketScanError[];
    };

// Matches http(s):// URLs and bare www. URLs — both are stripped entirely
// (not just the scheme) since a dangling "www.site.com" is still a link.
const URL_PATTERN = /(https?:\/\/\S+)|(\bwww\.\S+)/gi;
const MENTION_PATTERN = /@\w+/g;
const WHITESPACE_PATTERN = /\s+/g;

// Truncating in the middle of a surrogate pair would emit a lone high
// surrogate — invalid UTF-8 that can break the JSONB insert or the JSON
// response — so drop the dangling half when the cut lands inside an
// astral character (emoji are common in Instagram captions).
function sliceWithoutSplittingSurrogate(value: string, limit: number): string {
  const sliced = value.slice(0, limit);
  const lastCharCode = sliced.charCodeAt(sliced.length - 1);
  const isHighSurrogate = lastCharCode >= 0xd800 && lastCharCode <= 0xdbff;
  return isHighSurrogate ? sliced.slice(0, -1) : sliced;
}

/**
 * Pure, no-I/O caption cleanup applied before a caption ever leaves this
 * app: strips URLs and @mentions, collapses whitespace (including
 * newlines), trims, and truncates to `max` chars (default 220) with a
 * trailing ellipsis so the final string length never exceeds `max`. When
 * the cut would split a surrogate pair, the dangling half is dropped too
 * (see sliceWithoutSplittingSurrogate) — the result can then be `max - 1`
 * chars instead of exactly `max`, which is still within the "<= max" bound.
 */
export function sanitizeCaption(raw: string | null, max: number = DEFAULT_CAPTION_MAX_LENGTH): string | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(URL_PATTERN, " ")
    .replace(MENTION_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  return `${sliceWithoutSplittingSurrogate(cleaned, max - 1)}…`;
}

function toScanPost(
  raw: BusinessDiscoveryMedia | HashtagMediaItem,
  rules: ReturnType<typeof loadRules>,
): MarketScanPost {
  const caption = sanitizeCaption(raw.caption);
  const { violations } = checkText(caption ?? "", rules);
  return {
    caption,
    likeCount: raw.likeCount,
    commentsCount: raw.commentsCount,
    mediaType: raw.mediaType,
    mediaProductType: "mediaProductType" in raw ? raw.mediaProductType : undefined,
    timestamp: raw.timestamp,
    permalink: raw.permalink,
    forbiddenClaimHits: violations.map((v) => v.id),
  };
}

function toErrorEntry(err: unknown, item: string, kind: MarketScanError["kind"]): MarketScanError {
  return {
    item,
    kind,
    code: err instanceof InstagramApiError ? err.code : undefined,
    message:
      err instanceof InstagramApiError
        ? err.toActionableMessage()
        : err instanceof Error
          ? err.message
          : String(err),
  };
}

/**
 * Runs the market scan: Business Discovery for each configured competitor
 * and top-media for each configured hashtag, isolating failures per item
 * and respecting `hashtagBudgetRemaining` (a decrementing counter of how
 * many NEW hashtag lookups are still allowed under Meta's 30-unique/7-day
 * cap — see GET /api/analysis/market for how it's computed).
 */
export async function runMarketScan(options: {
  hashtagBudgetRemaining: number;
}): Promise<MarketScanOutcome> {
  const { competitors, hashtags } = await getMarketConfig();

  if (competitors.length === 0 && hashtags.length === 0) {
    return { empty: true };
  }

  if (!hasInstagramCredentials()) {
    return {
      unavailable: true,
      reason: "Credenciais Meta não configuradas (META_IG_USER_ID/META_IG_TOKEN).",
    };
  }

  const rules = loadRules();
  const errors: MarketScanError[] = [];

  const competitorScans: CompetitorScan[] = [];
  for (const username of competitors) {
    try {
      const discovery = await getBusinessDiscovery(username);
      const posts = discovery.media.map((item) => toScanPost(item, rules));
      const topPosts = [...posts]
        .sort((a, b) => b.likeCount + b.commentsCount - (a.likeCount + a.commentsCount))
        .slice(0, TOP_POSTS_PER_COMPETITOR);

      competitorScans.push({
        username: discovery.username,
        followersCount: discovery.followersCount,
        mediaCount: discovery.mediaCount,
        avgLikes: average(posts.map((p) => p.likeCount)),
        avgComments: average(posts.map((p) => p.commentsCount)),
        topPosts,
      });
    } catch (err) {
      errors.push(toErrorEntry(err, username, "competitor"));
    }
  }

  let hashtagBudgetRemaining = options.hashtagBudgetRemaining;
  const hashtagScans: HashtagScan[] = [];
  const hashtagsQueried: string[] = [];
  for (const tag of hashtags) {
    if (hashtagBudgetRemaining <= 0) {
      hashtagScans.push({ tag, skipped: "quota" });
      continue;
    }

    // Consumed only when the Graph call is actually attempted — an
    // attempted-but-failed lookup still counted against Meta's quota, so
    // it must still be recorded in hashtagsQueried.
    hashtagBudgetRemaining -= 1;
    hashtagsQueried.push(tag);

    try {
      const result = await getHashtagTopMedia(tag);
      hashtagScans.push({
        tag: result.tag,
        hashtagId: result.hashtagId,
        topPosts: result.media.map((item) => toScanPost(item, rules)),
      });
    } catch (err) {
      errors.push(toErrorEntry(err, tag, "hashtag"));
    }
  }

  const snapshot = await prisma.marketSnapshot.create({
    data: {
      competitors: competitorScans as unknown as Prisma.InputJsonValue,
      hashtags: hashtagScans as unknown as Prisma.InputJsonValue,
      hashtagsQueried,
      errors: errors as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    snapshotId: snapshot.id,
    createdAt: snapshot.createdAt,
    competitors: competitorScans,
    hashtags: hashtagScans,
    hashtagsQueried,
    errors,
  };
}
