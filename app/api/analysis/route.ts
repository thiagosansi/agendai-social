import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnalysisToken } from "@/lib/auth";
import { checkText, loadRules } from "@/lib/claim-check";
import { createAnalysisReportSchema } from "@/lib/validation";

export const runtime = "nodejs";

// POST /api/analysis
// Creates an AnalysisReport — a periodic (or on-demand) AI-generated review
// of recent performance, stored so the generation routine can pull the
// latest one via GET /api/analysis/latest ahead of its next round. Requires
// ANALYSIS_API_TOKEN.
export async function POST(req: NextRequest) {
  const authError = requireAnalysisToken(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = createAnalysisReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { periodStart, periodEnd, summaryMarkdown, insights, recommendations, contentProposals, schemaVersion } =
    parsed.data;

  // schemaVersion 2 only — every contentProposal's captionDraft goes through
  // the same forbidden-claims check as a Piece's caption (see
  // app/api/pieces/route.ts). First violation aborts the whole request so a
  // bad proposal never gets persisted alongside good ones.
  if (contentProposals) {
    const rules = loadRules();
    for (let i = 0; i < contentProposals.length; i++) {
      const { ok, violations } = checkText(contentProposals[i].captionDraft, rules);
      if (!ok) {
        return Response.json(
          { error: "captionDraft violates forbidden claims", proposalIndex: i, violations },
          { status: 422 },
        );
      }
    }
  }

  const report = await prisma.analysisReport.create({
    data: {
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      summaryMarkdown,
      insights,
      recommendations,
      contentProposals: contentProposals ?? undefined,
      schemaVersion,
    },
  });

  return Response.json({ report }, { status: 201 });
}
