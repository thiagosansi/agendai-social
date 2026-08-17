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

      {/*
        Mobile: fixed bottom tab bar. The safe-area padding lives below the
        tab row (not inside it), so the row keeps its full --app-nav-height
        tap target and the inset only pushes the whole bar up above the iPhone
        home indicator. See app/globals.css for both custom properties.
      */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white md:hidden"
        style={{ paddingBottom: "var(--app-safe-bottom)" }}
      >
        <div className="grid h-[var(--app-nav-height)] grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full items-center justify-center text-[13px] font-medium ${
                  active ? "text-zinc-900" : "text-zinc-500"
                }`}
              >
                {/* Active marker sits on the top edge, where the bar meets content. */}
                {active && (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-zinc-900" />
                )}
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
