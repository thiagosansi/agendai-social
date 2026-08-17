import { Video } from "lucide-react";
import { FormatBadge, StatusBadge } from "@/components/Badges";
import { formatDateTimeSP, publishCountdown } from "@/lib/format";

interface PieceMetrics {
  reach?: number;
  saved?: number;
  likes?: number;
  comments?: number;
}

export interface PieceMiniData {
  id: string;
  pillar: string;
  segment: string;
  format: string;
  status: string;
  publishAt: Date;
  // Real image URL to render — for a video cover media (isVideo=true) this
  // is the optional PieceImage.coverUrl thumbnail, never the video file
  // itself, since that can't be shown in an <img>.
  coverImageUrl: string | null;
  // True when the piece's cover media is a video (kind="video") rather
  // than an image — drives the placeholder tile when no coverImageUrl.
  isVideo?: boolean;
  metrics?: unknown;
}

function MetricTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md bg-zinc-50 p-1.5 text-center">
      <div className="text-xs font-medium text-zinc-900">{value ?? "—"}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}

// Compact list-row for a Piece, reused by the "Próximas na fila" (pending,
// no metrics) and "Últimas publicadas" (published, with metrics) dashboard
// sections. `variant` toggles the date line: pending pieces show the
// countdown, published pieces show a plain formatted date.
export function PieceMini({ piece, variant }: { piece: PieceMiniData; variant: "pending" | "published" }) {
  const metrics = variant === "published" ? ((piece.metrics as PieceMetrics | null) ?? {}) : null;

  return (
    <li className="flex gap-3 rounded-md border border-zinc-100 p-2">
      {piece.coverImageUrl ? (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
          <img src={piece.coverImageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : piece.isVideo ? (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-100">
          <Video className="h-5 w-5 text-zinc-400" aria-hidden="true" />
        </div>
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-md bg-zinc-100" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <FormatBadge format={piece.format} />
          <StatusBadge status={piece.status} />
        </div>
        <p className="mt-1 truncate text-xs text-zinc-600">
          {piece.pillar} · {piece.segment}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {variant === "pending" ? publishCountdown(piece.publishAt) : formatDateTimeSP(piece.publishAt)}
        </p>
        {variant === "published" && metrics && (
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <MetricTile label="Alcance" value={metrics.reach} />
            <MetricTile label="Salvos" value={metrics.saved} />
            <MetricTile label="Curtidas" value={metrics.likes} />
            <MetricTile label="Coment." value={metrics.comments} />
          </div>
        )}
      </div>
    </li>
  );
}
