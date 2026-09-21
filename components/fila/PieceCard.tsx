"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Loader2 } from "lucide-react";
import { FormatBadge, StatusBadge } from "@/components/Badges";
import { ImageLightbox } from "@/components/fila/ImageLightbox";
import { formatDateTimeSP, fromSaoPauloDateTimeLocal, publishCountdown, toSaoPauloDateTimeLocal } from "@/lib/format";
import { MAX_OVERLAY_TEXT_LEN } from "@/lib/validation";
import type { ImageGenStatus } from "@/lib/validation";

export interface PieceImageData {
  id: string;
  url: string;
  // "image" (default) or "video" — see lib/piece-images.ts's isVideoMedia.
  // contentType/durationSec/coverUrl are only ever set on video rows.
  kind: string;
  contentType: string | null;
  durationSec: number | null;
  coverUrl: string | null;
  // The clean (no overlay text) source photo the model produced — set only
  // on generated image rows. When present, "Reaplicar texto" can recompose
  // the overlay on top of it without calling the model again (see
  // POST .../image/generate's mode: "recompose").
  sourceUrl: string | null;
}

export interface PieceCardData {
  id: string;
  pillar: string;
  segment: string;
  format: string;
  caption: string;
  imagePrompt: string;
  // Per-slide prompts for the automated image generation pipeline —
  // carrossel only (see prisma/schema.prisma's Piece.imagePrompts).
  imagePrompts: string[];
  // Text drawn on top of the piece's single photo (estatico/stories) —
  // null/"" means the photo stays clean. See prisma/schema.prisma's
  // Piece.overlayText.
  overlayText: string | null;
  // Per-slide overlay text (carrossel only), same length as imagePrompts —
  // "" means that slide gets no text. See Piece.overlayTexts.
  overlayTexts: string[];
  // imageGenStatus is a plain string column server-side (not a DB enum —
  // see prisma/schema.prisma), so it's typed loosely here too; ImageGenStatus
  // (lib/validation.ts) documents the actual value set.
  imageGenStatus: ImageGenStatus | string;
  imageGenError: string | null;
  // Computed server-side by app/fila/page.tsx (isImageGenActive from
  // lib/image-generation.ts) so the "still generating" UI never depends on
  // the client's clock — true while queued, or running with a recent
  // enough updatedAt (stale locks read as failed instead).
  imageGenActive: boolean;
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

// Mirrors STALE_SCHEDULE_MS in app/api/pieces/[id]/route.ts — that route
// rejects approving a piece whose publishAt is more than 24h in the past
// (auto-rescheduling instead when no explicit publishAt is sent). Duplicated
// here client-side, same as ALLOWED_VIDEO_TYPES/MAX_VIDEO_BYTES above, so
// this component doesn't depend on server-only route internals — used only
// to decide whether to show the "data vencida" hint on draft pieces.
const STALE_PUBLISH_AT_MS = 24 * 60 * 60 * 1000;

// Video support (reels/stories only). Mirrors lib/validation.ts's
// ALLOWED_VIDEO_CONTENT_TYPES/MAX_VIDEO_BYTES/MAX_REELS_DURATION_SEC/
// MAX_STORY_VIDEO_DURATION_SEC — duplicated here client-side the same way
// ALLOWED_TYPES/MAX_BYTES above duplicate the image limits, so this
// component doesn't depend on server-only validation internals.
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_REELS_DURATION_SEC = 900;
// Soft cap: engagement drops sharply past this, but Meta allows up to
// MAX_REELS_DURATION_SEC — so we warn instead of blocking the upload.
const REELS_DURATION_WARN_SEC = 90;
const MAX_STORY_VIDEO_DURATION_SEC = 60;
const VIDEO_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

// Reads a video File's duration client-side via a throwaway <video> element —
// there's no way to get this from the File object alone, and we need it
// before upload to enforce per-format duration limits (and to send
// durationSec alongside the registered video).
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(videoEl.duration);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível ler a duração do vídeo."));
    };
    videoEl.src = objectUrl;
  });
}

