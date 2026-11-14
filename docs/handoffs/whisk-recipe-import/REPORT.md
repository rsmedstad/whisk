# Report: whisk-recipe-import (Part 1, Smitten Kitchen reliability)

Tier: standard
Repo: rsmedstad/whisk
Status: code written, NOT verified. The session that wrote this had Bash denied, so `bun test`, `bun run build`, the local harness and git/PR steps were not run.

## What changed
- `functions/lib/discover-config.ts`: Smitten Kitchen `feedUrl` is now `https://smittenkitchen.com/feed/atom/`, source flagged `wpRest: true`. New pure `migrateDiscoverConfig` replaces a saved SK feed URL equal to a known-bad value (`/feed/`, `/feed`, the feedburner URL). Custom URLs are left alone.
- `functions/api/discover/feed.ts` (`loadConfig`) and `functions/api/discover/config.ts` (GET, PUT): apply the migration. `loadConfig` writes the migrated config back once. The Atom item description now falls back to `<summary>` / `<content>`.
- `src/types/index.ts`: optional `wpRest` on `DiscoverSourceConfig`.
- `functions/lib/recipe-fetch.ts`: `isWpRestHost`, `wpRestPostToHtml` (accepts only when the first post's `link` equals the page URL via `normalizeRecipeUrl`), `fetchWpRestPostHtml` (one `safeFetch`, `RECIPE_PAGE_HEADERS`, 8 s cap, no retries).
- `functions/api/import/url.ts`: REST is tried (a) when the page fetch was empty/blocked/timed out on a `wpRest` host, before returning `source_*`, and (b) when the page was readable but Strategies 1-4 found nothing, before Apify / Browser Rendering. Strategies 1-4 extracted into exported `runHtmlStrategies`. New `splitJetpackDirections` fixes the 1-step bug: `extractAllItemprop` stops at the first `</p>`, so multi-`<p>` `jetpack-recipe-directions` collapsed to one step. `extractMicrodata` is now exported for tests.
- Kitchn path untouched: no change to block detection, no Browser Rendering/Apify after a block, no UA changes.
- Tests: `tests/wp-rest-import.test.ts` (REST slug match, link mismatch rejected, empty/non-array rejected, wpRest host flag, Jetpack `<p>` and `<li>` split, pumpkin-bread-shaped regression, Atom parse, feed URL default, KV migration, no-op cases).

## Decision on plain-text old SK posts (item 4)
Skipped the AI path. `tryAIStepExtraction` needs a recipe name and returns steps/ingredients only, so wiring it risks a wrong or invented recipe from a non-recipe post. Those posts stay `422 source_empty`; the manual-open flow still applies. Revisit with a dedicated text-to-recipe call (Part 2 paste fallback covers it manually).

## Not done / not verified
- `bun test`, `bun run build`, `npx tsc --noEmit`: not run. Type issues are possible (new `html` reassignment and `triedWpRest` flow in url.ts).
- Fixtures are hand-built from the structure described in the brief, NOT trimmed captures of the real URLs. Replace with real saved REST/HTML responses when network access is available.
- Local harness (`/tmp/run-import.ts`) and the 5 real-URL acceptance checks: not run. Kitchn 422/no-BR check: not run.
- Branch, commit, preview PR: not created. Part 2 (Kitchn bookmarklet verification, paste-text fallback in `BlockedSourceSheet.tsx`): not started.

## Follow-ups
- Run the acceptance list from the brief, then open the preview PR and paste this summary into the body.
- Part 2 after Part 1 is on preview.
