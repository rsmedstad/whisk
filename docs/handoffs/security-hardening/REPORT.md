# Security hardening

## Changed
- Import overlay middleware: SSRF check (`isSafeFetchUrl`) before fetching the user-supplied URL.
- New `safeFetch` (ssrf.ts): manual redirect following, every hop re-checked. Used by recipe page fetch and the import overlay.
- Upload: content type now sniffed from file bytes (`image-sniff.ts`); non-images rejected with 415.
- Image proxy: 10 MB cap, image/* content type required, final host re-checked against the allowlist.
- `DELETE /api/share/:token` revokes a share link (auth required). No UI wired yet.

## Tested
- `bun test`, `npx tsc --noEmit`, `bun run build` (see PR).

## Left / follow-ups
- UI button for share revoke; optional share TTL.
- WAF rate-limit rule on `/api/auth` (dashboard).
- `bun audit fix` for dev-only advisories (lighthouse chain).
- Split `recipes:index` KV key if the book grows past a few thousand recipes.
- Preview deploys still share production KV/R2.
