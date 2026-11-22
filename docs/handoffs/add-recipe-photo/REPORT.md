# add_recipe_photo MCP tool

## Changed
- New MCP tool `add_recipe_photo` (`functions/lib/mcp-tools.ts`, dispatched through `callTool` used by `mcp-handler.ts`).
  - Inputs: `id` (required); exactly one of `imageBase64` + `contentType` (jpeg, png, webp, heic, heif; `image/*` forms and a `data:` URL prefix accepted) or `imageUrl` (public https, fetched with `safeFetch` so every redirect hop is SSRF-checked, 15 s timeout, body read capped at 10 MB); optional `makePrimary` (default true only when the recipe has no photos).
  - Add-only: appends `{ url: "/photos/<hash>.<ext>", isPrimary }` to `recipe.photos`; existing photos are never removed. Primary clears `isPrimary` on the others and sets `thumbnailUrl` on the recipe and its `recipes:index` entry. Re-sending the same image does not duplicate it (`alreadyAttached: true`).
  - Returns `{ ok, id, url, key, isPrimary, alreadyAttached, photos, actorUserId, actorSource }`.
- New `functions/lib/photo-store.ts`: shared 10 MB cap, allowed types, byte sniffing, `photos/{sha256[0..16]}.{ext}` R2 key. `functions/api/upload.ts` now uses it (same responses; an empty file now returns 400 instead of 415).
- README: new "Optional: MCP Server" section listing all tools, including `add_recipe_photo`.

## Tested
- `bun test`: 254 pass, 0 fail (20 files); `tests/mcp.test.ts` 57 pass, 15 new add_recipe_photo tests (base64 path, URL path with mocked fetch, http/localhost/private IP/redirect-to-metadata rejection, bad type, non-image bytes, oversized base64, oversized URL via content-length and via streamed body, id/argument validation, existing photos kept, makePrimary, dedupe, tools/list).
- `npx tsc --noEmit`: clean. `bun run build`: OK.

## Left / follow-ups
- Resize to ~1600 px skipped: needs the Cloudflare Images binding (new setup, possible spend) or a heavy wasm codec. Originals are stored.
- HEIC is stored as-is (with a `.jpg` key, same as `/api/upload`) and only renders in Safari. Senders should prefer JPEG.
- First real use: Grok Bot attaches Ryan's photo to `r_795c10d5`.

## Blockers
- None.
