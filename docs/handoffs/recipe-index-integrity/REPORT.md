# Recipe index integrity (ghost and orphan entries)

## Problem
`recipes:index` is one KV value rewritten by read-modify-write across 13 call sites. Overlapping writes can undo each other: a stale write restores a deleted entry (ghost: listed, `recipe:{id}` gone) or drops a new one (orphan: record exists, not listed). Seen as "[MCP smoke] discard me": listed but not openable.

## Decision
No storage format change and no migration. The `recipe:{id}` records are the source of truth; the index is a derived cache kept honest by reconcile. Reversible at any time with `scripts/rebuild-index.ts`.

## What changed
- `functions/lib/recipe-index.ts` (new):
  - `reconcileRecipeIndex`: lists record key names, removes entries whose record is verified gone (direct read, and entry older than 5 min since KV list can lag), adds records missing from the index, applies to a fresh copy of the index before writing.
  - `maybeReconcileRecipeIndex`: runs at most every 10 min, shared across isolates via a KV timestamp. Never throws.
  - `mutateRecipeIndex`: write, re-read, confirm the change landed, retry up to 3 times.
- `GET /api/recipes` triggers the throttled reconcile in the background.
- Create and delete (REST and MCP) use `mutateRecipeIndex`, so a clobbered write is detected and retried.
- Earlier PR #143 already makes the app clear a ghost on a genuine 404.

## Tested
- `npx tsc --noEmit` clean, `bun test` 182 pass / 0 fail (8 new in `tests/recipe-index.test.ts`: ghost removal, orphan add, fresh entry spared, list-lag spared, non-record keys ignored, throttle, clobber retry, entry build), `bun run build` ok.
- Not run against live KV (no credentials here).

## Left / follow-ups
- Update paths (`[id].ts` PUT, retag, recrawl, fix-text, book import, other MCP tools) still use plain read-modify-write. A stale write there can reintroduce a ghost, which reconcile then clears within ~10 min of the next list call. Moving them onto `mutateRecipeIndex` is a mechanical follow-up.
- Reconcile cost: one KV list per 1000 records plus one get per ghost candidate or orphan, at most every 10 minutes.
- If the index ever needs a hard reset: `bun scripts/rebuild-index.ts`.
