import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number;
  caption: string;
  href: string;
  icon: LucideIcon;
}

// Compact metric tile used in the dashboard's top grid — value + label +
// caption, wrapped in a Link so the whole card navigates to the relevant
// list page (fila, calendario, publicados).
export function StatCard({ label, value, caption, href, icon: Icon }: StatCardProps) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <Icon size={16} className="shrink-0 text-zinc-400" aria-hidden="true" />
      </div>
      <span className="text-2xl font-semibold text-zinc-900">{value}</span>
      <span className="text-xs text-zinc-500">{caption}</span>
    </Link>
  );
}