// `readOnly` mirrors the viewer role (session.role === "viewer",
// app/fila/page.tsx): all editing/mutation affordances (caption/prompt
// editing, approve/disapprove, image upload/remove/reorder) are hidden,
// while thumbnails, the lightbox, captions and the prompt stay visible as
// plain text. Hooks below stay unconditional (rules of hooks) — only the
// JSX branches on `readOnly`.
export function PieceCard({
  piece,
  readOnly = false,
  imageGenEnabled = false,
}: {
  piece: PieceCardData;
  readOnly?: boolean;
  imageGenEnabled?: boolean;
}) {
  const router = useRouter();

  const isCarrossel = piece.format === "carrossel";
  const isReels = piece.format === "reels";
  const isStories = piece.format === "stories";
  const isVideoFormat = isReels || isStories;
  const isDraft = piece.status === "draft";
  const canMutateImages = isDraft && !readOnly;
  // A draft whose scheduled slot is already more than 24h in the past
  // can't be approved as-is (see STALE_PUBLISH_AT_MS above) — approving it
  // now auto-reschedules to the next free cadence slot instead.
  const isStalePublishAt =
    isDraft && new Date().getTime() - new Date(piece.publishAt).getTime() > STALE_PUBLISH_AT_MS;
  const showPublishAtEditor =
    !readOnly && (piece.status === "draft" || piece.status === "approved" || piece.status === "failed");

  // reels/stories hold at most one media item, and when present it's a
  // video row (kind="video" — stories may instead hold a single image, in
  // which case it flows through imageItems below like carrossel/estatico).
  // The two never mix within one piece, so this split keeps the existing
  // image-grid code untouched (it never sees a video row) while giving the
  // video its own dedicated rendering block.
  const videoMedia = piece.images.find((image) => image.kind === "video");
  const imageItems = piece.images.filter((image) => image.kind !== "video");

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

  // Overlay text (estatico/stories only — carrossel uses overlayTextsValue
  // below). Same "adjust state from props" pattern as syncedPrompt; edited
  // inside the same editingPrompt mode as imagePrompt, saved together in one
  // PATCH by savePrompt.
  const [overlayTextValue, setOverlayTextValue] = useState(piece.overlayText ?? "");
  const [syncedOverlayText, setSyncedOverlayText] = useState(piece.overlayText ?? "");
  if ((piece.overlayText ?? "") !== syncedOverlayText) {
    setSyncedOverlayText(piece.overlayText ?? "");
    setOverlayTextValue(piece.overlayText ?? "");
  }

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  // Index of the thumbnail being viewed full-screen; null = viewer closed.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Video-only upload state (reels/stories). videoProgress is percentage
  // (0-100) during the direct-to-Blob upload, null when not uploading via
  // that path (e.g. local-dev multipart fallback has no progress events).
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [durationWarning, setDurationWarning] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  // Set right after an approve whose response has rescheduled: true (the
  // API auto-moved a stale draft to the next free cadence slot instead of
  // rejecting the approval). Survives router.refresh() since it's local
  // component state, keyed off setStatus rather than props; cleared on
  // un-approve and re-derived on every fresh approve attempt below.
  const [rescheduledNotice, setRescheduledNotice] = useState<string | null>(null);

  // publishAt editor (draft/approved/failed, non-readOnly). Same
  // "adjust state from props" sync pattern as syncedCaption/syncedPrompt —
  // publishAtValue holds the datetime-local input string (São Paulo local
  // time), converted via lib/format.ts's toSaoPauloDateTimeLocal /
  // fromSaoPauloDateTimeLocal (pure UTC arithmetic, not the browser's own
  // timezone).
  const [publishAtValue, setPublishAtValue] = useState(toSaoPauloDateTimeLocal(piece.publishAt));
  const [syncedPublishAt, setSyncedPublishAt] = useState(piece.publishAt);
  if (piece.publishAt !== syncedPublishAt) {
    setSyncedPublishAt(piece.publishAt);
    setPublishAtValue(toSaoPauloDateTimeLocal(piece.publishAt));
  }
  const [editingPublishAt, setEditingPublishAt] = useState(false);
  const [savingPublishAt, setSavingPublishAt] = useState(false);
  const [publishAtError, setPublishAtError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  // Manual trigger for POST /api/pieces/[id]/image/generate (Gerar
  // imagens/Continuar/Gerar de novo). generating disables every generation
  // button while the request is in flight; confirmRegenerate drives the
  // two-step inline confirmation before replacing existing images (no
  // window.confirm — this component always renders inline UI).
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Per-slide prompts editor (carrossel only). Same "adjust state from
  // props" pattern as syncedCaption/syncedPrompt above, but for an array —
  // primitive !== comparison doesn't work on arrays, so we key on a
  // stringified snapshot instead.
  const [imagePromptsValue, setImagePromptsValue] = useState<string[]>(piece.imagePrompts);
  const [syncedImagePromptsKey, setSyncedImagePromptsKey] = useState<string>(
    JSON.stringify(piece.imagePrompts),
  );
  const currentImagePromptsKey = JSON.stringify(piece.imagePrompts);
  if (currentImagePromptsKey !== syncedImagePromptsKey) {
    setSyncedImagePromptsKey(currentImagePromptsKey);
    setImagePromptsValue(piece.imagePrompts);
  }
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);

  // Per-slide overlay text editor (carrossel only), same snapshot-key sync
  // pattern as imagePromptsValue. Kept in lockstep with imagePromptsValue's
  // length by addPromptSlide/removePromptSlide so a save always submits
  // arrays of the same size — legacy pieces whose overlayTexts is shorter
  // than imagePrompts (or empty) get padded with "" when editing starts.
  const [overlayTextsValue, setOverlayTextsValue] = useState<string[]>(piece.overlayTexts);
  const [syncedOverlayTextsKey, setSyncedOverlayTextsKey] = useState<string>(
    JSON.stringify(piece.overlayTexts),
  );
  const currentOverlayTextsKey = JSON.stringify(piece.overlayTexts);
  if (currentOverlayTextsKey !== syncedOverlayTextsKey) {
    setSyncedOverlayTextsKey(currentOverlayTextsKey);
    setOverlayTextsValue(piece.overlayTexts);
  }

  const captionDirty = captionValue.trim() !== piece.caption && captionValue.trim().length > 0;
  const overlayTextDirty = overlayTextValue.trim() !== (piece.overlayText ?? "");
  const promptDirty =
    (promptValue.trim() !== piece.imagePrompt || overlayTextDirty) && promptValue.trim().length > 0;

  // A "running" status whose lock isn't active anymore (imageGenActive
  // false, computed server-side) means the last run got orphaned — same
  // stale-lock window POST .../image/generate itself reclaims
  // (lib/image-generation.ts's IMAGE_GEN_STALE_RUNNING_MS). Treated like a
  // failure in the UI so Continuar/Gerar de novo become available again.
  const imageGenStuck =
    piece.imageGenStatus === "failed" || (piece.imageGenStatus === "running" && !piece.imageGenActive);
  const canGenerateImages = canMutateImages && imageGenEnabled && !isReels;
  // The failure banner already offers Continuar/Gerar de novo when stuck —
  // showing the regular generate button too would just duplicate those
  // actions right next to it.
  const showGenerateButton = canGenerateImages && !piece.imageGenActive && !imageGenStuck;

  const atCarrosselLimit = isCarrossel && piece.images.length >= MAX_CARROSSEL_IMAGES;
  // reels/stories already hold their single allowed media item — the
  // dropzone hides until it's removed (mirrors the 409 the upload routes
  // return when a video already exists).
  const atSingleMediaLimit = isVideoFormat && piece.images.length >= 1;
  const atMediaLimit = atCarrosselLimit || atSingleMediaLimit;

  // Mirrors the server-side approval rules in PATCH /api/pieces/[id]:
  // reels needs exactly 1 video, stories needs exactly 1 media item
  // (image or video), carrossel needs >= MIN_CARROSSEL_IMAGES_TO_APPROVE,
  // estatico needs >= 1 image.
  const canApprove = isReels
    ? piece.images.length === 1 && videoMedia !== undefined
    : isStories
      ? piece.images.length === 1
      : piece.images.length >= 1 && (!isCarrossel || piece.images.length >= MIN_CARROSSEL_IMAGES_TO_APPROVE);

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
        body: JSON.stringify({
          imagePrompt: promptValue.trim(),
          ...(isCarrossel ? {} : { overlayText: overlayTextValue.trim() }),
        }),
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

  async function savePublishAt() {
    const parsed = fromSaoPauloDateTimeLocal(publishAtValue);
    if (!parsed) {
      setPublishAtError("Informe uma data e hora válidas.");
      return;
    }
    setSavingPublishAt(true);
    setPublishAtError(null);
    try {
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publishAt: parsed.toISOString() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPublishAtError(body.error ?? "Não foi possível salvar a data de publicação.");
        return;
      }
      setEditingPublishAt(false);
      router.refresh();
    } catch {
      setPublishAtError("Falha de rede ao salvar a data de publicação.");
    } finally {
      setSavingPublishAt(false);
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

  // Probes POST .../video/upload-token with an empty body to learn which
  // upload path is live: when BLOB_READ_WRITE_TOKEN is unset the route
  // returns { mode: "local" } immediately (no body parsing). When it *is*
  // set, the route instead tries to parse our empty body as a real
  // @vercel/blob/client handshake and fails — any non-"local" response
  // means Blob is configured, so we proceed to the real upload() call
  // below, which performs its own (correctly-shaped) handshake against the
  // same route.
  async function detectVideoUploadMode(): Promise<"local" | "blob"> {
    try {
      const res = await fetch(`/api/pieces/${piece.id}/video/upload-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.mode === "local") return "local";
      }
    } catch {
      // Network error probing mode — fall through to the blob path, whose
      // own request will surface a real error if the network is down.
    }
    return "blob";
  }

  async function uploadVideo(file: File) {
    setUploadError(null);
    setDurationWarning(null);

    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      setUploadError("Formato de vídeo não suportado. Envie MP4 ou MOV.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setUploadError("Vídeo maior que 200MB.");
      return;
    }

    let duration: number;
    try {
      duration = await readVideoDuration(file);
    } catch {
      setUploadError("Não foi possível ler a duração do vídeo.");
      return;
    }
    const roundedDuration = Math.round(duration);

    if (isStories && duration > MAX_STORY_VIDEO_DURATION_SEC) {
      setUploadError(
        `Vídeo de stories não pode ultrapassar ${MAX_STORY_VIDEO_DURATION_SEC}s (duração: ${roundedDuration}s).`,
      );
      return;
    }
    if (isReels) {
      if (duration > MAX_REELS_DURATION_SEC) {
        setUploadError(
          `Vídeo de reels não pode ultrapassar ${Math.round(MAX_REELS_DURATION_SEC / 60)} min (duração: ${roundedDuration}s).`,
        );
        return;
      }
      if (duration > REELS_DURATION_WARN_SEC) {
        setDurationWarning(
          `Duração de ${roundedDuration}s — recomendado até ${REELS_DURATION_WARN_SEC}s para reels (o envio vai continuar).`,
        );
      }
    }

    setUploading(true);
    setVideoProgress(0);
    try {
      const mode = await detectVideoUploadMode();
      if (mode === "local") {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("durationSec", String(roundedDuration));
        const res = await fetch(`/api/pieces/${piece.id}/video`, { method: "POST", body: formData });
        const body = await res.json();
        if (!res.ok) {
          setUploadError(body.error ?? "Falha ao enviar o vídeo.");
          return;
        }
      } else {
        const extension = VIDEO_EXTENSION_BY_CONTENT_TYPE[file.type] ?? "mp4";
        const pathname = `pieces/${piece.id}-video-${Date.now()}.${extension}`;
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: `/api/pieces/${piece.id}/video/upload-token`,
          contentType: file.type,
          onUploadProgress: ({ percentage }) => setVideoProgress(percentage),
        });
        const res = await fetch(`/api/pieces/${piece.id}/video`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: blob.url,
            contentType: file.type,
            size: file.size,
            durationSec: roundedDuration,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          setUploadError(body.error ?? "Falha ao registrar o vídeo.");
          return;
        }
      }
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Falha de rede ao enviar o vídeo.");
    } finally {
      setUploading(false);
      setVideoProgress(null);
    }
  }

  async function uploadCover(file: File) {
    setCoverError(null);
    setCoverUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/pieces/${piece.id}/video/cover`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setCoverError(body.error ?? "Não foi possível enviar a capa.");
        return;
      }
      router.refresh();
    } catch {
      setCoverError("Falha de rede ao enviar a capa.");
    } finally {
      setCoverUploading(false);
    }
  }

  function handleCoverChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadCover(file);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (files[0].type.startsWith("video/")) {
      void uploadVideo(files[0]);
    } else {
      void uploadFiles(files);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    if (files[0].type.startsWith("video/")) {
      void uploadVideo(files[0]);
    } else {
      void uploadFiles(files);
    }
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

  // Polls while a generation run owns the lock (queued, or running within
  // the stale-lock window — see imageGenActive on PieceCardData) so the
  // spinner/progress text picks up new images and the eventual done/failed
  // status without a manual refresh. A single interval per active run;
  // cleared on cleanup so it never accumulates across re-renders.
  useEffect(() => {
    if (!piece.imageGenActive) return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [piece.imageGenActive, router]);

  async function requestGeneration(mode: "replace" | "resume" | "recompose") {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/pieces/${piece.id}/image/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setGenerateError(body?.error ?? "Não foi possível iniciar a geração de imagens.");
        return;
      }
      setConfirmRegenerate(false);
      router.refresh();
    } catch {
      setGenerateError("Falha de rede ao iniciar a geração de imagens.");
    } finally {
      setGenerating(false);
    }
  }

  // addPromptSlide/removePromptSlide keep overlayTextsValue the same length
  // as imagePromptsValue at all times, so saveImagePrompts can always submit
  // two arrays of matching size (overlayTexts deve ter o mesmo tamanho de
  // imagePrompts — see PATCH /api/pieces/[id]).
  function addPromptSlide() {
    if (imagePromptsValue.length >= MAX_CARROSSEL_IMAGES) return;
    setImagePromptsValue((prev) => [...prev, ""]);
    setOverlayTextsValue((prev) => [...prev, ""]);
  }

  // 2 mirrors lib/validation.ts's imagePromptsSchema (imagePrompts needs
  // 2-10 entries) — a distinct rule from MIN_CARROSSEL_IMAGES_TO_APPROVE
  // (minimum uploaded images) that happens to share the same number.
  function removePromptSlide(index: number) {
    if (imagePromptsValue.length <= 2) return;
    setImagePromptsValue((prev) => prev.filter((_, i) => i !== index));
    setOverlayTextsValue((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePromptSlide(index: number, value: string) {
    setImagePromptsValue((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  // Legacy pieces can have overlayTexts shorter than imagePrompts (or
  // empty) — pad with "" for any slide missing an entry so the editor
  // always shows one input per current slide.
  function updateOverlayTextSlide(index: number, value: string) {
    setOverlayTextsValue((prev) => {
      const padded = imagePromptsValue.map((_, i) => prev[i] ?? "");
      padded[index] = value;
      return padded;
    });
  }

  function startEditingPrompts() {
    setOverlayTextsValue(imagePromptsValue.map((_, i) => piece.overlayTexts[i] ?? ""));
    setEditingPrompts(true);
  }

  function cancelEditingPrompts() {
    setEditingPrompts(false);
    setImagePromptsValue(piece.imagePrompts);
    setOverlayTextsValue(piece.overlayTexts);
    setPromptsError(null);
  }

  async function saveImagePrompts() {
    setSavingPrompts(true);
    setPromptsError(null);
    try {
      const trimmedPrompts = imagePromptsValue.map((p) => p.trim());
      const trimmedOverlayTexts = imagePromptsValue.map((_, i) => (overlayTextsValue[i] ?? "").trim());
      const res = await fetch(`/api/pieces/${piece.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imagePrompts: trimmedPrompts, overlayTexts: trimmedOverlayTexts }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPromptsError(body.error ?? "Não foi possível salvar os prompts.");
        return;
      }
      setEditingPrompts(false);
      router.refresh();
    } catch {
      setPromptsError("Falha de rede ao salvar os prompts.");
    } finally {
      setSavingPrompts(false);
    }
  }

  async function setStatus(status: "approved" | "draft") {
    setApproving(true);
    setApproveError(null);
    // Un-approving clears any stale reschedule notice from a previous
    // approval right away; approving re-derives it below from the fresh
    // response instead of leaving a notice from an earlier cycle around.
    if (status === "draft") {
      setRescheduledNotice(null);
    }
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
      if (status === "approved") {
        setRescheduledNotice(
          body.rescheduled === true && body.piece?.publishAt
            ? `Reagendada para ${formatDateTimeSP(body.piece.publishAt)}`
            : null,
        );
      }
      router.refresh();
    } catch {
      setApproveError("Falha de rede ao atualizar o status.");
    } finally {
      setApproving(false);
    }
  }

  // Rendered next to "Copiar prompt"/"Editar" in both places they appear
  // (with images, inside promptEditor below, and without images, in the
  // empty-prompt block further down) — kept as one function so the
  // generate/continue/regenerate button logic isn't duplicated.
  function renderGenerateButton() {
    if (!showGenerateButton) return null;

    if (imageItems.length === 0) {
      return (
        <button
          type="button"
          onClick={() => requestGeneration("replace")}
          disabled={generating}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-50"
        >
          {generating ? "Gerando..." : "Gerar imagens"}
        </button>
      );
    }

    if (confirmRegenerate) {
      return (
        <>
          <button
            type="button"
            onClick={() => requestGeneration("replace")}
            disabled={generating}
            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 disabled:opacity-50"
          >
            {generating ? "Gerando..." : "Substitui as imagens atuais. Confirmar?"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRegenerate(false)}
            disabled={generating}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
          >
            Cancelar
          </button>
        </>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setConfirmRegenerate(true)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
      >
        Gerar de novo
      </button>
    );
  }

  // "Reaplicar texto" — recomposes the overlay text on top of the already
  // generated photo(s) without calling the image model again (mode:
  // "recompose"). Shown whenever at least one image has a sourceUrl to
  // recompose from, regardless of imageGenEnabled/isReels (reels never has
  // a sourceUrl, so this simply never renders there). No confirmation step:
  // unlike "Gerar de novo" it doesn't discard any generated photo.
  function renderRecomposeButton() {
    if (!canMutateImages || piece.imageGenActive) return null;
    if (!imageItems.some((image) => image.sourceUrl)) return null;

    return (
      <button
        type="button"
        onClick={() => requestGeneration("recompose")}
        disabled={generating}
        title="Reaplica o texto sobre a foto sem gerar de novo"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-50"
      >
        {generating ? "Aguarde..." : "Reaplicar texto"}
      </button>
    );
  }

  // Overlay text for estatico/stories (carrossel uses overlayTextsValue —
  // see renderCarrosselPrompts). Read view shows the current saved text (or
  // a hint that the photo stays clean); edit view is a single textarea
  // shared with the imagePrompt editor above it.
  function renderOverlayTextDisplay() {
    const text = (piece.overlayText ?? "").trim();
    return text ? (
      <p className="text-sm text-zinc-800">
        <span className="font-medium text-zinc-500">Texto na imagem:</span> {text}
      </p>
    ) : (
      <p className="text-xs text-zinc-400">Sem texto na imagem: a foto sai limpa.</p>
    );
  }

  function renderOverlayTextEditor() {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`overlay-text-${piece.id}`} className="text-xs font-medium text-zinc-500">
          Texto na imagem (opcional)
        </label>
        <textarea
          id={`overlay-text-${piece.id}`}
          value={overlayTextValue}
          onChange={(e) => setOverlayTextValue(e.target.value)}
          maxLength={MAX_OVERLAY_TEXT_LEN}
          rows={2}
          placeholder="Deixe em branco para a foto sair limpa"
          className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
        />
      </div>
    );
  }

  // Per-slide prompts (carrossel only) — read view lists "Slide N: ..."; edit
  // view is one <textarea> per slide plus +slide/remover controls. Rendered
  // below the main imagePrompt wherever it's shown (with/without images).
  function renderCarrosselPrompts() {
    if (!isCarrossel) return null;

    return (
      <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-100 pt-2">
        <span className="text-xs font-medium text-zinc-500">Prompts por slide</span>
        {!editingPrompts ? (
          <>
            {imagePromptsValue.length > 0 && (
              <ol className="flex flex-col gap-2 text-sm text-zinc-600">
                {imagePromptsValue.map((prompt, index) => {
                  const overlayText = (piece.overlayTexts[index] ?? "").trim();
                  return (
                    <li key={index}>
                      <span className="font-medium text-zinc-500">Slide {index + 1}:</span> {prompt}
                      <div className="text-xs text-zinc-400">
                        {overlayText ? `Texto: ${overlayText}` : "sem texto"}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {imagePromptsValue.length < 2 && (
              <p className="text-xs text-amber-700">
                Sem prompts por slide: a geração automática cria só a capa.
              </p>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={startEditingPrompts}
                className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                Editar prompts por slide
              </button>
            )}
          </>
        ) : (
          <>
            {imagePromptsValue.map((prompt, index) => (
              <div key={index} className="flex flex-col gap-1 rounded-md border border-zinc-100 p-2">
                <div className="flex gap-2">
                  <span className="pt-2 text-xs font-medium text-zinc-500">{index + 1}.</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => updatePromptSlide(index, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => removePromptSlide(index)}
                    disabled={imagePromptsValue.length <= 2}
                    className="shrink-0 self-start rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-40"
                  >
                    remover
                  </button>
                </div>
                <div className="pl-5">
                  <label
                    htmlFor={`overlay-text-slide-${piece.id}-${index}`}
                    className="text-xs font-medium text-zinc-500"
                  >
                    Texto do slide {index + 1}
                  </label>
                  <input
                    id={`overlay-text-slide-${piece.id}-${index}`}
                    type="text"
                    value={overlayTextsValue[index] ?? ""}
                    onChange={(e) => updateOverlayTextSlide(index, e.target.value)}
                    maxLength={MAX_OVERLAY_TEXT_LEN}
                    placeholder="Deixe em branco para o slide sair sem texto"
                    className="w-full rounded-md border border-zinc-300 p-1.5 text-sm text-zinc-900"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addPromptSlide}
              disabled={imagePromptsValue.length >= MAX_CARROSSEL_IMAGES}
              className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-40"
            >
              + slide
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveImagePrompts}
                disabled={savingPrompts}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingPrompts ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={cancelEditingPrompts}
                disabled={savingPrompts}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                Cancelar
              </button>
            </div>
            {promptsError && <p className="text-sm text-red-600">{promptsError}</p>}
          </>
        )}
      </div>
    );
  }

  const promptEditor = !editingPrompt ? (
    <>
      <p className="whitespace-pre-wrap text-sm text-zinc-600">{piece.imagePrompt}</p>
      {!isCarrossel && renderOverlayTextDisplay()}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyPrompt}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          {copied ? "Copiado!" : "Copiar prompt"}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setEditingPrompt(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
          >
            Editar
          </button>
        )}
        {renderGenerateButton()}
        {renderRecomposeButton()}
      </div>
      {generateError && <p className="text-sm text-red-600">{generateError}</p>}
      {renderCarrosselPrompts()}
    </>
  ) : (
    <>
      <textarea
        value={promptValue}
        onChange={(e) => setPromptValue(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
      />
      {!isCarrossel && renderOverlayTextEditor()}
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
            setOverlayTextValue(piece.overlayText ?? "");
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

  const acceptTypes = isReels
    ? "video/mp4,video/quicktime"
    : isStories
      ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
      : "image/jpeg,image/png,image/webp";

  const dropzoneTitle = uploading
    ? videoProgress !== null
      ? `Enviando... ${videoProgress}%`
      : "Enviando..."
    : isReels
      ? "Selecionar vídeo do reel"
      : isStories
        ? "Selecionar imagem ou vídeo"
        : piece.images.length > 0
          ? isCarrossel
            ? "Adicionar imagem"
            : "Substituir imagem"
          : "Selecionar imagem";

  const dropzoneHint = isReels
    ? "Vídeo do reel (MP4/MOV, 9:16, até 200 MB; recomendado ≤ 90 s)"
    : isStories
      ? "Imagem (JPEG/PNG/WebP, até 8MB) ou vídeo (MP4/MOV, 9:16, até 60 s, até 200MB)"
      : `ou arraste ${isCarrossel ? "arquivos" : "um arquivo"} aqui (JPEG, PNG ou WebP, até 8MB)`;

  const uploadDropzone = canMutateImages && !atMediaLimit && !piece.imageGenActive && (
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
        <span className="font-medium text-zinc-700">{dropzoneTitle}</span>
        <span className="text-xs text-zinc-400">{dropzoneHint}</span>
        <input
          type="file"
          accept={acceptTypes}
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
        {isStalePublishAt && (
          <span
            title="Ao aprovar, a peça será reagendada para o próximo horário livre da cadência."
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          >
            Data vencida
          </span>
        )}
        <span className="text-xs text-zinc-500">
          {piece.pillar} · {piece.segment}
        </span>
      </div>

      {piece.imageGenActive && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            {isCarrossel
              ? `Gerando imagens (${imageItems.length} de ${piece.imagePrompts.length || 1} prontas)`
              : "Gerando imagens..."}
          </span>
        </div>
      )}

      {imageGenStuck && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p>{piece.imageGenError ?? "Geração interrompida"}</p>
          {canGenerateImages && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => requestGeneration("resume")}
                disabled={generating}
                className="rounded-md bg-amber-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {generating ? "Aguarde..." : "Continuar"}
              </button>
              <button
                type="button"
                onClick={() => requestGeneration("replace")}
                disabled={generating}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 disabled:opacity-50"
              >
                {generating ? "Aguarde..." : "Gerar de novo"}
              </button>
            </div>
          )}
          {generateError && <p className="text-red-700">{generateError}</p>}
        </div>
      )}

      {piece.imageGenStatus === "done" && piece.imageGenError && (
        <p className="text-xs text-amber-700">{piece.imageGenError}</p>
      )}

      <div className="flex flex-col gap-2">
        {videoMedia && (
          <div className="flex flex-col gap-2">
            <div className="relative overflow-hidden rounded-md bg-black">
              <video
                controls
                playsInline
                muted
                preload="metadata"
                poster={videoMedia.coverUrl ?? undefined}
                className="max-h-80 w-full rounded-md"
              >
                <source src={videoMedia.url} type={videoMedia.contentType ?? undefined} />
              </video>
              {canMutateImages && (
                <button
                  type="button"
                  onClick={() => removeImage(videoMedia.id)}
                  disabled={removingImageId === videoMedia.id || uploading}
                  aria-label="Remover vídeo"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600/90 text-sm font-semibold text-white disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </div>

            {videoMedia.durationSec != null && (
              <p className="text-xs text-zinc-500">Duração: {videoMedia.durationSec} s</p>
            )}

            {isReels && canMutateImages && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">Capa (opcional)</span>
                <div className="flex items-center gap-2">
                  {videoMedia.coverUrl && (
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
                      <img src={videoMedia.coverUrl} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700">
                    {coverUploading ? "Enviando..." : videoMedia.coverUrl ? "Trocar capa" : "Enviar capa"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleCoverChange}
                      disabled={coverUploading}
                    />
                  </label>
                </div>
                {coverError && <p className="text-sm text-red-600">{coverError}</p>}
              </div>
            )}
          </div>
        )}

        {imageItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imageItems.map((image, index) => (
                <div key={image.id} className="flex w-20 shrink-0 flex-col gap-1">
                  <div className="relative aspect-square w-20 overflow-hidden rounded-md bg-zinc-100">
                    {/*
                      The thumbnail is a button so tapping it opens the
                      full-screen viewer. The index badge and the remove "×"
                      are absolutely positioned siblings rendered after it, so
                      they stack on top and receive their own clicks — no
                      event-propagation juggling needed.
                    */}
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      aria-label={`Ampliar imagem ${index + 1}`}
                      className="block h-full w-full cursor-zoom-in"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- image can come from same-origin /uploads or an arbitrary Vercel Blob host in prod */}
                      <img src={image.url} alt="" className="h-full w-full object-cover" />
                    </button>
                    <span className="pointer-events-none absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/80 text-xs font-semibold text-white">
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
                  {canMutateImages && isCarrossel && imageItems.length > 1 && (
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
                        disabled={index === imageItems.length - 1 || reordering || uploading}
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

            <p className="text-xs text-zinc-400">Toque em uma imagem para ampliar.</p>

            {isCarrossel && (
              <>
                <p className="text-xs text-zinc-500">
                  A ordem das miniaturas é a ordem de publicação do carrossel.
                </p>
                <p
                  className={`text-xs ${
                    imageItems.length < MIN_CARROSSEL_IMAGES_TO_APPROVE ? "text-amber-700" : "text-zinc-500"
                  }`}
                >
                  {imageItems.length} {imageItems.length === 1 ? "imagem" : "imagens"} (mín.{" "}
                  {MIN_CARROSSEL_IMAGES_TO_APPROVE} para aprovar — o prompt sugere 4 slides)
                </p>
              </>
            )}
          </div>
        )}

        {!canMutateImages && !readOnly && piece.images.length > 0 && (
          <p className="text-xs text-zinc-400">
            {videoMedia ? "Mídia congelada" : "Imagens congeladas"} após aprovação.
          </p>
        )}

        {atCarrosselLimit && (
          <p className="text-xs text-zinc-400">Limite de {MAX_CARROSSEL_IMAGES} imagens atingido.</p>
        )}

        {durationWarning && <p className="text-sm text-amber-700">{durationWarning}</p>}

        {piece.images.length === 0 && !editingPrompt && (
          <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">
            <p className="whitespace-pre-wrap">{piece.imagePrompt}</p>
            {!isCarrossel && <div className="mt-1">{renderOverlayTextDisplay()}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyPrompt}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
              >
                {copied ? "Copiado!" : "Copiar prompt"}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setEditingPrompt(true)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
                >
                  Editar
                </button>
              )}
              {renderGenerateButton()}
            </div>
            {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}
            {renderCarrosselPrompts()}
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
            {!isCarrossel && renderOverlayTextEditor()}
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
                  setOverlayTextValue(piece.overlayText ?? "");
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
        {readOnly ? (
          <>
            <span className="text-xs font-medium text-zinc-500">Legenda</span>
            <p className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-2 text-sm text-zinc-900">
              {piece.caption}
            </p>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {showPublishAtEditor && (
        <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
          {!editingPublishAt ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-zinc-600">
                Publicação: {formatDateTimeSP(piece.publishAt)} (horário de Brasília)
              </span>
              <button
                type="button"
                onClick={() => {
                  setPublishAtValue(toSaoPauloDateTimeLocal(piece.publishAt));
                  setPublishAtError(null);
                  setEditingPublishAt(true);
                }}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
              >
                Alterar data
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor={`publish-at-${piece.id}`} className="text-xs font-medium text-zinc-500">
                Publicação (horário de Brasília)
              </label>
              <input
                id={`publish-at-${piece.id}`}
                type="datetime-local"
                value={publishAtValue}
                onChange={(e) => setPublishAtValue(e.target.value)}
                className="w-full rounded-md border border-zinc-300 p-2 text-sm text-zinc-900"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={savePublishAt}
                  disabled={savingPublishAt}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {savingPublishAt ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPublishAt(false);
                    setPublishAtValue(toSaoPauloDateTimeLocal(piece.publishAt));
                    setPublishAtError(null);
                  }}
                  disabled={savingPublishAt}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
                >
                  Cancelar
                </button>
              </div>
              {publishAtError && <p className="text-sm text-red-600">{publishAtError}</p>}
            </div>
          )}
          {isStalePublishAt && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              <span className="font-semibold">Data vencida.</span> Ao aprovar, a peça será reagendada para
              o próximo horário livre da cadência.
            </p>
          )}
        </div>
      )}

      {readOnly ? (
        piece.status === "approved" && (
          <p className="border-t border-zinc-100 pt-3 text-sm text-zinc-600">
            {publishCountdown(piece.publishAt)}
          </p>
        )
      ) : (
        <>
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
                  {piece.imageGenActive
                    ? "Aguarde a geração terminar"
                    : canApprove
                      ? "Pronto para aprovar"
                      : isReels
                        ? "Reels exige exatamente 1 vídeo para aprovar"
                        : isStories
                          ? "Stories exige 1 imagem ou 1 vídeo (≤ 60 s) para aprovar"
                          : piece.images.length === 0
                            ? "Envie uma imagem para aprovar"
                            : `Envie mais ${MIN_CARROSSEL_IMAGES_TO_APPROVE - piece.images.length} imagem(ns) para aprovar`}
                </span>
                <button
                  type="button"
                  onClick={() => setStatus("approved")}
                  disabled={!canApprove || approving || piece.imageGenActive}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {approving ? "Aprovando..." : "Aprovar"}
                </button>
              </>
            )}
          </div>
          {approveError && <p className="text-sm text-red-600">{approveError}</p>}
          {rescheduledNotice && <p className="text-sm text-emerald-700">{rescheduledNotice}</p>}
        </>
      )}

      <ImageLightbox
        images={imageItems}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
