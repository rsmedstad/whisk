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
