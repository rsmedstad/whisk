# Discover: try the import before offering the source site

## What changed
- Discover no longer opens the blocked-source sheet from a hostname match. Tapping a Kitchn card (and the quick-save +) now runs the normal import first (cached recipe, JSON-LD, RSS fallback on the server). The fallback appears only when the server returns `source_blocked`.
- On the detail screen the fallback is the inline card: plain message, one "Open on <source>" button (still records the pending import so Save to Whisk finishes it), one "Set up one-tap Save to Whisk" link. No second popup over it.
- Quick-save opens the sheet only after a `source_blocked` error.
- Sheet simplified: dropped the X-Frame-Options explanation and the separate bookmarklet / iOS Shortcut links; one setup link remains (iOS without bookmarklet goes to /shortcut, otherwise Settings).

## Tested
- `npx tsc --noEmit` clean; `bun test` 173 pass, 0 fail; `bun run build` ok.
- Updated copy tests in `tests/pending-import.test.ts`.

## Not tested
- No local run or live check: no `.dev.vars` / Cloudflare token in this environment. Whether Kitchn actually imports now depends on the server (403 plus empty RSS teaser means the fallback still shows, as before).

## Follow-ups
- Check on device that a Kitchn tap shows the recipe or the inline card.
- If Kitchn always blocks, consider a Browser Rendering attempt for it in `resolveRecipeSource`.
