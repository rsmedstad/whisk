# Report: Add-from-URL opens the blocked-source sheet

Doc status: Active, 2026-10-27
Repo / branch: rsmedstad/whisk, `fix/add-url-blocked-sheet`, from `main`

## What changed
- `RecipeForm.tsx`: when `/api/import/url` answers `source_blocked`, the Add screen opens the same sheet Discover uses (via `useBlockedImport`) and keeps the pasted URL as the recipe source on the manual form. No alert for this case. Other import failures still alert as before.
- `pending-import.ts`: `titleFromRecipeUrl` (readable title from the URL slug, host fallback) and `pendingImportFromUrl` (sheet content with the server's source label).
- `tests/pending-import.test.ts`: four new tests for those helpers.

## Tested
- `bun run build` (tsc + vite): clean.
- `bun test`: 173 pass, 0 fail (169 before, 4 new).
- Ran the branch on the whisk-demo preview (manual workflow dispatch, demo only) with a real Kitchn URL: the sheet opened showing "THE KITCHN / Easy Sheet Pan Chicken Fajitas Recipe", zero alerts fired, "Not now" closed it, and the form kept "Imported from: <kitchn url>".

## Not tested
- The "Open on The Kitchn" round trip with the bookmarklet or Shortcut (needs a real phone or browser with the bookmarklet and a Kitchn page).

## Left / follow-ups
- The generic alert remains for non-blocked failures (timeouts, empty pages).

## Blockers
None.
