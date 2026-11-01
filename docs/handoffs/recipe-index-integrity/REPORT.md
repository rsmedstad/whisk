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

## Also moved onto fresh-copy writes (no raw index writes remain)
- `PUT /api/recipes/:id`, `retag`, `recrawl`, `fix-text`, `import/book`, and the MCP favorite, unfavorite, want-to-make and update tools.
- Bulk jobs collect per-entry patches and apply them to a fresh index at the end (`patchRecipeIndex`), so a long run can no longer write back a stale copy or resurrect an entry deleted while it ran. Single-entry edits use `updateIndexEntry`.

## Tested
- `npx tsc --noEmit` clean, `bun test` 185 pass / 0 fail (11 new in `tests/recipe-index.test.ts`), `bun run build` ok.
- Not run against live KV (no credentials here).

## Left
- Reconcile cost: one KV list per 1000 records plus one get per ghost candidate or orphan, at most every 10 minutes.
- Hard reset if ever needed: `bun scripts/rebuild-index.ts`.
