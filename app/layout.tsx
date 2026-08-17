import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session-server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to a
// non-zero value on notched devices. Without it iOS reports every inset as
// 0px, and the mobile header / drawer in components/AppShell.tsx would draw
// underneath the notch / Dynamic Island / Safari toolbar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "Agendaí Social Studio",
  description: "Fila de aprovação e publicação do Instagram do Agendaí",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Agendaí Social",
  },
};

// Viewer sessions are re-validated against the DB on every request (unlike
// the owner path, which trusts the signed cookie alone) — a viewer's
// account can be deactivated or deleted from /config at any time, and the
// signed cookie has no way to reflect that without re-issuing it. A server
// component can't clear a cookie itself, so a stale viewer is routed
// through GET /api/auth/logout (app/api/auth/logout/route.ts), which clears
// the cookie and *then* redirects to /login — redirecting straight to
// /login here instead would leave the stale cookie in place and loop
// forever, since this layout (and its DB check) also wraps /login.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  if (session?.role === "viewer") {
    const viewer = await prisma.viewerUser.findUnique({
      where: { username: session.username },
      select: { active: true },
    });
    if (!viewer || !viewer.active) {
      redirect("/api/auth/logout?next=%2Flogin");
    }
  }

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <AppShell role={session?.role ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
