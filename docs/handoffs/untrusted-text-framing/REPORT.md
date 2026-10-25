# Report: untrusted-text-framing (H1)

Date: 2026-10-25. Branch `fix/untrusted-text-framing`. Handoff H1 from wiki handoff 0004.

## Changed
- `functions/api/import/url.ts`, `tryAIStepExtraction`: scraped page text is now wrapped in a `<PAGE_TEXT>` block and the recipe name in a `<RECIPE_NAME>` block, both in the user message. The system prompt carries a SAFETY note (same framing as `import/parse.ts` and `discover/recipe.ts`) saying the blocks are untrusted data. Any copy of the block tags is stripped from the text first, so the page cannot close its block. The recipe name (taken from the page's JSON-LD) was previously interpolated straight into the system prompt; it now goes through the same wrapper, with control characters removed and a 200 character cap.
- `functions/lib/untrusted.ts` (new): `stripBlockTags` and `wrapUntrusted`.
- `tryAIStepExtraction` is now exported so it can be tested. Pages Functions only route `onRequest*` exports, so this adds no route.
- `tests/untrusted-framing.test.ts` (new, 4 tests): tag stripping, a page that tries to close the block, a recipe name containing a closing tag, and a model that obeys an injected instruction and returns a wrong shape; the output stays `{ steps, ingredients }` with invalid entries dropped.

## `ai/chat.ts` action markers (review, no code change)
The server only emits the markers `SAVE_RECIPE`, `ADD_TO_PLAN`, `ADD_TO_LIST` (and `ADD_RECIPE_INGREDIENTS`, `SEARCH_RECIPES`, `RECIPE_CARD`) as text in the model reply. `src/components/suggest/SuggestChat.tsx` parses them with `parseActions` only at render time and shows buttons. Every call that changes data (`onAddMeal`, `onAddToList`) and every navigation to the import form (`SAVE_RECIPE` opens `/recipes/new?url=...`, which still needs a Save) runs inside an `onClick`. None of the `useEffect` hooks reads or executes markers. So the client requires a tap before acting on any marker.

## Tested
- `bun test`: 155 pass, 0 fail across 10 files (4 new).
- `bun run build` (tsc + vite build): passes.
- Not tested: a live model call (no paid API calls made).

## Left
- Nothing for this item. Merged, so the normal deploy workflow runs.

## Blockers
None.
