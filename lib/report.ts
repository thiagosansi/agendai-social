// Shared pillar+format engagement ranking logic — extracted from
// app/api/report/latest/route.ts so GET /api/analysis/source can reuse the
// exact same numbers (same grouping, same averaging, same sort order)
// without duplicating them. Behavior here must stay byte-for-byte
// identical to what report/latest returned before this extraction.

export interface PieceMetricsShape {
  reach?: number;
  saved?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface PillarFormatRanking {
  pillar: string;
  format: string;
  pieces: number;
  avgReach: number;
  avgSaved: number;
  avgEngagement: number;
}

export interface Totals {
  pieces: number;
  avgReach: number;
  avgSaved: number;
  avgEngagement: number;
}

// engagement = likes + comments + saved + shares, per the task brief and
// docs/02-playbook-conteudo.md §6 ("Ranquear pilares e formatos por saves +
// comentários" — extended here to include likes/shares now that the
// automated insights cron captures them too).
export function engagementOf(metrics: PieceMetricsShape): number {
  return (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.saved ?? 0) + (metrics.shares ?? 0);
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

interface RankablePiece {
  pillar: string;
  format: string;
  metrics: unknown;
}

// Groups pieces by `${pillar}::${format}`, averages reach/saved/engagement
// per group, and sorts the resulting ranking descending by avgEngagement.
// Also returns totals across every piece passed in. Callers filter pieces
// (status/window) before calling this — buildRanking itself does no
// filtering.
export function buildRanking(pieces: RankablePiece[]): { ranking: PillarFormatRanking[]; totals: Totals } {
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

  return { ranking, totals };
}
