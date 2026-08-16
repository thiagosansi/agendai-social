import { FORMAT_LABELS, STATUS_LABELS } from "@/lib/format";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  approved: "bg-blue-100 text-blue-700",
  published: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_BADGE_CLASSES[status] ?? "bg-zinc-100 text-zinc-700"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function FormatBadge({ format }: { format: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
      {FORMAT_LABELS[format] ?? format}
    </span>
  );
}
