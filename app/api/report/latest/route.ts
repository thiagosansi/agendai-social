import type { NextRequest } from "next/server";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireGenerationToken } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

const WINDOW_MS = 8 * 7 * 24 * 60 * 60 * 1000; // 8 weeks — same window the insights cron refreshes
const WINDOW_LABEL = "8w";
const TOKEN_WARNING_DAYS = 10;
const MIN_PIECES_FOR_WORST = 2; // don't flag a combo as "worst" off a single data point
const FOLLOWERS_TREND_LIMIT = 8;

interface PieceMetricsShape {
  reach?: number;
  saved?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

interface PillarFormatRanking {
  pillar: string;
  format: string;
  pieces: number;
  avgReach: number;
  avgSaved: number;
  avgEngagement: number;
}

interface Totals {
  pieces: number;
  avgReach: number;
  avgSaved: number;
  avgEngagement: number;
}

interface FollowerSnapshot {
  capturedAt: string;
  followersCount: number;
}

// engagement = likes + comments + saved + shares, per the task brief and
// docs/02-playbook-conteudo.md §6 ("Ranquear pilares e formatos por saves +
// comentários" — extended here to include likes/shares now that the
// automated insights cron captures them too).
function engagementOf(metrics: PieceMetricsShape): number {
  return (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.saved ?? 0) + (metrics.shares ?? 0);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

// From env META_TOKEN_EXPIRES_AT (see README's env table). Independent of
// the ranking data below — this can fire even in a week with zero pieces.
function buildTokenWarning(): string | null {
  const raw = process.env.META_TOKEN_EXPIRES_AT;
  if (!raw) return "META_TOKEN_EXPIRES_AT não configurado";

  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return "META_TOKEN_EXPIRES_AT inválido — não foi possível calcular a validade";

  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return `Token Meta expirado há ${Math.abs(daysLeft)} dia(s) — renove urgentemente`;
  if (daysLeft < TOKEN_WARNING_DAYS) return `Token Meta expira em ${daysLeft} dia(s) — renove`;
  return null;
}

// Mechanical rules only, no LLM call — see task brief. Best combo by
// avgEngagement always gets one recommendation; a distinct worst combo
// (with enough data points to be meaningful) gets a second.
function buildRecommendations(ranking: PillarFormatRanking[]): string[] {
  if (ranking.length === 0) {
    return ["sem dados suficientes — siga a rotação default do playbook"];
  }

  const recommendations: string[] = [];
  const best = ranking[0];
  recommendations.push(
    `priorize ${best.pillar}+${best.format} — melhor engajamento médio no período (${best.avgEngagement}, ${best.pieces} peça(s))`,
  );

  const worstCandidates = ranking.filter((r) => r.pieces >= MIN_PIECES_FOR_WORST);
  if (worstCandidates.length > 0) {
    const worst = worstCandidates[worstCandidates.length - 1];
    if (worst.pillar !== best.pillar || worst.format !== best.format) {
      recommendations.push(
        `evite/reformule ${worst.pillar}+${worst.format} — engajamento médio mais baixo no período (${worst.avgEngagement}, ${worst.pieces} peça(s))`,
      );
    }
  }

  return recommendations;
}

function buildMarkdown(params: {
  generatedAt: string;
  window: string;
  totals: Totals;
  ranking: PillarFormatRanking[];
  followersTrend: FollowerSnapshot[];
  recommendations: string[];
  tokenWarning: string | null;
}): string {
  const { generatedAt, window, totals, ranking, followersTrend, recommendations, tokenWarning } = params;
  const lines: string[] = [];

  lines.push(`# Relatório de desempenho — últimas ${window}`);
  lines.push(`_Gerado em ${generatedAt}_`);
  lines.push("");
  lines.push(`- Peças publicadas no período: ${totals.pieces}`);
  lines.push(`- Alcance médio: ${totals.avgReach}`);
  lines.push(`- Salvos médio: ${totals.avgSaved}`);
  lines.push(`- Engajamento médio: ${totals.avgEngagement}`);
  lines.push("");

  lines.push("## Ranking pilar + formato (por engajamento médio)");
  if (ranking.length === 0) {
    lines.push("");
    lines.push("Sem peças publicadas no período.");
  } else {
    lines.push("");
    lines.push("| Pilar | Formato | Peças | Alcance médio | Salvos médio | Engajamento médio |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of ranking) {
      lines.push(`| ${r.pillar} | ${r.format} | ${r.pieces} | ${r.avgReach} | ${r.avgSaved} | ${r.avgEngagement} |`);
    }
  }
  lines.push("");

  lines.push("## Seguidores");
  if (followersTrend.length === 0) {
    lines.push("");
    lines.push("Sem snapshots registrados ainda.");
  } else {
    lines.push("");
    for (const snap of followersTrend) {
      lines.push(`- ${snap.capturedAt}: ${snap.followersCount}`);
    }
  }
  lines.push("");

  lines.push("## Recomendações");
  lines.push("");
  for (const rec of recommendations) {
    lines.push(`- ${rec}`);
  }
  if (tokenWarning) {
    lines.push("");
    lines.push(`> ⚠️ ${tokenWarning}`);
  }

  return lines.join("\n");
}

// GET /api/report/latest
// Read-only performance report over the last 8 weeks of published Pieces
// (metrics kept fresh by the weekly GET /api/cron/insights). Consumed by
// the AI generation routine ahead of each content round
// (docs/02-playbook-conteudo.md §6 — monthly ranking review) to steer
// pillar/format rotation with real data instead of guessing. Every
// recommendation here is a mechanical rule over the aggregated numbers —
// no LLM call happens in this route.
export async function GET(req: NextRequest) {
  const authError = requireGenerationToken(req);
  if (authError) return authError;

  const since = new Date(Date.now() - WINDOW_MS);

  const pieces = await prisma.piece.findMany({
    where: { status: PieceStatus.published, publishAt: { gte: since } },
    orderBy: { publishAt: "asc" },
  });

  const groups = new Map<
    string,
    { pillar: string; format: string; reach: number[]; saved: number[]; engagement: number[] }
  >();
  const allReach: number[] = [];
  const allSaved: number[] = [];
  const allEngagement: number[] = [];

  for (const piece of pieces) {
    const metrics = (piece.metrics as PieceMetricsShape | null) ?? {};
    const reach = metrics.reach ?? 0;
    const saved = metrics.saved ?? 0;
    const engagement = engagementOf(metrics);

    const key = `${piece.pillar}::${piece.format}`;
    const group = groups.get(key) ?? { pillar: piece.pillar, format: piece.format, reach: [], saved: [], engagement: [] };
    group.reach.push(reach);
    group.saved.push(saved);
    group.engagement.push(engagement);
    groups.set(key, group);

    allReach.push(reach);
    allSaved.push(saved);
    allEngagement.push(engagement);
  }

  const ranking: PillarFormatRanking[] = Array.from(groups.values())
    .map((g) => ({
      pillar: g.pillar,
      format: g.format,
      pieces: g.reach.length,
      avgReach: average(g.reach),
      avgSaved: average(g.saved),
      avgEngagement: average(g.engagement),
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  const totals: Totals = {
    pieces: pieces.length,
    avgReach: average(allReach),
    avgSaved: average(allSaved),
    avgEngagement: average(allEngagement),
  };

  const snapshots = await prisma.accountSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    take: FOLLOWERS_TREND_LIMIT,
  });
  const followersTrend: FollowerSnapshot[] = snapshots
    .slice()
    .reverse()
    .map((s) => ({ capturedAt: s.capturedAt.toISOString(), followersCount: s.followersCount }));

  const recommendations = buildRecommendations(ranking);
  const tokenWarning = buildTokenWarning();
  const generatedAt = new Date().toISOString();

  const markdown = buildMarkdown({
    generatedAt,
    window: WINDOW_LABEL,
    totals,
    ranking,
    followersTrend,
    recommendations,
    tokenWarning,
  });

  // Kill switch for the AI generation routine (Config page "Pausar geração de
  // conteúdo" toggle). This endpoint keeps computing and returning the full
  // report even when paused — the report is still useful to read — the
  // routine itself is the one that reads this flag and aborts before
  // creating any draft (so no Claude quota is spent).
  const generationPaused = await getSetting("generationPaused");

  return Response.json({
    generatedAt,
    window: WINDOW_LABEL,
    totals,
    rankingPilarFormato: ranking,
    followersTrend,
    recommendations,
    tokenWarning,
    markdown,
    generationPaused,
  });
}
