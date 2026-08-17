import Link from "next/link";
import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}

// Shared card wrapper for the dashboard's sections (Próximas na fila,
// Últimas publicadas, Rotinas, Análise) — a title, optional "ver mais"
// link, and arbitrary content below.
export function SectionCard({ title, children, href, linkLabel }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-zinc-900">{title}</h2>
        {href && (
          <Link href={href} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
            {linkLabel ?? "Ver mais →"}
          </Link>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
