"use client";

import { adminFetch, type AdminResult } from "./api";
import type { AdminLang } from "./i18n";

/** Longest side sent to the server. The server makes 1000 px squares, so more is only slower uploads on a phone connection. */
const MAX_SIDE = 2000;
const SERVER_LIMIT = 15 * 1024 * 1024;
const PASS_THROUGH = /^image\/(jpeg|png|webp)$/;

export class ImagePrepError extends Error {}

/**
 * Prepares a picked photo for upload, in the browser:
 * - a 12-megapixel phone photo (5–10 MB) becomes a ~2000 px JPEG of a few hundred KB, so uploads are quick on mobile data;
 * - iPhone HEIC photos are decoded by Safari and sent as JPEG (the server cannot read HEIC);
 * - EXIF rotation is applied, transparency is put on white (the server does both again; this just keeps what is sent small).
 * A small JPEG/PNG/WebP is sent untouched, so nothing is re-compressed for no reason.
 */
export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // This browser cannot decode it (e.g. HEIC outside Safari). Let the server try, if it is a format it may know.
    if (file.size <= SERVER_LIMIT && /^image\/(jpeg|png|webp|gif|avif|tiff)$/.test(file.type)) return file;
    throw new ImagePrepError("decode");
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 2.5 * 1024 * 1024 && PASS_THROUGH.test(file.type)) return file;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImagePrepError("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new ImagePrepError("encode");
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Message for an upload failure, for the owner (not a developer), in the admin's language. */
export function uploadErrorText(lang: AdminLang, r: AdminResult<{ error?: string; message?: string }> | null, err?: unknown): string {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  if (err instanceof ImagePrepError) return t("Этот файл не удалось открыть как картинку. Сохраните фото как JPG или PNG и загрузите снова.", "Bu faylni rasm sifatida ochib boʻlmadi. Rasmni JPG yoki PNG qilib saqlang va qayta yuklang.");
  if (!r) return t("Не удалось загрузить: проверьте интернет и попробуйте ещё раз.", "Yuklab boʻlmadi: internetni tekshirib, qayta urinib koʻring.");
  switch (r.data.error) {
    case "image_too_small":
      return t("Фото слишком маленькое (меньше 64 пикселей). Нужна фотография побольше.", "Rasm juda kichik (64 pikseldan kam). Kattaroq rasm kerak.");
    case "image_too_large":
      return t("Файл больше 15 МБ.", "Fayl 15 MB dan katta.");
    case "image_unsupported":
      return t("Этот файл не удалось прочитать как картинку. Сохраните фото как JPG или PNG.", "Bu faylni rasm sifatida oʻqib boʻlmadi. Rasmni JPG yoki PNG qilib saqlang.");
    case "too_many_images": {
      const max = r.data.message?.match(/^At most (\d+) photos per product\.$/)?.[1];
      return max ? t(`Не больше ${max} фото на товар.`, `Bitta tovarga koʻpi bilan ${max} ta rasm.`) : t("Слишком много фото.", "Rasmlar juda koʻp.");
    }
    default:
      return r.status === 413 ? t("Файл слишком большой.", "Fayl juda katta.") : t(`Ошибка загрузки (${r.status}).`, `Yuklashda xato (${r.status}).`);
  }
}

export function uploadProductImage<T>(productId: string, file: File, lang: AdminLang): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  return uploadImageTo<T>(`/products/${productId}/images`, file, lang);
}

/** Downsizes in the browser, then POSTs the bytes to an admin image endpoint (product photo or banner). */
export async function uploadImageTo<T>(path: string, file: File, lang: AdminLang): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let blob: Blob;
  try {
    blob = await prepareImage(file);
  } catch (err) {
    return { ok: false, error: uploadErrorText(lang, null, err) };
  }
  try {
    const r = await adminFetch<T & { error?: string; message?: string }>(path, { method: "POST", raw: blob, contentType: blob.type || "image/jpeg" });
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: uploadErrorText(lang, r) };
  } catch {
    return { ok: false, error: uploadErrorText(lang, null) };
  }
}
