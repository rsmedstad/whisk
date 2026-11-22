// Shared photo storage rules for /api/upload and the MCP add_recipe_photo tool.
// One code path: size cap, allowed types, byte sniffing, hash-based R2 key.

import { sniffImageType } from "./image-sniff";

/** 10 MB max photo size. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Allowed image MIME types (declared types are checked, bytes are sniffed). */
export const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** Normalize a declared type ("jpeg", "image/JPEG", "png; charset=x") to a
 *  lowercase MIME type, or null if it isn't one of the allowed photo types. */
export function normalizePhotoType(raw: string): string | null {
  let t = raw.split(";")[0]!.trim().toLowerCase();
  if (!t) return null;
  if (!t.includes("/")) t = `image/${t}`;
  return ALLOWED_PHOTO_TYPES.has(t) ? t : null;
}

export type StorePhotoResult =
  | { ok: true; key: string; url: string; contentType: string }
  | { ok: false; status: number; error: string };

/** Validate image bytes and store them in R2 under photos/{sha256[0..16]}.{ext}.
 *  The bytes decide the stored type; the caller checks the declared type. */
export async function storePhoto(
  r2: R2Bucket,
  buffer: ArrayBuffer
): Promise<StorePhotoResult> {
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, status: 413, error: "File too large. Maximum size is 10 MB." };
  }
  if (buffer.byteLength === 0) {
    return { ok: false, status: 400, error: "Image is empty." };
  }

  const storedType = sniffImageType(buffer);
  if (!storedType) {
    return { ok: false, status: 415, error: "File is not a valid image." };
  }

  const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
  const hashHex = [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  const ext = storedType.includes("png")
    ? "png"
    : storedType.includes("webp")
      ? "webp"
      : "jpg";

  const key = `photos/${hashHex}.${ext}`;
  await r2.put(key, buffer, {
    httpMetadata: { contentType: storedType },
  });

  return { ok: true, key, url: `/${key}`, contentType: storedType };
}
