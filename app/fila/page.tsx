import { prisma } from "@/lib/prisma";
import { orderedImagesInclude } from "@/lib/piece-images";
import { PieceCard, type PieceCardData } from "@/components/fila/PieceCard";
import { ManualRoundButton } from "@/components/fila/ManualRoundButton";

export const dynamic = "force-dynamic";

export default async function FilaPage() {
  const pieces = await prisma.piece.findMany({
    where: { status: { in: ["draft", "approved"] } },
    orderBy: { publishAt: "asc" },
    include: orderedImagesInclude,
  });

  const items: PieceCardData[] = pieces.map((piece) => ({
    id: piece.id,
    pillar: piece.pillar,
    segment: piece.segment,
    format: piece.format,
    caption: piece.caption,
    imagePrompt: piece.imagePrompt,
    images: piece.images.map((image) => ({ id: image.id, url: image.url })),
    publishAt: piece.publishAt.toISOString(),
    status: piece.status,
  }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900">Fila</h1>
        <ManualRoundButton />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Nenhuma peça na fila. A rotina de geração cria rascunhos automaticamente —
          volte em breve ou dispare uma rodada manual.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((piece) => (
            <li key={piece.id} id={`piece-${piece.id}`}>
              <PieceCard piece={piece} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
