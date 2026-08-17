import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnalysisOrGenerationToken } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/analysis/latest
// Returns the most recently created AnalysisReport. Read by both the
// analysis routine (to avoid re-generating) and the piece-generation
// routine (to steer the next round), so it accepts either
// ANALYSIS_API_TOKEN or GENERATION_API_TOKEN.
export async function GET(req: NextRequest) {
  const authError = requireAnalysisOrGenerationToken(req);
  if (authError) return authError;

  const report = await prisma.analysisReport.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!report) {
    return Response.json({ error: "no analysis report yet" }, { status: 404 });
  }

  return Response.json({ report });
}
