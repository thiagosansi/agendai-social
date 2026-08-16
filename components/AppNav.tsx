"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/fila", label: "Fila" },
  { href: "/calendario", label: "Calendário" },
  { href: "/publicados", label: "Publicados" },
  { href: "/config", label: "Config" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: simple top nav, in normal document flow. */}
      <header className="hidden border-b border-zinc-200 bg-white md:block">
        <nav className="mx-auto flex max-w-2xl items-center gap-1 px-4 py-3">
          <span className="mr-4 text-sm font-semibold text-zinc-900">Agendaí Social Studio</span>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                isActive(pathname, item.href)
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Mobile: fixed bottom tab bar with safe-area inset for the iPhone home indicator. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium ${
                isActive(pathname, item.href) ? "text-zinc-900" : "text-zinc-500"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
