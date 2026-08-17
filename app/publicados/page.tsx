import { prisma } from "@/lib/prisma";
import { orderedImagesInclude } from "@/lib/piece-images";
import { FormatBadge, StatusBadge } from "@/components/Badges";
import { formatDateTimeSP } from "@/lib/format";

export const dynamic = "force-dynamic";

interface PieceMetrics {
  reach?: number;
  saved?: number;
  likes?: number;
  comments?: number;
}

function MetricTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md bg-zinc-50 p-2 text-center">
      <div className="font-medium text-zinc-900">{value ?? "—"}</div>
      <div className="text-zinc-500">{label}</div>
    </div>
  );
}

export default async function PublicadosPage() {
  const pieces = await prisma.piece.findMany({
    where: { status: { in: ["published", "failed"] } },
    orderBy: { publishAt: "desc" },
    include: orderedImagesInclude,
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6">
      <h1 className="text-xl font-semibold text-zinc-900">Publicados</h1>

      {pieces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Nenhuma peça publicada ainda.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {pieces.map((piece) => {
            const metrics = (piece.metrics as unknown as PieceMetrics | null) ?? {};
            const coverImageUrl = piece.images[0]?.url ?? null;

            return (
              <li key={piece.id} id={`piece-${piece.id}`} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <FormatBadge format={piece.format} />
                    <StatusBadge status={piece.status} />
                  </div>
                  <span className="text-xs text-zinc-500">{formatDateTimeSP(piece.publishAt)}</span>
                </div>

                <div className="mt-2 flex gap-3">
                  {coverImageUrl && (
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
                      <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <p className="line-clamp-3 text-sm text-zinc-700">{piece.caption}</p>
                </div>

                {piece.status === "failed" && (
                  <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
                    <p className="font-medium">Falha ao publicar</p>
                    <p className="mt-0.5">{piece.lastError ?? "Erro não informado."}</p>
                    <p className="mt-1 text-xs text-red-600">
                      Verifique o token do Instagram em Configurações. Peças com falha não são
                      reenviadas automaticamente — reaprove ou aguarde a próxima execução do cron.
                    </p>
                  </div>
                )}

                {piece.status === "published" && (
                  <div className="mt-2 flex flex-col gap-2 text-sm">
                    {piece.igPermalink ? (
                      <a
                        href={piece.igPermalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Ver no Instagram
                      </a>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <MetricTile label="Alcance" value={metrics.reach} />
                      <MetricTile label="Salvos" value={metrics.saved} />
                      <MetricTile label="Curtidas" value={metrics.likes} />
                      <MetricTile label="Comentários" value={metrics.comments} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
