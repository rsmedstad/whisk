# Report: whisk-recipe-import, Part 1 (Smitten Kitchen reliability)

Tier: standard. Branch: claude/kitchn-smitten-kitchen-sources-abys10, from main @ 03b4e36.

## What changed
- Discover: Smitten Kitchen `feedUrl` is now `https://smittenkitchen.com/feed/atom/` (the old `/feed/` redirects to a FeedBurner URL that returns HTTP 500, which pushed refreshes into Browser Rendering).
- One-time KV migration (`migrateDiscoverConfig` in functions/lib/discover-config.ts): a saved config whose SK feedUrl is one of the old values is rewritten. Applied in `GET`/`PUT /api/discover/config` and in the feed job's `loadConfig`. A user-customised feed URL is left alone.
- `DiscoverSourceConfig.wpRest?: boolean` (src/types), set for `smittenkitchen` only. The flag is read from the default source list (like `feedUrlForPage`), so saved configs do not need it.
- `fetchWpRestPostHtml` (functions/lib/recipe-fetch.ts): one `safeFetch` to `${origin}/wp-json/wp/v2/posts?slug=…&_fields=link,title,content`, 8 s cap, accepted only if `link` equals the page URL under `normalizeRecipeUrl`. Returns `<h1>…</h1><div class="entry-content">…</div><footer></footer>`.
- functions/api/import/url.ts: REST is tried (a) when the page fetch was blocked/empty/timed out on a `wpRest` host, before returning `source_*`, and (b) when the page was readable but Strategies 1-4 found nothing, before Apify / Browser Rendering. One request, no retries. Escalation (Apify/BR) is off once REST HTML is in use. Other hosts are unchanged. The Kitchn path is untouched (still no BR/Apify after a block).
- Plain-text old SK posts: chose the AI path. If REST HTML still has no recipe, `tryAIStepExtraction` runs on the stripped text with the REST title, and a recipe is built only when it returns >= 3 ingredients and >= 2 steps. Otherwise `422 source_empty`. With no AI provider configured it is always `source_empty`.
- Fixed the 1-step bug: new `extractJetpackDirections` splits `jetpack-recipe-directions` on `</p>` / `<p>` / `<li>` and stops at a "Notes" heading (the first `<p>` is unopened in the real markup).

## Tested
- `bun test`: 234 pass, 0 fail (new tests/smitten-kitchen.test.ts: REST slug/link match, mismatch rejected, non-array rejected, wpRest flag scope, Jetpack directions split, Atom fixture parse, default feed URL, migration applied/idempotent/custom URL kept). Fixtures: functions/lib/fixtures/sk-pumpkin-bread-wp-rest.json, sk-atom-feed.xml.
- `npx tsc --noEmit` clean, `bun run build` clean.
- Live harness (local, stub env, non-Cloudflare IP, 2 s apart):
  - skillet-pierogi-with-mushrooms: 200, 11 ingredients, 3 steps
  - simple-chicken-tacos: 200, 18 ingredients, 8 steps
  - 2016/10/pumpkin-bread: 200, 14 ingredients, 5 steps (was 1)
  - 2013 green-bean-casserole: 422 `source_empty` in ~0.7 s (no AI key in this environment, so the AI path was not exercised live)
  - The Kitchn x3: 422 `source_blocked` in 170-460 ms, no BR/Apify.

## Left / not verified
- AI path for plain-text posts not run live (no provider key here). Unit-level only via the shared `tryAIStepExtraction`.
- No live Discover refresh run (needs KV and deploy); the feed URL and migration are unit-tested, and the Atom URL returned 200 / 71 KB from curl.
- The SK pierogi page has 3 steps against the 2 required; fine.

## Blockers
- GitHub MCP failed to connect in this session, so no PR was opened or preview verified from here.
- Part 2 (Kitchn bookmarklet check on a real browser, "Paste recipe text" in BlockedSourceSheet) not started: it requires Part 1 on preview, a real-browser pass on Kitchn pages (Kitchn blocks this environment), and Ryan seeing the preview first.

## Follow-ups
- Part 2 as a second PR once Ryan has seen the Part 1 preview.
