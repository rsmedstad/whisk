---
name: reindex-vectorize
description: Rebuild or backfill the Whisk Vectorize semantic-search index and check Discover feed health. Use after bulk recipe imports, when semantic search returns nothing/stale results, or when the Discover feed looks thin (sources silently IP-blocked). Covers the backfill/rebuild scripts and per-source feed diagnosis.
---

# reindex-vectorize (and Discover health)

Whisk's semantic recipe search is Workers AI embeddings (bge-base-en-v1.5) written into a Vectorize index, queried by `functions/lib/embeddings.ts` (`queryRecipes`). Recipes live in KV; the vector index is a derived copy that can drift out of sync after bulk changes. This skill covers rebuilding it and diagnosing the separate-but-often-conflated Discover feed.

These are `scripts/*.ts` run with `bun`, hitting real Cloudflare resources (KV + Workers AI + Vectorize). They are not local-only; read each script's header before running to confirm which environment it targets.

## When to reindex

- After a bulk import (`bun run import-csv`, `scripts/import-csv.ts`) or a mass edit.
- Semantic/AI-chat search returns nothing or clearly stale hits while the recipe exists in KV.
- After deleting recipes (orphaned vectors linger until cleaned).

## Reindex commands

```bash
bun scripts/backfill-vectorize.ts     # embed + upsert recipes missing from the index (incremental)
bun scripts/rebuild-index.ts          # full rebuild (use when the index is corrupt or schema changed)
```

Verify by driving AI chat with a semantic query and checking the reported `vectorizeHits` in the response (see `functions/api/ai/chat.ts`), or query the index directly per the script output.

## Gotchas (Vectorize)

- **Local `wrangler pages dev` may not exercise Vectorize/Workers AI fully.** `queryRecipes` can no-op or throw locally; `chat.ts` already catches Vectorize failures and falls back to keyword scoring. A local miss is not proof of a bug; test against a preview/prod deploy.
- **Deletes need cleanup.** Removing a recipe from KV does not remove its vector. If stale hits persist, `scripts/rebuild-index.ts` is the clean reset.
- Embedding dims must match the index config; a model change means a full rebuild, not a backfill.

## Discover feed health (separate system)

The Discover feed is scraped external sources cached in KV under `discover_feed`, not Vectorize. It degrades silently, so diagnose per-source before "fixing" code:

```bash
# authed request (see the verify skill for the bearer token):
curl -s http://127.0.0.1:8788/api/discover/feed -H "Authorization: Bearer $TOKEN" | jq '.items | group_by(.source) | map({source: .[0].source, count: length})'
```

- **AllRecipes and Serious Eats are Cloudflare/IP-blocked (Dotdash Meredith / People Inc).** They routinely return zero, so the feed quietly falls back toward NYT-only. A thin, NYT-heavy feed is expected, not necessarily a regression.
- Sources are user-configurable (max 10) via `POST /api/discover/config`; `scripts/set-discover-config.ts` seeds them and `scripts/populate-feed.ts` warms the cache. `feed.ts` surfaces a per-source warning when a source produces zero recipes; check that before assuming the scraper broke.
- `scripts/cleanup-discover-collections.ts` clears stale Discover state if the cache is wedged.

## Notes

- No em dashes (house rule).
- These scripts touch production data. Confirm the target environment in the script header and prefer a dry run / small limit first where the script supports it.
