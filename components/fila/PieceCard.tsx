"use client";

import { useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FormatBadge, StatusBadge } from "@/components/Badges";
import { publishCountdown } from "@/lib/format";

export interface PieceImageData {
  id: string;
  url: string;
}

export interface PieceCardData {
  id: string;
  pillar: string;
  segment: string;
  format: string;
  caption: string;
  imagePrompt: string;
  images: PieceImageData[];
  publishAt: string;
  status: string;
}

interface ClaimCheckViolation {
  id: string;
  label: string;
  substitute: string;
  snippet: string;
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CARROSSEL_IMAGES = 10;
const MIN_CARROSSEL_IMAGES_TO_APPROVE = 2;

export function PieceCard({ piece }: { piece: PieceCardData }) {
  const router = useRouter();

  const isCarrossel = piece.format === "carrossel";
  const isDraft = piece.status === "draft";
  const canMutateImages = isDraft;

  const [captionValue, setCaptionValue] = useState(piece.caption);
  // Tracks the last caption we've synced from props, so we can reset the
  // editable textarea when a fresh piece arrives from the server (e.g.
  // after router.refresh()) without doing it in an effect — this is React's
  // documented "adjusting state when a prop changes" pattern, computed
  // during render instead of causing an extra post-commit render.
  const [syncedCaption, setSyncedCaption] = useState(piece.caption);
  if (piece.caption !== syncedCaption) {
    setSyncedCaption(piece.caption);
    setCaptionValue(piece.caption);
  }
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [captionViolations, setCaptionViolations] = useState<ClaimCheckViolation[]>([]);

  const [promptValue, setPromptValue] = useState(piece.imagePrompt);
  const [syncedPrompt, setSyncedPrompt] = useState(piece.imagePrompt);
  if (piece.imagePrompt !== syncedPrompt) {
    setSyncedPrompt(piece.imagePrompt);
    setPromptValue(piece.imagePrompt);
  }
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const captionDirty = captionValue.trim() !== piece.caption && captionValue.trim().length > 0;
  const promptDirty = promptValue.trim() !== piece.imagePrompt && promptValue.trim().length > 0;

  const atCarrosselLimit = isCarrossel && piece.images.length >= MAX_CARROSSEL_IMAGES;
  const canApprove =
    piece.images.length >= 1 && (!isCarrossel || piece.images.length >= MIN_CARROSSEL_IMAGES_TO_APPROVE);

  async function saveCaption() {
    setSavingCaption(true);
    setCaptionError(null);
    setCaptionViolations([]);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: captionValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCaptionError(body.error ?? "Não foi possível salvar a legenda.");
        setCaptionViolations(body.violations ?? []);
        return;
      }
      router.refresh();
    } catch {
      setCaptionError("Falha de rede ao salvar a legenda.");
    } finally {
      setSavingCaption(false);
    }
  }

  async function savePrompt() {
    setSavingPrompt(true);
    setPromptError(null);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imagePrompt: promptValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPromptError(body.error ?? "Não foi possível salvar o prompt.");
        return;
      }
      setEditingPrompt(false);
      router.refresh();
    } catch {
      setPromptError("Falha de rede ao salvar o prompt.");
    } finally {
      setSavingPrompt(false);
    }
  }

  async function uploadFiles(files: File[]) {
    setUploadError(null);

    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setUploadError("Formato não suportado. Envie JPEG, PNG ou WebP.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setUploadError("Arquivo maior que 8MB.");
        return;
      }
    }

    setUploading(true);
    try {
      // Sequential, not parallel: each upload appends/replaces based on the
      // piece's current image count, so concurrent requests would race on
      // sortOrder / the single-image replace check.
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/pieces/${piece.id}/image`, {
          method: "POST",
          body: formData,
        });
        const body = await res.json();
        if (!res.ok) {
          setUploadError(body.error ?? "Falha ao enviar a imagem.");
          break;
        }
      }
      router.refresh();
    } catch {
      setUploadError("Falha de rede ao enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void uploadFiles(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void uploadFiles(files);
  }

  async function removeImage(imageId: string) {
    setUploadError(null);
    setRemovingImageId(imageId);
    try {
      const res = await fetch(`/api/pieces/${piece.id}/image/${imageId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUploadError(body?.error ?? "Não foi possível remover a imagem.");
        return;
      }
      router.refresh();
    } catch {
      setUploadError("Falha de rede ao remover a imagem.");
    } finally {
      setRemovingImageId(null);
    }
  }

  async function moveImage(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= piece.images.length) return;

    const newOrder = piece.images.map((image) => image.id);
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];

    setUploadError(null);
    setReordering(true);
    try {
      const res = await fetch(`/api/pieces/${piece.id}/image/reorder`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageOrder: newOrder }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUploadError(body?.error ?? "Não foi possível reordenar as imagens.");
        return;
      }
      router.refresh();
    } catch {
      setUploadError("Falha de rede ao reordenar as imagens.");
    } finally {
      setReordering(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(piece.imagePrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setUploadError("Não foi possível copiar automaticamente — selecione e copie o texto acima.");
    }
  }

  async function setStatus(status: "approved" | "draft") {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) {
        setApproveError(body.error ?? "Não foi possível atualizar o status.");
        return;
      }
      router.refresh();
    } catch {
      setApproveError("Falha de rede ao atualizar o status.");
    } finally {
      setApproving(false);
    }
  }

  const promptEditor = !editingPrompt ? (
    <>
      <p className="whitespace-pre-wrap text-sm text-zinc-600">{piece.imagePrompt}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copyPrompt}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          {copied ? "Copiado!" : "Copiar prompt"}
        </button>
        <button
          type="button"
          onClick={() => setEditingPrompt(true)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
        >
          Editar
        </button>
      </div>
    </>
  ) : (
    <>
      <textarea
        value={promptValue}
        onChange={(e) => setPromptValue(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={savePrompt}
          disabled={savingPrompt || !promptDirty}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {savingPrompt ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditingPrompt(false);
            setPromptValue(piece.imagePrompt);
            setPromptError(null);
          }}
          disabled={savingPrompt}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
        >
          Cancelar
        </button>
      </div>
      {promptError && <p className="text-sm text-red-600">{promptError}</p>}
    </>
  );

  const uploadDropzone = canMutateImages && !atCarrosselLimit && (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`flex items-center justify-center rounded-md border-2 border-dashed p-4 text-sm ${
        dragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"
      }`}
    >
      <label className="flex w-full cursor-pointer flex-col items-center gap-1 text-center">
        <span className="font-medium text-zinc-700">
          {uploading
            ? "Enviando..."
            : piece.images.length > 0
              ? isCarrossel
                ? "Adicionar imagem"
                : "Substituir imagem"
              : "Selecionar imagem"}
        </span>
        <span className="text-xs text-zinc-400">
          ou arraste {isCarrossel ? "arquivos" : "um arquivo"} aqui (JPEG, PNG ou WebP, até 8MB)
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={isCarrossel}
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
      </label>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FormatBadge format={piece.format} />
        <StatusBadge status={piece.status} />
        <span className="text-xs text-zinc-500">
          {piece.pillar} · {piece.segment}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {piece.images.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {piece.images.map((image, index) => (
                <div key={image.id} className="flex w-20 shrink-0 flex-col gap-1">
                  <div className="relative aspect-square w-20 overflow-hidden rounded-md bg-zinc-100">
                    {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
                    <img src={image.url} alt="" className="h-full w-full object-cover" />
                    <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/80 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    {canMutateImages && (
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        disabled={removingImageId === image.id || uploading || reordering}
                        aria-label="Remover imagem"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600/90 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {canMutateImages && isCarrossel && piece.images.length > 1 && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0 || reordering || uploading}
                        aria-label="Mover imagem para a esquerda"
                        className="flex h-9 flex-1 items-center justify-center rounded-md border border-zinc-300 text-sm font-medium text-zinc-700 disabled:opacity-30"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === piece.images.length - 1 || reordering || uploading}
                        aria-label="Mover imagem para a direita"
                        className="flex h-9 flex-1 items-center justify-center rounded-md border border-zinc-300 text-sm font-medium text-zinc-700 disabled:opacity-30"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {isCarrossel && (
              <>
                <p className="text-xs text-zinc-500">
                  A ordem das miniaturas é a ordem de publicação do carrossel.
                </p>
                <p
                  className={`text-xs ${
                    piece.images.length < MIN_CARROSSEL_IMAGES_TO_APPROVE ? "text-amber-700" : "text-zinc-500"
                  }`}
                >
                  {piece.images.length} {piece.images.length === 1 ? "imagem" : "imagens"} (mín.{" "}
                  {MIN_CARROSSEL_IMAGES_TO_APPROVE} para aprovar — o prompt sugere 4 slides)
                </p>
              </>
            )}
          </div>
        )}

        {!canMutateImages && piece.images.length > 0 && (
          <p className="text-xs text-zinc-400">Imagens congeladas após aprovação.</p>
        )}

        {atCarrosselLimit && (
          <p className="text-xs text-zinc-400">Limite de {MAX_CARROSSEL_IMAGES} imagens atingido.</p>
        )}

        {piece.images.length === 0 && !editingPrompt && (
          <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">
            <p className="whitespace-pre-wrap">{piece.imagePrompt}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={copyPrompt}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
              >
                {copied ? "Copiado!" : "Copiar prompt"}
              </button>
              <button
                type="button"
                onClick={() => setEditingPrompt(true)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                Editar
              </button>
            </div>
          </div>
        )}

        {piece.images.length === 0 && editingPrompt && (
          <div className="flex flex-col gap-2">
            <textarea
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={savePrompt}
                disabled={savingPrompt || !promptDirty}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingPrompt ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingPrompt(false);
                  setPromptValue(piece.imagePrompt);
                  setPromptError(null);
                }}
                disabled={savingPrompt}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                Cancelar
              </button>
            </div>
            {promptError && <p className="text-sm text-red-600">{promptError}</p>}
          </div>
        )}

        {piece.images.length > 0 && (
          <details className="rounded-md border border-zinc-200 p-2">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700">
              Ver/editar prompt
            </summary>
            <div className="mt-2 flex flex-col gap-2">{promptEditor}</div>
          </details>
        )}

        {uploadDropzone}

        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`caption-${piece.id}`} className="text-xs font-medium text-zinc-500">
          Legenda
        </label>
        <textarea
          id={`caption-${piece.id}`}
          value={captionValue}
          onChange={(e) => setCaptionValue(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
        />
        {captionDirty && (
          <button
            type="button"
            onClick={saveCaption}
            disabled={savingCaption}
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {savingCaption ? "Salvando..." : "Salvar legenda"}
          </button>
        )}
        {captionError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            <p className="font-medium">{captionError}</p>
            {captionViolations.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {captionViolations.map((v) => (
                  <li key={v.id}>
                    <span className="font-medium">{v.label}</span> em &ldquo;{v.snippet}&rdquo; — sugestão: {v.substitute}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
        {piece.status === "approved" ? (
          <>
            <span className="text-sm text-zinc-600">{publishCountdown(piece.publishAt)}</span>
            <button
              type="button"
              onClick={() => setStatus("draft")}
              disabled={approving}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 disabled:opacity-50"
            >
              {approving ? "Aguarde..." : "Desaprovar"}
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-zinc-400">
              {canApprove
                ? "Pronto para aprovar"
                : piece.images.length === 0
                  ? "Envie uma imagem para aprovar"
                  : `Envie mais ${MIN_CARROSSEL_IMAGES_TO_APPROVE - piece.images.length} imagem(ns) para aprovar`}
            </span>
            <button
              type="button"
              onClick={() => setStatus("approved")}
              disabled={!canApprove || approving}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approving ? "Aprovando..." : "Aprovar"}
            </button>
          </>
        )}
      </div>
      {approveError && <p className="text-sm text-red-600">{approveError}</p>}
    </div>
  );
}
