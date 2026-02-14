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

    const key = `photos/${file.name}`;
    await env.WHISK_R2.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || "image/webp",
      },
    });

    return new Response(
      JSON.stringify({ url: `/photos/${file.name}`, key }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(JSON.stringify({ error: "Upload failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
