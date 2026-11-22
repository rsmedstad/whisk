import { MAX_PHOTO_BYTES, normalizePhotoType, storePhoto } from "../lib/photo-store";

interface Env {
  WHISK_R2: R2Bucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/upload
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return json({ error: "No file provided" }, 400);
    }

    // Validate file size before reading the body
    if (file.size > MAX_PHOTO_BYTES) {
      return json({ error: "File too large. Maximum size is 10 MB." }, 413);
    }

    // Validate the declared file type
    if (!normalizePhotoType(file.type || "image/webp")) {
      return json(
        { error: "Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed." },
        415
      );
    }

    // Trust the file's bytes, not the client-declared type
    const stored = await storePhoto(env.WHISK_R2, await file.arrayBuffer());
    if (!stored.ok) {
      return json({ error: stored.error }, stored.status);
    }

    return json({ url: stored.url, key: stored.key });
  } catch {
    return json({ error: "Upload failed" }, 500);
  }
};
