#!/usr/bin/env node
// Fixture + smoke check for GET /api/report/latest (app/api/report/latest/
// route.ts). Seeds a handful of already-published Pieces (with fake
// igMediaId + baked-in metrics, across different pillar/format combos) and
// two AccountSnapshot rows directly via Prisma — there's no API for
// creating a piece already in the `published` state with metrics, that's
// exclusively the daily publish + weekly insights crons' job — then hits
// the report endpoint against a locally running dev server and
// pretty-prints the result. Every row it creates is deleted again in a
// `finally` block, tagged so cleanup never touches real data:
//   - Pieces: caption starts with "[fixture]".
//   - AccountSnapshots: no natural tag, so cleanup deletes by the exact ids
//     this run created (tracked below), never by a heuristic.
//
// Usage: PORT=3030 pnpm dev   (in one terminal)
//        pnpm report:fixture  (in another)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

// Minimal .env reader (no dotenv dependency in this project, same pattern
// as scripts/publish-dry-run.mjs) — only used as a fallback when the
// variable isn't already set in the shell environment.
function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (!match) return undefined;
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const PORT = process.env.PORT || 3030;
const BASE_URL = `http://localhost:${PORT}`;
const GENERATION_API_TOKEN = readEnvValue("GENERATION_API_TOKEN");
const FIXTURE_TAG = "[fixture]";

const now = Date.now();
const weeksAgo = (n) => new Date(now - n * 7 * 24 * 60 * 60 * 1000);

// Deliberately spans 3 pillar+format combos with a clear best (highest
// avg engagement = likes+comments+saved+shares) and worst, so
// buildRecommendations() in the report route has real signal to react to.
const FIXTURE_PIECES = [
  {
    pillar: "dor-mecanica",
    segment: "salao-barbearia",
    format: "estatico",
    publishAt: weeksAgo(2),
    metrics: { reach: 1200, saved: 80, likes: 150, comments: 20, shares: 10 },
  },
  {
    pillar: "dor-mecanica",
    segment: "salao-barbearia",
    format: "estatico",
    publishAt: weeksAgo(3),
    metrics: { reach: 1000, saved: 60, likes: 120, comments: 15, shares: 5 },
  },
  {
    pillar: "educacao-gestao",
    segment: "spa-massoterapia",
    format: "carrossel",
    publishAt: weeksAgo(1),
    metrics: { reach: 800, saved: 40, likes: 60, comments: 10, shares: 2 },
  },
  {
    pillar: "educacao-gestao",
    segment: "spa-massoterapia",
    format: "carrossel",
    publishAt: weeksAgo(4),
    metrics: { reach: 700, saved: 30, likes: 50, comments: 5, shares: 1 },
  },
  {
    pillar: "equipe",
    segment: "studio-unha-cilio-sobrancelha",
    format: "stories",
    publishAt: weeksAgo(1),
    metrics: { reach: 300, saved: 5, likes: 10, comments: 1, shares: 0 },
  },
  {
    pillar: "equipe",
    segment: "studio-unha-cilio-sobrancelha",
    format: "stories",
    publishAt: weeksAgo(2),
    metrics: { reach: 250, saved: 3, likes: 8, comments: 0, shares: 0 },
  },
];

const FIXTURE_SNAPSHOTS = [
  { capturedAt: weeksAgo(2), followersCount: 500 },
  { capturedAt: weeksAgo(1), followersCount: 520 },
];

async function main() {
  if (!GENERATION_API_TOKEN) {
    console.error("GENERATION_API_TOKEN is not set (checked process.env and .env) — cannot call the report endpoint.");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const createdPieceIds = [];
  const createdSnapshotIds = [];
  let exitCode = 0;

  try {
    for (const [index, fixture] of FIXTURE_PIECES.entries()) {
      const piece = await prisma.piece.create({
        data: {
          pillar: fixture.pillar,
          segment: fixture.segment,
          format: fixture.format,
          caption: `${FIXTURE_TAG} peça de teste #${index + 1} para report/latest`,
          imagePrompt: `${FIXTURE_TAG} imagem de teste`,
          publishAt: fixture.publishAt,
          status: "published",
          claimCheckPassed: true,
          igMediaId: `fixture-media-${index + 1}`,
          metrics: { ...fixture.metrics, fetchedAt: new Date().toISOString() },
        },
      });
      createdPieceIds.push(piece.id);
    }

    for (const snapshot of FIXTURE_SNAPSHOTS) {
      const created = await prisma.accountSnapshot.create({
        data: { capturedAt: snapshot.capturedAt, followersCount: snapshot.followersCount },
      });
      createdSnapshotIds.push(created.id);
    }

    console.log(
      `Seeded ${createdPieceIds.length} fixture piece(s) and ${createdSnapshotIds.length} fixture snapshot(s).\n`,
    );

    const res = await fetch(`${BASE_URL}/api/report/latest`, {
      headers: { authorization: `Bearer ${GENERATION_API_TOKEN}` },
    });
    const body = await res.json().catch(() => null);

    console.log(`GET /api/report/latest -> ${res.status}\n`);
    console.log(JSON.stringify(body, null, 2));

    if (!res.ok) {
      exitCode = 1;
    } else {
      const ranking = body?.rankingPilarFormato ?? [];
      const recommendations = body?.recommendations ?? [];
      if (ranking.length === 0) {
        console.error("\nFAIL - expected rankingPilarFormato to include the fixture data, got an empty array.");
        exitCode = 1;
      } else {
        console.log(`\nok - ranking has ${ranking.length} pilar+formato combo(s)`);
      }
      if (recommendations.length === 0) {
        console.error("FAIL - expected at least one recommendation.");
        exitCode = 1;
      } else {
        console.log(`ok - ${recommendations.length} recommendation(s) generated`);
      }
    }
  } catch (error) {
    console.error("insights-fixture crashed:", error);
    exitCode = 1;
  } finally {
    // Only ever delete the exact rows this run created — never a broader
    // "delete anything tagged [fixture]" sweep, so a concurrent run (or a
    // crash before creation finished) can't cause cross-run deletions.
    if (createdPieceIds.length > 0) {
      await prisma.piece.deleteMany({ where: { id: { in: createdPieceIds } } });
    }
    if (createdSnapshotIds.length > 0) {
      await prisma.accountSnapshot.deleteMany({ where: { id: { in: createdSnapshotIds } } });
    }
    console.log(
      `\nCleaned up ${createdPieceIds.length} fixture piece(s) and ${createdSnapshotIds.length} fixture snapshot(s).`,
    );
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

main();
