interface Env {
  WHISK_R2: R2Bucket;
}

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

    // Generate a unique hash-based filename to avoid collisions
    const buffer = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const contentType = file.type || "image/webp";
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
