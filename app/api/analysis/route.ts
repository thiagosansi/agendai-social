import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnalysisToken } from "@/lib/auth";
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

  const { periodStart, periodEnd, summaryMarkdown, insights, recommendations, schemaVersion } = parsed.data;

  const report = await prisma.analysisReport.create({
    data: {
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      summaryMarkdown,
      insights,
      recommendations,
      schemaVersion,
    },
  });

  return Response.json({ report }, { status: 201 });
}
