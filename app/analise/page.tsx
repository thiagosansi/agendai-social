import { prisma } from "@/lib/prisma";
import { formatDateTimeSP } from "@/lib/format";

export const dynamic = "force-dynamic";

type Recommendation = {
  type: "promote" | "avoid" | "test" | "caption" | "image";
  text: string;
  evidence?: string;
  priority?: 0 | 1 | 2;
};

function isValidRecommendation(data: unknown): data is Recommendation {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.type === "string" &&
    typeof obj.text === "string" &&
    ["promote", "avoid", "test", "caption", "image"].includes(obj.type as string)
  );
}

function parseRecommendations(json: unknown): Recommendation[] {
  if (!Array.isArray(json)) return [];
  return json.filter(isValidRecommendation);
}

function recommendationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    promote: "Priorizar",
    avoid: "Evitar",
    test: "Testar",
    caption: "Legenda",
    image: "Imagem",
  };
  return labels[type] || type;
}

function recommendationTypeColor(
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

function priorityLabel(priority: number | undefined): string {
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

export default async function AnalysePage() {
  const report = await prisma.analysisReport.findFirst({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6">
      <h1 className="text-xl font-semibold text-zinc-900">Análise de desempenho</h1>

      {!report ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Nenhuma análise registrada ainda. A rotina mensal de análise cria o primeiro relatório —
          ver docs/rotina-analise.md.
        </div>
      ) : (
        <>
          {/* Meta line */}
          <div className="text-xs text-zinc-500">
            Período: {formatDateTimeSP(report.periodStart)} –{" "}
            {formatDateTimeSP(report.periodEnd)} · gerado em{" "}
            {formatDateTimeSP(report.createdAt)} · fonte: {report.source}
          </div>

          {/* Summary section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-medium text-zinc-900">Resumo</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-800">
              {report.summaryMarkdown}
            </div>
          </section>

          {/* Recommendations section */}
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-medium text-zinc-900">Recomendações</h2>
            {(() => {
              const recommendations = parseRecommendations(report.recommendations);
              return recommendations.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">
                  Sem recomendações neste relatório.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {recommendations.map((rec, idx) => (
                    <li key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${recommendationTypeColor(rec.type)}`}
                        >
                          {recommendationTypeLabel(rec.type)}
                        </span>
                        <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
                          Prioridade: {priorityLabel(rec.priority)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-zinc-800">{rec.text}</p>
                      {rec.evidence && (
                        <p className="mt-1 text-xs text-zinc-500">Evidência: {rec.evidence}</p>
                      )}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </section>

          {/* Insights details (collapsed) */}
          <details className="rounded-lg border border-zinc-200 bg-white">
            <summary className="cursor-pointer p-4 font-medium text-zinc-900 hover:bg-zinc-50">
              Detalhes técnicos (insights)
            </summary>
            <pre className="overflow-x-auto border-t border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700">
              {JSON.stringify(report.insights, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
