interface Env {
  WHISK_R2: R2Bucket;
}

// Serve photos from R2 at /photos/*
// Outside /api/ so auth middleware is bypassed — photos are public assets
export const onRequest: PagesFunction<Env> = async ({ params, env }) => {
  const path = (params.path as string[]).join("/");
  const key = `photos/${path}`;

  const object = await env.WHISK_R2.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? "image/jpeg"
  );
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.etag);

  return new Response(object.body, { headers });
};
