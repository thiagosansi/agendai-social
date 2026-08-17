"use client";

import { useEffect, useRef, useState } from "react";
import type { TouchEvent } from "react";

export interface LightboxImage {
  id: string;
  url: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index of the image to show; `null` keeps the dialog closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

// Horizontal travel (px) that counts as a swipe rather than a tap/scroll.
const SWIPE_THRESHOLD = 48;

/**
 * Full-screen viewer for uploaded piece images, opened by tapping a thumbnail
 * in PieceCard.
 *
 * Built on the native <dialog> element rather than a hand-rolled overlay: it
 * gives us the top layer (so nothing in the card can paint over it), Escape to
 * close, a focus trap, and inert background content without extra code.
 *
 * Two zoom levels only — fit-to-screen and 2x. At 2x the image overflows a
 * scrollable container, which hands panning to the browser's native touch
 * scrolling instead of reimplementing drag/pinch gestures.
 */
export function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStartX = useRef<number | null>(null);

  const [zoomed, setZoomed] = useState(false);

  // Every image starts fit-to-screen, otherwise the previous one's zoom state
  // bleeds into it. Adjusted during render rather than in an effect — same
  // pattern the caption/prompt fields in PieceCard use for prop-driven resets.
  const [syncedIndex, setSyncedIndex] = useState(index);
  if (index !== syncedIndex) {
    setSyncedIndex(index);
    setZoomed(false);
  }

  // `current` is undefined once the piece loses the image being viewed (a
  // delete in another tab, or a router.refresh() landing mid-view). Treating
  // that as "closed" makes the effect below call dialog.close(), which fires
  // the dialog's `close` event and lets the parent reset its index — so the
  // viewer never renders an empty frame.
  const current = index !== null ? images[index] : undefined;
  const isOpen = current !== undefined;

  // Drive the dialog imperatively — showModal() is the only way to get the top
  // layer plus a real backdrop, and it has no declarative JSX equivalent.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function step(delta: number) {
    if (index === null) return;
    const next = index + delta;
    if (next < 0 || next >= images.length) return;
    onIndexChange(next);
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    // While zoomed, horizontal drags belong to the scroll container (panning).
    touchStartX.current = zoomed ? null : (e.touches[0]?.clientX ?? null);
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) return;

    const endX = e.changedTouches[0]?.clientX;
    if (endX === undefined) return;

    const travel = endX - startX;
    if (Math.abs(travel) < SWIPE_THRESHOLD) return;
    step(travel < 0 ? 1 : -1);
  }

  return (
    <dialog
      ref={dialogRef}
      // `close` fires for Escape and for form-method=dialog alike, so syncing
      // parent state here covers every path out of the viewer.
      onClose={onClose}
      onClick={(e) => {
        // A click that lands on the <dialog> itself is a backdrop click — the
        // content below stops propagation of its own clicks.
        if (e.target === dialogRef.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        }
      }}
      aria-label="Visualização da imagem"
      // Opaque rather than translucent: this is a review surface, and page
      // content bleeding through both distracts and skews how the image's own
      // colours read.
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-black"
    >
      <div className="flex h-full w-full flex-col bg-black">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
          <span className="text-sm font-medium text-white/80">
            {index !== null ? index + 1 : 0} / {images.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              aria-pressed={zoomed}
              className="rounded-md bg-white/15 px-3 py-2 text-sm font-medium text-white"
            >
              {zoomed ? "Reduzir" : "Ampliar"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar visualização"
              className="flex h-10 w-10 items-center justify-center rounded-md bg-white/15 text-xl font-medium leading-none text-white"
            >
              ×
            </button>
          </div>
        </div>

        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`flex min-h-0 flex-1 ${
            zoomed ? "overflow-auto" : "items-center justify-center overflow-hidden"
          }`}
        >
          {current && (
            /* eslint-disable-next-line @next/next/no-img-element -- same rationale as PieceCard: the URL is either a same-origin /uploads path or an arbitrary Vercel Blob host */
            <img
              key={current.id}
              src={current.url}
              alt={`Imagem ${index !== null ? index + 1 : 1} da peça`}
              onClick={(e) => {
                e.stopPropagation();
                setZoomed((z) => !z);
              }}
              className={
                zoomed
                  ? // shrink-0 is load-bearing: as a flex item the image would
                    // otherwise be shrunk back to fit the container, cancelling
                    // most of the zoom.
                    "w-[200%] max-w-none shrink-0 cursor-zoom-out"
                  : "max-h-full max-w-full cursor-zoom-in object-contain"
              }
            />
          )}
        </div>

        {images.length > 1 && (
          <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={index === 0}
              aria-label="Imagem anterior"
              className="h-11 flex-1 rounded-md bg-white/15 text-lg font-medium text-white disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={index === images.length - 1}
              aria-label="Próxima imagem"
              className="h-11 flex-1 rounded-md bg-white/15 text-lg font-medium text-white disabled:opacity-30"
            >
              →
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
