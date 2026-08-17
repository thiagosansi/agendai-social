import type { NextRequest } from "next/server";
import { PieceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireGenerationToken } from "@/lib/auth";
import { DEFAULT_GENERATION_INTERVAL_WEEKS, getCadenceConfig, getSetting, getSettingString } from "@/lib/settings";
import { buildRanking, type PillarFormatRanking, type Totals } from "@/lib/report";
import { computeGenerationDue, computeNextPublishSlots, WEEKDAY_LABELS_PT_BR } from "@/lib/generation-schedule";

export const runtime = "nodejs";

const WINDOW_MS = 8 * 7 * 24 * 60 * 60 * 1000; // 8 weeks — same window the insights cron refreshes
const WINDOW_LABEL = "8w";
const TOKEN_WARNING_DAYS = 10;
const MIN_PIECES_FOR_WORST = 2; // don't flag a combo as "worst" off a single data point
const FOLLOWERS_TREND_LIMIT = 8;

interface FollowerSnapshot {
  capturedAt: string;
  followersCount: number;
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

  const { ranking, totals } = buildRanking(pieces);

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
  const now = new Date();
  const generatedAt = now.toISOString();

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

  // Frequency gate — independent of generationPaused. intervalWeeks comes
  // from the Config page select (Controles); forceNextGeneration is the
  // one-shot override armed by the Fila "Gerar rodada agora" button
  // (POST /api/pieces clears it back to false on the next successful
  // generation — see app/api/pieces/route.ts).
  const [generationIntervalWeeksRaw, forceNextGeneration, lastPiece, cadenceConfig] = await Promise.all([
    getSettingString("generationIntervalWeeks", DEFAULT_GENERATION_INTERVAL_WEEKS),
    getSetting("forceNextGeneration"),
    prisma.piece.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    getCadenceConfig(),
  ]);
  const generationIntervalWeeks = Number(generationIntervalWeeksRaw);
  const generationDue = forceNextGeneration
    ? true
    : computeGenerationDue(lastPiece?.createdAt ?? null, generationIntervalWeeks);

  // Posting cadence (lib/settings.ts's CadenceConfig) plus precomputed
  // publish slots (lib/generation-schedule.ts's computeNextPublishSlots) —
  // the cloud generation routine (docs/rotina-geracao.md) copies
  // `nextPublishSlots` verbatim into each new Piece's `publishAt` instead of
  // doing its own timezone/weekday arithmetic. `postingWeekdayLabels` mirrors
  // `postingWeekdays` 1:1 in pt-BR so the routine never has to interpret the
  // 0=Sunday convention itself.
  const nextPublishSlots = computeNextPublishSlots(
    now,
    cadenceConfig.postingWeekdays,
    cadenceConfig.postingTime,
    cadenceConfig.piecesPerRound,
  ).map((slot) => slot.toISOString());
  const postingWeekdayLabels = cadenceConfig.postingWeekdays.map((day) => WEEKDAY_LABELS_PT_BR[day]);

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
    generationIntervalWeeks,
    generationDue,
    piecesPerRound: cadenceConfig.piecesPerRound,
    postingWeekdays: cadenceConfig.postingWeekdays,
    postingWeekdayLabels,
    postingTime: cadenceConfig.postingTime,
    postingTimezone: "America/Sao_Paulo",
    nextPublishSlots,
  });
}
