export type Recommendation = {
  type: "promote" | "avoid" | "test" | "caption" | "image";
  text: string;
  evidence?: string;
  priority?: 0 | 1 | 2;
};

// schemaVersion 2 only — insights.market and root-level contentProposals
// (see lib/validation.ts's analysisInsightsSchema/contentProposalSchema).
export type MarketCompetitor = {
  username: string;
  followers: number;
  avgLikes: number;
  avgComments: number;
  themes: string[];
  topPosts: { permalink: string; likes: number; comments: number; hookType: string }[];
};

export type MarketHashtag = {
  tag: string;
  themes: string[];
  samplePermalinks: string[];
};

export type MarketWebTrend = {
  title: string;
  url: string;
  takeaway: string;
};

export type Market = {
  competitors: MarketCompetitor[];
  hashtags: MarketHashtag[];
  webTrends: MarketWebTrend[];
};

export type ContentProposal = {
  pillar: string;
  segment: string;
  format: string;
  hook: string;
  captionDraft: string;
  imagePrompt: string;
  rationale?: string;
  sources?: string[];
};

export function isValidMarket(data: unknown): data is Market {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.competitors) && Array.isArray(obj.hashtags) && Array.isArray(obj.webTrends);
}

export function parseMarket(insights: unknown): Market | null {
  if (typeof insights !== "object" || insights === null) return null;
  const market = (insights as Record<string, unknown>).market;
  return isValidMarket(market) ? market : null;
}

export function isValidContentProposal(data: unknown): data is ContentProposal {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.pillar === "string" &&
    typeof obj.segment === "string" &&
    typeof obj.format === "string" &&
    typeof obj.hook === "string" &&
    typeof obj.captionDraft === "string" &&
    typeof obj.imagePrompt === "string"
  );
}

export function parseContentProposals(json: unknown): ContentProposal[] {
  if (!Array.isArray(json)) return [];
  return json.filter(isValidContentProposal);
}

export function isValidRecommendation(data: unknown): data is Recommendation {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.type === "string" &&
    typeof obj.text === "string" &&
    ["promote", "avoid", "test", "caption", "image"].includes(obj.type as string)
  );
}

export function parseRecommendations(json: unknown): Recommendation[] {
  if (!Array.isArray(json)) return [];
  return json.filter(isValidRecommendation);
}

export function recommendationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    promote: "Priorizar",
    avoid: "Evitar",
    test: "Testar",
    caption: "Legenda",
    image: "Imagem",
  };
  return labels[type] || type;
}

export function recommendationTypeColor(
  type: string,
): "bg-emerald-100 text-emerald-800" | "bg-amber-100 text-amber-800" | "bg-zinc-100 text-zinc-800" {
  switch (type) {
    case "promote":
      return "bg-emerald-100 text-emerald-800";
    case "avoid":
      return "bg-amber-100 text-amber-800";
    case "test":
    case "caption":
    case "image":
    default:
      return "bg-zinc-100 text-zinc-800";
  }
}

export function priorityLabel(priority: number | undefined): string {
  switch (priority) {
    case 2:
      return "Alta";
    case 1:
      return "Média";
    case 0:
      return "Baixa";
    default:
      return "—";
  }
}
