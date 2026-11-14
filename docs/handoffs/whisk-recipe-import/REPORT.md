# Report: whisk-recipe-import (Part 1 Smitten Kitchen, Part 2 Kitchn paste fallback)

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

## Part 2 (same branch / PR #160: the session's branch rule allowed only one branch)
- New `POST /api/import/text` (functions/api/import/text.ts, helpers in functions/lib/recipe-text.ts): behind the normal auth middleware, uses the configured chat provider, wraps the text with `wrapUntrusted("PAGE_TEXT")`, no page fetch. Output is validated (title, >= 2 ingredients, >= 1 step) or `422`; no provider is `503`.
- BlockedSourceSheet: "Paste recipe text instead" link, textarea, Import button, and one line: "No bookmark set up? Copy the recipe text from the page and paste it here." The recipe is saved with the blocked URL as `source.url`, then opens. `BlockedImportProvider` now takes `onCreateRecipe` (wired in App.tsx).
- Covers The Kitchn, old plain-text Smitten Kitchen posts and any other blocked site.
- Server import for The Kitchn is unchanged: still `422 source_blocked`, no Browser Rendering / Apify / proxy.
- Tests: tests/recipe-text.test.ts (parse, reject, clean, copy). Totals: 239 pass, 0 fail; tsc and build clean.

## Finding on the demo preview (Cloudflare edge)
- From Cloudflare's network, smittenkitchen.com answers 403 to both the page fetch and the WP REST request (error detail: "page HTTP 403, REST HTTP 403"). The import therefore returns `422 source_blocked` and the blocked sheet opens, with the bookmarklet / paste fallback. The same URL imports fine from a non-Cloudflare IP (local harness), so the Part 1 import gains do not apply to the deployed app while this block stands.
- Not worked around: no UA spoofing, proxies or Browser Rendering after a block (AGENTS.md crawl rules).
- Open question: the Discover atom feed is likely blocked from Cloudflare the same way (not verifiable without a refresh run on the preview).

## Headless-browser check on the isolated demo preview
- Blocked sheet opens with the paste link; textarea enables Import at >= 40 chars; Import POSTs /api/import/text (503 "No AI provider configured" on the demo, shown in the sheet).
- Bug found and fixed: the Settings "Save to Whisk" drag link was a `javascript:` href that React 19 rewrites into a throwing stub, so dragging it installed a broken bookmark (the Copy button was unaffected). The href is now set on the DOM node (BookmarkletHelp.tsx).
- Bookmarklet end to end: ran the real bookmarklet code on a Kitchn-like JSON-LD FIXTURE (tests/fixtures/kitchn-like-graph.json) served for a thekitchn.com URL; it opened the demo and saved a recipe with 5 ingredients and 2 steps. Not a real Kitchn page.
- Discover feed: no Browser Rendering after a 401/403/429 on a feed; a "blocked the feed request (HTTP n)" warning instead.

## Left / not verified
- AI path for plain-text posts not run live (no provider key here). Unit-level only via the shared `tryAIStepExtraction`.
- No live Discover refresh run (needs KV and deploy); the feed URL and migration are unit-tested, and the Atom URL returned 200 / 71 KB from curl.
- The SK pierogi page has 3 steps against the 2 required; fine.

## Blockers
- GitHub MCP failed to connect in this session, so no PR was opened or preview verified from here.
- NOT verified: bookmarklet / iOS Shortcut end to end on a real Kitchn page. The Kitchn blocks this environment and challenge evasion is out of bounds, so this must be done by Ryan in his own browser on the preview. Only the fixture-based test (kitchn-like JSON-LD slims under BOOKMARKLET_HASH_MAX 16000) covers it. Also unverified: the paste import against a real AI provider (no key here), and the sheet UI in a browser.
- Merge/deploy held: acceptance needs Ryan to see the preview.

## Follow-ups
- Part 2 as a second PR once Ryan has seen the Part 1 preview.
