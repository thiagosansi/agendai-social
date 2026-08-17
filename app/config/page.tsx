import { DEFAULT_GENERATION_INTERVAL_WEEKS, getSetting, getSettingString } from "@/lib/settings";
import { PauseControls } from "@/components/config/PauseControls";
import { NotificationControls } from "@/components/config/NotificationControls";

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

type TokenLevel = "green" | "amber" | "red";

interface TokenStatus {
  level: TokenLevel;
  message: string;
}

const LEVEL_CLASSES: Record<TokenLevel, string> = {
  green: "border-green-300 bg-green-50 text-green-800",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  red: "border-red-300 bg-red-50 text-red-800",
};

function tokenStatus(expiresAt: string | undefined): TokenStatus {
  if (!expiresAt) {
    return { level: "red", message: "META_TOKEN_EXPIRES_AT não configurada." };
  }

  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return { level: "red", message: "META_TOKEN_EXPIRES_AT tem um valor inválido." };
  }

  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);

  if (daysLeft < 0) {
    return { level: "red", message: `Token expirado há ${Math.abs(daysLeft)} dia(s).` };
  }
  if (daysLeft === 0) {
    return { level: "red", message: "Token expira hoje." };
  }
  if (daysLeft <= 10) {
    return { level: "amber", message: `Expira em ${daysLeft} dia(s).` };
  }
  return { level: "green", message: `Expira em ${daysLeft} dia(s).` };
}

export default async function ConfigPage() {
  const status = tokenStatus(process.env.META_TOKEN_EXPIRES_AT);
  const [generationPaused, publishingPaused, generationIntervalWeeksRaw] = await Promise.all([
    getSetting("generationPaused"),
    getSetting("publishingPaused"),
    getSettingString("generationIntervalWeeks", DEFAULT_GENERATION_INTERVAL_WEEKS),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-4 sm:py-6">
      <h1 className="text-xl font-semibold text-zinc-900">Configurações</h1>

      <PauseControls
        initialSettings={{
          generationPaused,
          publishingPaused,
          generationIntervalWeeks: Number(generationIntervalWeeksRaw),
        }}
      />

      <NotificationControls />

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
    </div>
  );
}
