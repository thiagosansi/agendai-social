import { redirect } from "next/navigation";
import {
  DEFAULT_GENERATION_INTERVAL_WEEKS,
  getCadenceConfig,
  getMarketConfig,
  getSetting,
  getSettingString,
} from "@/lib/settings";
import { PauseControls } from "@/components/config/PauseControls";
import { CadenceControls } from "@/components/config/CadenceControls";
import { NotificationControls } from "@/components/config/NotificationControls";
import { MarketControls } from "@/components/config/MarketControls";
import { ViewersControls, type ViewerUserRole } from "@/components/config/ViewersControls";
import { LogoutButton } from "@/components/config/LogoutButton";
import { tokenStatus, type TokenLevel } from "@/lib/meta-token";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session-server";

export const dynamic = "force-dynamic";

const REQUIRED_ENVS = [
  { key: "META_IG_USER_ID", label: "ID da conta profissional do Instagram" },
  { key: "META_IG_TOKEN", label: "Token de acesso à Graph API" },
  { key: "BLOB_READ_WRITE_TOKEN", label: "Vercel Blob (upload de imagens em produção)" },
  { key: "CRON_SECRET", label: "Segredo do cron de publicação diária" },
  { key: "APP_PASSWORD", label: "Senha de acesso a esta interface" },
  { key: "VAPID_PUBLIC_KEY", label: "Chave pública das notificações push" },
  { key: "VAPID_PRIVATE_KEY", label: "Chave privada das notificações push" },
  { key: "VAPID_SUBJECT", label: "Contato das notificações push (mailto:...)" },
] as const;

const LEVEL_CLASSES: Record<TokenLevel, string> = {
  green: "border-green-300 bg-green-50 text-green-800",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  red: "border-red-300 bg-red-50 text-red-800",
};

export default async function ConfigPage() {
  const session = await getSession();
  if (session?.role !== "owner") redirect("/");

  const status = tokenStatus(process.env.META_TOKEN_EXPIRES_AT);
  const [generationPaused, publishingPaused, generationIntervalWeeksRaw, marketConfig, viewerUsers, cadenceConfig] =
    await Promise.all([
      getSetting("generationPaused"),
      getSetting("publishingPaused"),
      getSettingString("generationIntervalWeeks", DEFAULT_GENERATION_INTERVAL_WEEKS),
      getMarketConfig(),
      prisma.viewerUser.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, username: true, role: true, active: true, createdAt: true },
      }),
      getCadenceConfig(),
    ]);

  // viewerUsers[].role is a plain DB string, not the ViewerUserRole union —
  // normalize any unexpected stored value to "viewer" (same fallback as
  // app/api/auth/login/route.ts) rather than widening the prop type.
  const users = viewerUsers.map((user) => ({
    ...user,
    role: (user.role === "approver" ? "approver" : "viewer") as ViewerUserRole,
    createdAt: user.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-4 sm:py-6">
      <h1 className="text-xl font-semibold text-zinc-900">Configurações</h1>

      <PauseControls
        initialSettings={{
          generationPaused,
          publishingPaused,
        }}
      />

      <CadenceControls
        initialSettings={{
          generationIntervalWeeks: Number(generationIntervalWeeksRaw),
          piecesPerRound: cadenceConfig.piecesPerRound,
          postingWeekdays: cadenceConfig.postingWeekdays,
          postingTime: cadenceConfig.postingTime,
        }}
      />

      <NotificationControls />

      <MarketControls
        initialCompetitors={marketConfig.competitors}
        initialHashtags={marketConfig.hashtags}
      />

      <section className={`rounded-lg border p-4 ${LEVEL_CLASSES[status.level]}`}>
        <h2 className="font-medium">Token do Instagram (Meta Graph API)</h2>
        <p className="mt-1 text-sm">{status.message}</p>
        <p className="mt-2 text-xs">
          Para renovar: gere um novo token de longa duração para a conta profissional no{" "}
          <a
            href="https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Meta for Developers
          </a>{" "}
          e atualize <code>META_IG_TOKEN</code> e <code>META_TOKEN_EXPIRES_AT</code> nas variáveis
          de ambiente do deploy.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium text-zinc-900">Variáveis de ambiente</h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {REQUIRED_ENVS.map(({ key, label }) => {
            const isSet = Boolean(process.env[key]);
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 p-2"
              >
                <div>
                  <div className="font-mono text-xs text-zinc-700">{key}</div>
                  <div className="text-xs text-zinc-500">{label}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    isSet ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {isSet ? "Configurada" : "Não configurada"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <h2 className="font-medium text-zinc-900">Documentação</h2>
        <ul className="mt-2 list-inside list-disc">
          <li>README.md — visão geral do pipeline e variáveis de ambiente</li>
          <li>docs/02-playbook-conteudo.md — contrato editorial (pilares, segmentos, rotação)</li>
          <li>docs/01-produto-referencia.md — referência de produto usada pela geração de conteúdo</li>
        </ul>
      </section>

      <ViewersControls initialUsers={users} />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium text-zinc-900">Sessão</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Encerra a sessão neste aparelho e volta para a tela de login.
        </p>
        <div className="mt-3">
          <LogoutButton />
        </div>
      </section>
    </div>
  );
}
