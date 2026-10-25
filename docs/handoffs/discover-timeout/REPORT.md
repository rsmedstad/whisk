# Discover import timeout

## Cause
`resolveRecipeSource` fetched the page (8s timeout) and then, on a block/timeout, the source RSS feed (another 8s). Worst case 16s, past the client's 12s limit, so the user saw the generic client abort message instead of a result. The import overlay middleware also added a serial 8s page fetch after a successful import.

## Changed
- Feed lookup now starts in parallel with the page fetch (worst case one 8s window).
- Overlay middleware page fetch capped at 3s (optional enhancement).

## Tested
- `bun test` (151 pass), `npx tsc --noEmit`. Could not reproduce against loveandlemons.com from the sandbox (outbound proxy blocks it).

## Left
- If Love and Lemons blocks or throttles Cloudflare IPs, the page itself will still fail; Save to Whisk bookmarklet remains the fallback.
- Check `discover_cache` precache failures for this source.

## Follow-up (same task)
- Import now has a 10.5s server budget (client limit is 12s). Apify (was 45s) and Browser Rendering (was ~25s) are skipped or capped to the remaining budget, so a readable page with no recognized recipe markup can no longer hang past the client timeout.
- "No recipe data" errors now include a short detail (chars read) to show whether the page was fetched or blocked.
