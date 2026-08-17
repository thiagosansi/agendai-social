import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/AppNav";
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
// 0px, and the fixed bottom tab bar in components/AppNav.tsx ends up drawn
// underneath the home indicator / Safari toolbar.
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <AppNav />
        {/*
          Bottom padding clears the fixed mobile tab bar. It's derived from the
          same custom properties the bar itself uses (app/globals.css) instead
          of a hardcoded value, so the two can't drift apart.
        */}
        <main className="flex-1 pb-[calc(var(--app-nav-height)+var(--app-safe-bottom)+1rem)] md:pb-8">
          {children}
        </main>
      </body>
    </html>
  );
}
