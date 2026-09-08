// Text overlay compositor for generated piece images.
//
// Why this exists: flux-2-klein-4b (lib/image-gen/cloudflare.ts) renders
// convincing photos but misspells pt-BR words when asked to draw text
// ("Confirmação" came back as "Confimação", "grátis" as "cráis"). So the
// model now generates the scene only — append NO_TEXT_PROMPT_SUFFIX to every
// prompt — and the headline is composited here with a real font.
//
// Pipeline: satori + resvg (both bundled inside next/og's ImageResponse)
// rasterize the headline into a transparent PNG layer, then sharp resizes the
// photo to the target aspect and composites the layer on top, re-encoding as
// JPEG.
//
// Alternatives rejected: @resvg/resvg-js (extra native binary, architecture
// risk on Vercel) and sharp's SVG <text> (needs fontconfig + system fonts,
// absent on Vercel). ImageResponse only needs a TTF, which we vendor in
// assets/fonts/Inter-Bold.ttf (SIL OFL 1.1, see the OFL.txt next to it).
//
// Note: ImageResponse is just a Response subclass, so it works outside a
// route handler — await response.arrayBuffer() gives the PNG bytes.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";

import { ASPECT_DIMENSIONS, type ImageAspect } from "./provider";

/**
 * Appended to every scene prompt so the model leaves the frame clean for the
 * composited headline. Deliberately does NOT mention "headline" or "space for
 * text" — naming text at all nudges flux into drawing letters anyway.
 */
export const NO_TEXT_PROMPT_SUFFIX =
  " No text, no letters, no words, no numbers, no signs, no logos, no watermarks anywhere in the image. Plain, uncluttered background in the upper part of the frame.";

// Read once per process. The literal join(process.cwd(), ...) shape is what
// Next's file tracing looks for, so the TTF ships with the serverless bundle
// (see the "Custom fonts" example in next/dist/docs .../image-response.md).
// Kept lazy (rather than a module-scope top-level await) so importing this
// module stays synchronous for callers that never composite anything.
let fontPromise: Promise<Buffer> | null = null;

function loadFont(): Promise<Buffer> {
  fontPromise ??= readFile(join(process.cwd(), "assets", "fonts", "Inter-Bold.ttf"));
  return fontPromise;
}

/**
 * Headline size relative to the image width. Long copy steps down so ~200
 * characters still fit inside the top band instead of overflowing the frame.
 */
function fontSizeFor(text: string, width: number): number {
  const ratio = text.length > 90 ? 0.05 : text.length > 40 ? 0.06 : 0.075;
  return Math.round(width * ratio);
}

/**
 * Builds the transparent text layer: a dark top-to-bottom scrim (so white
 * copy stays readable over a bright photo) with the headline on top.
 * Satori only supports flexbox — no grid, no floats.
 */
function buildLayerElement(text: string, width: number, height: number) {
  const scrim = createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "45%",
      backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
    },
  });

  const headline = createElement(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        color: "#ffffff",
        fontFamily: "Inter",
        fontWeight: 700,
        fontSize: fontSizeFor(text, width),
        lineHeight: 1.1,
        textAlign: "left",
        // Honours the \n authors type in the headline instead of collapsing it.
        whiteSpace: "pre-wrap",
      },
    },
    text,
  );

  const textBlock = createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        paddingLeft: Math.round(width * 0.06),
        paddingRight: Math.round(width * 0.06),
        paddingTop: Math.round(height * 0.07),
      },
    },
    headline,
  );

  return createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        position: "relative",
        width: "100%",
        height: "100%",
        background: "transparent",
      },
    },
    scrim,
    textBlock,
  );
}

/**
 * Resizes `photo` to the aspect's canonical dimensions and burns `text` into
 * the top band. An empty/blank `text` skips the overlay and only normalizes
 * the photo, so callers can pipe every generated image through here.
 *
 * Always returns JPEG bytes (quality 90) — well under Instagram's 8MB limit
 * at the sizes in ASPECT_DIMENSIONS.
 */
export async function composeOverlay(input: {
  photo: Uint8Array;
  aspect: ImageAspect;
  text: string;
}): Promise<{ bytes: Uint8Array; contentType: "image/jpeg" }> {
  const { photo, aspect, text } = input;
  const { width, height } = ASPECT_DIMENSIONS[aspect];

  try {
    const base = sharp(Buffer.from(photo)).resize(width, height, { fit: "cover" });

    if (!text.trim()) {
      const bytes = await base.jpeg({ quality: 90 }).toBuffer();
      return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
    }

    const fontData = await loadFont();
    const response = new ImageResponse(buildLayerElement(text, width, height), {
      width,
      height,
      fonts: [
        {
          name: "Inter",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    });

    const layer = Buffer.from(await response.arrayBuffer());

    const bytes = await base
      .composite([{ input: layer }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  } catch (err) {
    throw new Error(`overlay: ${err instanceof Error ? err.message : String(err)}`);
  }
}
