import { LoginForm } from "@/components/LoginForm";

export const metadata = {
  title: "Entrar",
};

// The password form for the cookie-session gate (lib/session.ts). Exists
// because iOS home-screen (standalone) PWAs never render the Basic Auth
// prompt middleware.ts falls back to — see middleware.ts for the full
// routing logic that lands a request here.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">Entrar</h1>
        <p className="mt-1 text-sm text-zinc-500">Agendaí Social Studio</p>

        <div className="mt-6">
          <LoginForm next={next ?? null} />
        </div>
      </div>
    </div>
  );
}
