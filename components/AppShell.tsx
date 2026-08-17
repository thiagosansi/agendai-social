"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calendar,
  Inbox,
  LayoutDashboard,
  Menu,
  Send,
  Settings,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Início", icon: LayoutDashboard },
  { href: "/fila", label: "Fila", icon: Inbox },
  { href: "/calendario", label: "Calendário", icon: Calendar },
  { href: "/publicados", label: "Publicados", icon: Send },
  { href: "/analise", label: "Análise", icon: BarChart3 },
  { href: "/config", label: "Config", icon: Settings },
] as const;

const ICON_SIZE = 18;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

interface NavListProps {
  pathname: string;
  items: readonly (typeof NAV_ITEMS)[number][];
  onNavigate?: () => void;
}

function NavList({ pathname, items, onNavigate }: NavListProps) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium ${
              active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            <Icon size={ICON_SIZE} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

interface AppShellProps {
  children: React.ReactNode;
  // The authenticated session's role, or null when unauthenticated (e.g.
  // /login). Non-owners (viewer, approver) see every nav item except
  // Config — they have no write access to it (app/config/page.tsx
  // redirects them away regardless).
  role: "owner" | "approver" | "viewer" | null;
}

/**
 * Navigation shell: a persistent left sidebar on desktop (>= md) and a
 * sticky header + native <dialog> drawer on mobile. Replaces the old
 * top-nav + fixed-bottom-tab-bar pair the app previously used.
 *
 * The drawer follows the same native <dialog> pattern as
 * components/fila/ImageLightbox.tsx: showModal()/close() driven from an
 * effect, backdrop-click detection via `e.target === dialog`, and the
 * dialog's own `close` event (fired by Esc too) kept in sync with React
 * state via a native `addEventListener("close", ...)` — the React `onClose`
 * prop does not fire reliably here, so it is not used.
 */
export function AppShell({ children, role }: AppShellProps) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const navItems = role !== "owner" ? NAV_ITEMS.filter((item) => item.href !== "/config") : NAV_ITEMS;

  // /login is reachable without a session (that's its whole point), so it
  // must not leak the app's nav — render it standalone, no sidebar/drawer.
  const isLoginPage = pathname === "/login";

  // Close the drawer whenever the route changes (link click already closes
  // it via onNavigate, but this also covers back/forward navigation). Adjusted
  // during render rather than in an effect — same pattern used for the synced
  // index in components/fila/ImageLightbox.tsx — to avoid the extra render an
  // effect-based setState would cause.
  const [syncedPathname, setSyncedPathname] = useState(pathname);
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Keep React state in sync with the dialog's own open/closed state. The
  // dialog can close itself outside of the effect above — natively, via Esc
  // (which fires "cancel" then "close") — so without this listener `open`
  // stays true and the hamburger button becomes a no-op until the next route
  // change resets it. Backdrop clicks and the header close button already
  // call `setOpen(false)` before `dialog.close()` runs, so this listener is a
  // no-op (same value) for those paths.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => setOpen(false);
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-full">
      {/* Desktop: persistent left sidebar. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:flex-col md:border-r md:border-zinc-200 md:bg-white">
        <div className="px-4 py-4">
          <span className="text-sm font-semibold text-zinc-900">Agendaí Social Studio</span>
        </div>
        <NavList pathname={pathname} items={navItems} />
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile: sticky header in normal flow, with a safe-area-aware top
            padding so it clears the notch / Dynamic Island in standalone
            PWA mode. */}
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-2 px-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={open}
              aria-controls="app-drawer"
              className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100"
            >
              <Menu size={ICON_SIZE} aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold text-zinc-900">Agendaí Social Studio</span>
          </div>
        </header>

        <dialog
          id="app-drawer"
          ref={dialogRef}
          onClick={(e) => {
            // A click landing on the <dialog> element itself is a backdrop
            // click — the panel below stops propagation of its own clicks.
            if (e.target === dialogRef.current) setOpen(false);
          }}
          aria-label="Menu de navegação"
          className="m-0 h-dvh max-h-none w-72 max-w-[85vw] overscroll-contain bg-white p-0 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop:bg-black/40"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full flex-col"
          >
            <div className="flex items-center justify-between px-4 pb-3">
              <span className="text-sm font-semibold text-zinc-900">Agendaí Social Studio</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100"
              >
                <X size={ICON_SIZE} aria-hidden="true" />
              </button>
            </div>
            <NavList pathname={pathname} items={navItems} onNavigate={() => setOpen(false)} />
          </div>
        </dialog>

        <main className="flex-1 pb-8">{children}</main>
      </div>
    </div>
  );
}
