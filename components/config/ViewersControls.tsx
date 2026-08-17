"use client";

import { useState } from "react";
import { formatDateSP } from "@/lib/format";

// Kept as a local literal union (rather than importing lib/validation's
// UserRole) — this component only needs the two values, and importing from
// lib/validation would pull zod into a client bundle for no benefit.
export type ViewerUserRole = "viewer" | "approver";

export interface ViewerUserData {
  id: string;
  username: string;
  role: ViewerUserRole;
  active: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<ViewerUserRole, string> = {
  viewer: "Visualizador",
  approver: "Aprovador",
};

const ROLE_BADGE_CLASSES: Record<ViewerUserRole, string> = {
  viewer: "bg-zinc-200 text-zinc-700",
  approver: "bg-blue-100 text-blue-700",
};

// Two-step remove: the first click swaps a row's "Remover" button for an
// inline "Confirmar remoção"/"Cancelar" pair — no window.confirm, and no
// destructive action fires on a single accidental click.
export function ViewersControls({ initialUsers }: { initialUsers: ViewerUserData[] }) {
  const [users, setUsers] = useState<ViewerUserData[]>(initialUsers);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<ViewerUserRole>("viewer");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function toggleActive(user: ViewerUserData) {
    setPendingId(user.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Não foi possível atualizar o acesso.");
        return;
      }
      setUsers((current) => current.map((u) => (u.id === user.id ? body.user : u)));
    } catch {
      setRowError("Falha de rede ao atualizar o acesso.");
    } finally {
      setPendingId(null);
    }
  }

  async function changeRole(user: ViewerUserData, nextRole: ViewerUserRole) {
    if (nextRole === user.role) return;
    setPendingId(user.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Não foi possível atualizar o papel.");
        return;
      }
      setUsers((current) => current.map((u) => (u.id === user.id ? body.user : u)));
    } catch {
      setRowError("Falha de rede ao atualizar o papel.");
    } finally {
      setPendingId(null);
    }
  }

  async function removeUser(id: string) {
    setPendingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRowError(body?.error ?? "Não foi possível remover o acesso.");
        return;
      }
      setUsers((current) => current.filter((u) => u.id !== id));
      setConfirmingId(null);
    } catch {
      setRowError("Falha de rede ao remover o acesso.");
    } finally {
      setPendingId(null);
    }
  }

  async function createUser() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body.error ?? "Não foi possível criar o acesso.");
        return;
      }
      setUsers((current) => [...current, body.user]);
      setUsername("");
      setPassword("");
      setRole("viewer");
    } catch {
      setCreateError("Falha de rede ao criar o acesso.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Acessos</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Contas entram com usuário e senha e veem todas as telas exceto Config. Visualizador: só
        leitura. Aprovador/analista: anexa imagens, edita legenda/prompt e aprova/desaprova; não
        vê Config nem gera rodada. Desativar/remover bloqueia o acesso na próxima navegação.
      </p>

      {users.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {users.map((user) => {
            const pending = pendingId === user.id;
            const confirming = confirmingId === user.id;
            return (
              <li key={user.id} className="flex flex-col gap-2 rounded-md bg-zinc-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-800">{user.username}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASSES[user.role]}`}
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.active ? "bg-green-100 text-green-700" : "bg-zinc-200 text-zinc-600"
                      }`}
                    >
                      {user.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">desde {formatDateSP(user.createdAt)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => removeUser(user.id)}
                        disabled={pending}
                        className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {pending ? "Removendo..." : "Confirmar remoção"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={pending}
                        className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                        Papel
                        <select
                          value={user.role}
                          onChange={(e) => changeRole(user, e.target.value as ViewerUserRole)}
                          disabled={pending}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-800 disabled:opacity-50"
                        >
                          <option value="viewer">Visualizador</option>
                          <option value="approver">Aprovador</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleActive(user)}
                        disabled={pending}
                        className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50"
                      >
                        {pending ? "Aguarde..." : user.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(user.id)}
                        disabled={pending}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
                      >
                        Remover
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}

      <div className="mt-4 flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-viewer-username" className="text-sm font-medium text-zinc-800">
            Usuário
          </label>
          <input
            id="new-viewer-username"
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          />
          <p className="text-xs text-zinc-500">
            3–30 caracteres: letras minúsculas, números, ponto ou _
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-viewer-password" className="text-sm font-medium text-zinc-800">
            Senha
          </label>
          <input
            id="new-viewer-password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="new-viewer-role" className="text-sm font-medium text-zinc-800">
            Papel
          </label>
          <select
            id="new-viewer-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ViewerUserRole)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          >
            <option value="viewer">Visualizador</option>
            <option value="approver">Aprovador</option>
          </select>
          <p className="text-xs text-zinc-500">
            Visualizador: só leitura. Aprovador/analista: anexa imagens, edita legenda/prompt e
            aprova/desaprova; não vê Config nem gera rodada.
          </p>
        </div>

        <button
          type="button"
          onClick={createUser}
          disabled={creating || !username || !password}
          className="mt-1 self-start rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {creating ? "Criando..." : "Adicionar acesso"}
        </button>

        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </div>
    </section>
  );
}
