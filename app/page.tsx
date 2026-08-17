import { Inbox, CalendarClock, Send, AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { orderedImagesInclude } from "@/lib/piece-images";
import { DEFAULT_GENERATION_INTERVAL_WEEKS, getSetting, getSettingString } from "@/lib/settings";
import { computeGenerationDue } from "@/lib/generation-schedule";
import { tokenStatus } from "@/lib/meta-token";
import { formatDateSP } from "@/lib/format";
import { getSession } from "@/lib/session-server";
import {
  parseContentProposals,
  parseRecommendations,
  recommendationTypeColor,
  recommendationTypeLabel,
} from "@/lib/analysis-report-view";
import { FormatBadge } from "@/components/Badges";
import { StatCard } from "@/components/dashboard/StatCard";
import { AlertList, type DashboardAlert } from "@/components/dashboard/AlertList";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { PieceMini } from "@/components/dashboard/PieceMini";

export const dynamic = "force-dynamic";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const FREQUENCY_LABELS: Record<string, string> = {
  "1": "Semanal",
  "2": "Quinzenal",
  "3": "A cada 3 semanas",
  "4": "Mensal (4 semanas)",
};

const ALERT_LEVEL_RANK: Record<DashboardAlert["level"], number> = { red: 0, amber: 1, info: 2 };

// Strips leading markdown heading markers ("#", "##", ...) from every line
// and collapses the result to a short plain-text excerpt for the dashboard
// card — the full markdown rendering lives on /analise.
function excerptSummary(markdown: string, maxChars = 280): string {
  const plain = markdown
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, maxChars).trimEnd()}…`;
}

export default async function Home() {
  const session = await getSession();
  const isOwner = session?.role === "owner";

  const now = new Date();
  const in7Days = new Date(now.getTime() + SEVEN_DAYS_MS);

  const [
    statusCounts,
    pendingPieces,
    scheduledNext7Days,
    lastPublished,
    failedSamples,
    generationPaused,
    publishingPaused,
    generationIntervalWeeksRaw,
    forceNextGeneration,
    lastPiece,
    report,
  ] = await Promise.all([
    prisma.piece.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.piece.findMany({
      where: { status: { in: ["draft", "approved"] } },
      orderBy: { publishAt: "asc" },
      take: 3,
      include: orderedImagesInclude,
    }),
    prisma.piece.count({
      where: { status: "approved", publishAt: { gte: now, lte: in7Days } },
    }),
    prisma.piece.findMany({
      where: { status: "published" },
      orderBy: { publishAt: "desc" },
      take: 3,
      include: orderedImagesInclude,
    }),
    prisma.piece.findMany({
      where: { status: "failed" },
      orderBy: { publishAt: "desc" },
      take: 2,
      select: { id: true, pillar: true, segment: true, format: true, lastError: true, publishAt: true },
    }),
    getSetting("generationPaused"),
    getSetting("publishingPaused"),
    getSettingString("generationIntervalWeeks", DEFAULT_GENERATION_INTERVAL_WEEKS),
    getSetting("forceNextGeneration"),
    prisma.piece.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.analysisReport.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const countByStatus: Record<string, number> = {};
  for (const row of statusCounts) {
    countByStatus[row.status] = row._count._all;
  }
  const pendingCount = (countByStatus.draft ?? 0) + (countByStatus.approved ?? 0);
  const publishedCount = countByStatus.published ?? 0;
  const failedCount = countByStatus.failed ?? 0;

  const generationIntervalWeeks = Number(generationIntervalWeeksRaw);
  const generationDue = forceNextGeneration
    ? true
    : computeGenerationDue(lastPiece?.createdAt ?? null, generationIntervalWeeks);
  const frequencyLabel = FREQUENCY_LABELS[generationIntervalWeeksRaw] ?? `A cada ${generationIntervalWeeks} semana(s)`;

  // Alerts — computed server-side, hidden entirely when nothing to report.
  const alerts: DashboardAlert[] = [];

  const meta = tokenStatus(process.env.META_TOKEN_EXPIRES_AT);
  if (meta.level === "amber" || meta.level === "red") {
    alerts.push({
      level: meta.level,
      message: `Token do Instagram: ${meta.message}`,
      ...(isOwner && { href: "/config", linkLabel: "Configurações" }),
    });
  }

  const vapidMissing = !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT;
  if (vapidMissing) {
    alerts.push({
      level: "amber",
      message: "Notificações push não configuradas (VAPID ausente).",
      ...(isOwner && { href: "/config", linkLabel: "Configurações" }),
    });
  }

  if (failedCount > 0) {
    const lastError = failedSamples[0]?.lastError;
    alerts.push({
      level: "red",
      message: `${failedCount} peça(s) com falha ao publicar.${lastError ? ` Último erro: ${lastError}` : ""}`,
      href: "/publicados",
      linkLabel: "Ver publicados",
    });
  }

  if (generationPaused) {
    alerts.push({
      level: "info",
      message: "Geração de conteúdo está pausada.",
      ...(isOwner && { href: "/config", linkLabel: "Configurações" }),
    });
  }

  if (publishingPaused) {
    alerts.push({
      level: "info",
      message: "Publicação está pausada.",
      ...(isOwner && { href: "/config", linkLabel: "Configurações" }),
    });
  }

  alerts.sort((a, b) => ALERT_LEVEL_RANK[a.level] - ALERT_LEVEL_RANK[b.level]);

  const recommendations = report ? parseRecommendations(report.recommendations).slice(0, 3) : [];
  const contentProposals = report ? parseContentProposals(report.contentProposals).slice(0, 3) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6 md:max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Início</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Resumo do Agendaí Social Studio</p>
      </div>

      {alerts.length > 0 && <AlertList alerts={alerts} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Aguardando aprovação"
          value={pendingCount}
          caption="rascunhos + aprovadas"
          href="/fila"
          icon={Inbox}
        />
        <StatCard
          label="Agendadas (7 dias)"
          value={scheduledNext7Days}
          caption="aprovadas nos próximos 7 dias"
          href="/calendario"
          icon={CalendarClock}
        />
        <StatCard label="Publicadas" value={publishedCount} caption="total publicado" href="/publicados" icon={Send} />
        <StatCard
          label="Falhas"
          value={failedCount}
          caption="peças com erro de publicação"
          href="/publicados"
          icon={AlertTriangle}
        />
      </div>

      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start">
        <SectionCard title="Próximas na fila" href="/fila" linkLabel="Ver fila →">
          {pendingPieces.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
              Nenhuma peça aguardando.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {pendingPieces.map((piece) => (
                <PieceMini
                  key={piece.id}
                  variant="pending"
                  piece={{
                    id: piece.id,
                    pillar: piece.pillar,
                    segment: piece.segment,
                    format: piece.format,
                    status: piece.status,
                    publishAt: piece.publishAt,
                    coverImageUrl: piece.images[0]?.url ?? null,
                  }}
                />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Últimas publicadas" href="/publicados" linkLabel="Ver publicados →">
          {lastPublished.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
              Nenhuma peça publicada ainda.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {lastPublished.map((piece) => (
                <PieceMini
                  key={piece.id}
                  variant="published"
                  piece={{
                    id: piece.id,
                    pillar: piece.pillar,
                    segment: piece.segment,
                    format: piece.format,
                    status: piece.status,
                    publishAt: piece.publishAt,
                    coverImageUrl: piece.images[0]?.url ?? null,
                    metrics: piece.metrics,
                  }}
                />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Rotinas" {...(isOwner && { href: "/config", linkLabel: "Configurações →" })}>
          <ul className="flex flex-col gap-3 text-sm">
            <li className="rounded-md bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-800">Geração de conteúdo</span>
                <span className={generationPaused ? "text-red-600" : "text-green-700"}>
                  {generationPaused ? "Pausada" : "Ativa"}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Frequência: {frequencyLabel}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Próxima rodada: {generationDue ? "devida agora" : "dentro do prazo"}
              </p>
            </li>
            <li className="rounded-md bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-800">Publicação</span>
                <span className={publishingPaused ? "text-red-600" : "text-green-700"}>
                  {publishingPaused ? "Pausada" : "Ativa"}
                </span>
              </div>
            </li>
            <li className="rounded-md bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-800">Última análise</span>
                <span className="text-zinc-600">{report ? formatDateSP(report.createdAt) : "nenhuma ainda"}</span>
              </div>
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="Análise" href="/analise" linkLabel="Ver análise completa →">
          {!report ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
              A rotina mensal ainda não gerou uma análise.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-700">{excerptSummary(report.summaryMarkdown)}</p>

              {recommendations.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {recommendations.map((rec, idx) => (
                    <li key={idx} className="flex flex-wrap items-start gap-1.5 text-xs">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${recommendationTypeColor(rec.type)}`}
                      >
                        {recommendationTypeLabel(rec.type)}
                      </span>
                      <span className="text-zinc-700">{rec.text}</span>
                    </li>
                  ))}
                </ul>
              )}

              {contentProposals.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {contentProposals.map((proposal, idx) => (
                    <li key={idx} className="rounded-md bg-zinc-50 p-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                        <FormatBadge format={proposal.format} />
                        <span>
                          {proposal.pillar} · {proposal.segment}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-zinc-800">{proposal.hook}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
