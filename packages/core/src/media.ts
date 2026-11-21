import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type Sharp } from "sharp";

export const IMAGE_WIDTHS = { small: 160, medium: 400, large: 1000 } as const;
export type ImageSize = keyof typeof IMAGE_WIDTHS;

/** Public URL of one of our own image copies. Served by the API under /media with immutable caching (keys are content hashes). */
export function mediaUrl(storageKey: string, size: ImageSize): string {
  return `/media/${storageKey}-${IMAGE_WIDTHS[size]}.webp`;
}

export function mediaFile(mediaDir: string, storageKey: string, width: number): string {
  return path.join(mediaDir, `${storageKey}-${width}.webp`);
}

export async function writeMedia(mediaDir: string, storageKey: string, width: number, data: Buffer): Promise<void> {
  const file = mediaFile(mediaDir, storageKey, width);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

// ------------------------------------------------------------------------------------------------ processing

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
/** Below this a photo is refused: it would only ever be a blur in the card. */
export const IMAGE_MIN_SIDE = 64;
/** Below this the admin is warned that the photo will look soft on the product page. */
export const IMAGE_SOFT_SIDE = 500;
const MAX_INPUT_PIXELS = 60_000_000;
/** White margin around the product inside the square, as a share of the side. Keeps every card visually even. */
const SQUARE_MARGIN = 0.06;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export class ImageError extends Error {
  constructor(
    readonly code: "too_large" | "too_small" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

export interface ProcessedImage {
  storageKey: string;
  /** Size of the original photo (after EXIF rotation), for the admin's quality hint. */
  width: number;
  height: number;
}

/**
 * Turns any uploaded or downloaded picture into our three public WebP widths under a content-hashed key.
 *
 * `square` (every product photo, from MoySklad or the admin): the result is ALWAYS a 1:1 picture on white, so the storefront grid,
 * the Mini App and the product page look the same whatever was uploaded (portrait phone photo, wide scan, transparent PNG, tiny icon):
 *  1. EXIF rotation applied, CMYK/16-bit converted to sRGB, transparency flattened onto white (dark artwork stays visible in dark mode);
 *  2. an existing plain white border is trimmed, so a product shot with a huge white margin does not look tiny next to the others;
 *  3. the picture is fitted — never stretched, never cropped — into the square with an even white margin.
 * Without `square` (banners) the aspect ratio is kept and only the width is bounded.
 */
export async function processImage(mediaDir: string, input: Buffer, opts: { square?: boolean } = {}): Promise<ProcessedImage> {
  if (input.length > IMAGE_MAX_BYTES) throw new ImageError("too_large", `image too large (${input.length} bytes)`);
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, density: 144, failOn: "error" });

  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch (err) {
    throw new ImageError("unsupported", `not a readable image: ${(err as Error).message}`);
  }
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? 0;
  const height = (swap ? meta.width : meta.height) ?? 0;
  if (meta.pages && meta.pages > 1 && meta.format !== "gif") throw new ImageError("unsupported", "multi-page images are not supported");
  if (width < IMAGE_MIN_SIDE || height < IMAGE_MIN_SIDE) throw new ImageError("too_small", `image too small (${width}×${height})`);

  // The mode is part of the key: the same bytes as a banner and as a product photo are two different outputs.
  const hash = createHash("sha256").update(input).update(opts.square ? "|square-v1" : "|fit-v1").digest("hex").slice(0, 20);
  const storageKey = `${hash.slice(0, 2)}/${hash}`;

  try {
    if (opts.square) await writeSquare(mediaDir, storageKey, open);
    else {
      const base = open().rotate();
      for (const w of Object.values(IMAGE_WIDTHS)) {
        const out = await base.clone().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        await writeMedia(mediaDir, storageKey, w, out);
      }
    }
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError("unsupported", `could not decode image: ${(err as Error).message}`);
  }
  return { storageKey, width, height };
}

async function writeSquare(mediaDir: string, storageKey: string, open: () => Sharp): Promise<void> {
  // 1. Normalise once to a bounded sRGB bitmap on white. (sharp applies operations in a fixed order, so each stage is its own pass.)
  const flat = await open()
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .flatten({ background: WHITE })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: flat.info.width, height: flat.info.height, channels: flat.info.channels } } as const;

  // 2. Trim a plain white (or near-white) border. Only white: a coloured studio background is part of the photo and stays.
  let subject = flat;
  try {
    const trimmed = await sharp(flat.data, raw).trim({ background: "#ffffff", threshold: 10 }).raw().toBuffer({ resolveWithObject: true });
    // Guard against trimming a photo down to a speck (an almost-white picture): keep the original then.
    if (trimmed.info.width >= flat.info.width * 0.1 && trimmed.info.height >= flat.info.height * 0.1 && trimmed.info.width >= 16 && trimmed.info.height >= 16) {
      subject = trimmed;
    }
  } catch {
    // Nothing to trim (sharp throws on a uniform picture): use it as it is.
  }
  const subjectRaw = { raw: { width: subject.info.width, height: subject.info.height, channels: subject.info.channels } } as const;

  // 3. Fit into the square with an even margin. "contain" keeps proportions; small photos are enlarged so they still fill the card.
  for (const side of Object.values(IMAGE_WIDTHS)) {
    const margin = Math.round(side * SQUARE_MARGIN);
    const inner = side - 2 * margin;
    const out = await sharp(subject.data, subjectRaw)
      .resize({ width: inner, height: inner, fit: "contain", background: WHITE, kernel: "lanczos3" })
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: WHITE })
      .webp({ quality: 80 })
      .toBuffer();
    await writeMedia(mediaDir, storageKey, side, out);
  }
}
