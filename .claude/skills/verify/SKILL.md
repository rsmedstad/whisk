---
name: verify
description: Build, launch, and drive the Whisk app end-to-end (Pages Functions + local KV/R2/Vectorize) to verify changes at the HTTP surface. Covers the token auth (not a cookie), recipes, and the Discover feed.
---

# Verifying Whisk

Whisk is on the same Cloudflare Pages stack as the fleet but differs in two ways that matter for verification: **auth is a bearer token, not a session cookie**, and **storage is KV + R2 + Vectorize, not D1** (so there are no `migrations/` or `d1:*` scripts).

## Build + launch

```bash
bun run build                                              # tsc && vite build -> dist/
bunx wrangler pages dev dist --compatibility-flag=nodejs_compat --port 8788
# Ready when the log prints: Ready on http://127.0.0.1:8788
```

Local KV/R2 state lives in `.wrangler/state/v3`. Secrets come from `.dev.vars` (`APP_SECRET` is the household password, optional `OWNER_PASSWORD`, plus provider keys). `bun run dev` alone is Vite only (no Functions); use `wrangler pages dev` to exercise `/api/*`.

## Drive the API

Auth returns a token in the JSON body; send it as `Authorization: Bearer <token>` on every `/api/*` call.

```bash
PW=$(grep '^APP_SECRET' .dev.vars | sed 's/^APP_SECRET *= *//')
TOKEN=$(curl -s -X POST http://127.0.0.1:8788/api/auth \
  -H "Content-Type: application/json" -d "{\"password\":\"$PW\",\"name\":\"verify\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s http://127.0.0.1:8788/api/recipes -H "Authorization: Bearer $TOKEN"
curl -s http://127.0.0.1:8788/api/capabilities -H "Authorization: Bearer $TOKEN"
```

Flows worth driving: login (wrong password gets a 401 + rate-limit), `POST /api/recipes` then `GET /api/recipes/[id]`, `POST /api/import/url` (recipe scrape), `GET /api/discover/feed`, and a `POST /api/ai/chat` if a provider key is set.

## Gotchas

- **Vectorize and Workers AI may not run fully in local `pages dev`.** Semantic search / embedding writes can no-op or error locally; verify those against a preview deploy, and do not treat a local Vectorize miss as a code bug.
- **Discover sources silently degrade.** AllRecipes and Serious Eats are Cloudflare/IP-blocked (People Inc), so `GET /api/discover/feed` can quietly fall back to NYT-only. A thin feed is expected behavior, not necessarily a regression; check the per-source counts before "fixing" it.
- **Demo mode intercepts writes.** If `whisk_demo_mode` is set and the caller is not the owner, mutating requests are short-circuited client-side and blocked by middleware; make sure you are testing as the owner.
- Sessions are KV-backed (`session:<token>`); `POST /api/sessions/revoke-all` invalidates them, after which a reused token must 401.
