import { prisma } from "@/lib/prisma";
import { formatDateTimeSP } from "@/lib/format";
import { FormatBadge } from "@/components/Badges";
import {
  parseMarket,
  parseContentProposals,
  parseRecommendations,
  recommendationTypeLabel,
  recommendationTypeColor,
  priorityLabel,
} from "@/lib/analysis-report-view";

export const dynamic = "force-dynamic";

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

          {/* Market intelligence section — schemaVersion 2 only */}
          {(() => {
            const market = parseMarket(report.insights);
            if (!market) return null;
            return (
              <section className="rounded-lg border border-zinc-200 bg-white p-4">
                <h2 className="font-medium text-zinc-900">Mercado</h2>

                {market.competitors.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-sm font-medium text-zinc-700">Concorrentes</h3>
                    <ul className="mt-2 flex flex-col gap-2">
                      {market.competitors.map((competitor, idx) => (
                        <li key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                          <div className="font-medium text-zinc-900">@{competitor.username}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {competitor.followers.toLocaleString("pt-BR")} seguidores · média{" "}
                            {competitor.avgLikes.toLocaleString("pt-BR")} curtidas ·{" "}
                            {competitor.avgComments.toLocaleString("pt-BR")} comentários
                          </div>
                          {competitor.themes.length > 0 && (
                            <div className="mt-1 text-xs text-zinc-600">
                              Temas: {competitor.themes.join(", ")}
                            </div>
                          )}
                          {competitor.topPosts.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-1">
                              {competitor.topPosts.map((post, postIdx) => (
                                <li key={postIdx} className="text-xs text-zinc-600">
                                  <a
                                    href={post.permalink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 underline"
                                  >
                                    {post.hookType}
                                  </a>{" "}
                                  — {post.likes.toLocaleString("pt-BR")} curtidas,{" "}
                                  {post.comments.toLocaleString("pt-BR")} comentários
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {market.hashtags.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-zinc-700">Hashtags</h3>
                    <ul className="mt-2 flex flex-col gap-2">
                      {market.hashtags.map((hashtag, idx) => (
                        <li key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                          <div className="font-medium text-zinc-900">#{hashtag.tag}</div>
                          {hashtag.themes.length > 0 && (
                            <div className="mt-1 text-xs text-zinc-600">
                              Temas: {hashtag.themes.join(", ")}
                            </div>
                          )}
                          {hashtag.samplePermalinks.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-2 text-xs">
                              {hashtag.samplePermalinks.map((link, linkIdx) => (
                                <a
                                  key={linkIdx}
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 underline"
                                >
                                  exemplo {linkIdx + 1}
                                </a>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {market.webTrends.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-zinc-700">Tendências (web)</h3>
                    <ul className="mt-2 flex flex-col gap-2">
                      {market.webTrends.map((trend, idx) => (
                        <li key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                          <a
                            href={trend.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-600 underline"
                          >
                            {trend.title}
                          </a>
                          <p className="mt-1 text-xs text-zinc-600">{trend.takeaway}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })()}

          {/* Content proposals section — schemaVersion 2 only */}
          {(() => {
            const proposals = parseContentProposals(report.contentProposals);
            if (proposals.length === 0) return null;
            return (
              <section className="rounded-lg border border-zinc-200 bg-white p-4">
                <h2 className="font-medium text-zinc-900">Propostas de conteúdo</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {proposals.map((proposal, idx) => (
                    <li key={idx} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                        <span>{proposal.pillar}</span>
                        <span>·</span>
                        <span>{proposal.segment}</span>
                        <FormatBadge format={proposal.format} />
                      </div>
                      <p className="mt-2 text-sm font-medium text-zinc-900">{proposal.hook}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800">
                        {proposal.captionDraft}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">{proposal.imagePrompt}</p>
                      {proposal.rationale && (
                        <p className="mt-2 text-xs text-zinc-500">Racional: {proposal.rationale}</p>
                      )}
                      {proposal.sources && proposal.sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {proposal.sources.map((source, sourceIdx) => (
                            <a
                              key={sourceIdx}
                              href={source}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 underline"
                            >
                              fonte {sourceIdx + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}

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
