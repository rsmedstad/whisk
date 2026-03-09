interface Env {
  WHISK_R2: R2Bucket;
}

// 10 MB max upload size
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed image MIME types
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// POST /api/upload
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "File too large. Maximum size is 10 MB." }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate file type
    const contentType = file.type || "image/webp";
    if (!ALLOWED_TYPES.has(contentType.toLowerCase())) {
      return new Response(JSON.stringify({ error: "Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed." }), {
        status: 415,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate a unique hash-based filename to avoid collisions
    const buffer = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

    const key = `photos/${hashHex}.${ext}`;
    await env.WHISK_R2.put(key, buffer, {
      httpMetadata: { contentType },
    });

    return new Response(
      JSON.stringify({ url: `/${key}`, key }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(JSON.stringify({ error: "Upload failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
