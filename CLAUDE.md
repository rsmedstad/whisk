# Whisk — Project Rules for Claude Code

## Project Overview

Whisk is a personal recipe manager PWA deployed on Cloudflare Pages + Workers.
Deployed at: `whisk-15t.pages.dev` | Repo: `rsmedstad/whisk` | Open-source (self-hostable)

## Tech Stack

- **Runtime**: Bun (package manager + script runner)
- **Framework**: React 19 + React Router 7 (SPA, client-side routing)
- **Build**: Vite 7 + TypeScript 5.9 (strict mode, `noUncheckedIndexedAccess: true`)
- **Styling**: Tailwind CSS 4 (Vite plugin, `@theme` CSS custom properties)
- **Backend**: Cloudflare Pages Functions (file-based routing in `functions/api/`)
- **Storage**: Cloudflare KV (data) + R2 (photos)
- **AI Providers**: Groq, OpenAI, Anthropic, Google Gemini, xAI Grok (all optional)

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start Vite dev server on :5173
bun run build        # TypeScript check + Vite production build (tsc && vite build)
bun run preview      # Preview production build locally
bun run deploy       # Build + deploy to Cloudflare Pages
npx tsc --noEmit     # Type-check only (no build)
```

## Architecture

### Directory Structure

```
src/
  App.tsx              # Root component, routing, hook composition
  main.tsx             # Entry point, renders <App />
  types/index.ts       # ALL TypeScript interfaces (Recipe, ShoppingList, MealPlan, etc.)
  lib/                 # Pure utilities (no React, no side effects)
    api.ts             # Fetch wrapper with auth token management
    cache.ts           # localStorage cache layer for offline-first
    seasonal.ts        # Holiday/season detection, accent palettes, AI context
    categories.ts      # Shopping item categorization
    compress.ts        # Client-side image compression
    tags.ts            # Preset tag definitions
    units.ts           # Unit conversion
    utils.ts           # classNames() helper
  hooks/               # Custom React hooks (data + UI)
    useRecipes.ts      # Recipe CRUD + optimistic updates
    useShoppingList.ts # Shopping list management
    useMealPlan.ts     # Meal plan CRUD + week navigation
    useTags.ts         # Tag index management
    useAuth.ts         # Login/logout + token persistence
    useTheme.ts        # System/light/dark/seasonal theme
    useCapabilities.ts # AI feature availability from /api/capabilities
    useTimers.ts       # Concurrent cooking timers
    useWakeLock.ts     # Screen wake lock for cook mode
    useSpeech.ts       # Web Speech API text-to-speech
    useImageCompress.ts
  styles/
    app.css            # Tailwind imports + seasonal accent palette overrides
  components/
    BottomNav.tsx      # 5-tab navigation (Recipes, Discover, Suggest, List, Plan)
    InstallPrompt.tsx  # Platform-aware PWA install instructions
    Settings.tsx       # Full settings page (theme, units, AI status, data, danger zone)
    auth/Login.tsx     # Onboarding: join existing book or setup new
    ui/                # Reusable primitives (Button, Card, Input, TextArea, etc.)
    recipes/           # RecipeList, RecipeDetail, RecipeForm, CookMode
    discover/          # Discover tab (TheMealDB browser + AI identify)
    suggest/           # SuggestChat (AI-powered recipe discovery)
    list/              # ShoppingList
    plan/              # MealPlan

functions/api/         # Cloudflare Pages Functions (serverless API)
  _middleware.ts       # Auth middleware (Bearer token validation via KV)
  auth.ts              # POST /api/auth — password → token
  capabilities.ts      # GET /api/capabilities — which AI features are available
  recipes.ts           # GET/POST /api/recipes — index + create
  recipes/[id].ts      # GET/PUT/DELETE /api/recipes/:id
  tags.ts              # GET/PUT /api/tags
  upload.ts            # POST /api/upload — photo → R2
  plan.ts              # GET/PUT /api/plan
  ai/chat.ts           # POST /api/ai/chat
  ai/suggest.ts        # POST /api/ai/suggest
  identify/photo.ts    # POST /api/identify/photo
  import/url.ts        # POST /api/import/url — scrape recipe from URL (with Browser Rendering fallback)
  import/parse.ts      # POST /api/import/parse — AI-powered text parsing for bulk import
  share/               # Public share link creation + access
  shopping/scan.ts     # POST /api/shopping/scan — OCR handwritten list

public/
  manifest.json        # PWA manifest (standalone, orange theme)
  sw.js                # Service worker (stale-while-revalidate caching)
  icons/               # App icons (favicon.svg, apple-touch-icon, 192/512 PNG)
```

### Key Patterns

1. **Local-first with background sync**: Hooks read from localStorage cache first, fetch from API in background, merge updates. Optimistic UI — mutations update cache immediately and fire API calls.

2. **Code splitting**: All routes except home (`RecipeList`) are `React.lazy()` loaded. Keep this pattern for any new routes.

3. **All types in one file**: `src/types/index.ts` is the single source of truth for all interfaces. Don't scatter type definitions across files.

4. **File-based API routing**: Cloudflare Pages Functions use filesystem convention. `functions/api/foo.ts` → `POST|GET /api/foo`. Dynamic params via `[id].ts`.

5. **Auth model**: Single shared password (`APP_SECRET` env var) → bearer token stored in KV with 30-day TTL. No user accounts, no sessions table. Middleware at `_middleware.ts` protects all routes except `/api/auth` and `/api/share/`.

6. **Seasonal theme via CSS custom properties**: Tailwind CSS 4's `@theme` creates `--color-orange-*` vars. The `[data-accent="..."]` selectors in `app.css` override these for seasonal palettes. Zero component changes needed — just swap the `data-accent` attribute on `<html>`.

7. **AI provider flexibility**: The `Env` type has optional keys for 6 providers. `/api/capabilities` auto-detects which are configured. `/api/ai/config` stores per-function provider+model choices in KV. Components receive boolean flags (`chatEnabled`, `visionEnabled`) and show graceful degradation banners. The Settings page has a full AI configuration UI with simple and advanced modes.

## Coding Conventions

### TypeScript
- Strict mode is ON with `noUncheckedIndexedAccess` — array indexing and Record lookups return `T | undefined`. Always null-check.
- Use named exports (not default exports) for components and hooks.
- Use `interface` for object shapes, `type` for unions/aliases.

### React
- Function components only. No class components.
- Props interfaces defined inline or co-located with the component.
- Hooks for all stateful logic — components should be thin render layers.
- Use `React.lazy()` + `<Suspense>` for route-level code splitting.

### Styling
- Tailwind CSS 4 utility classes only. No CSS modules, no styled-components, no inline `style={}`.
- Color palette: `stone` for neutrals, `orange` for accents (overridden by seasonal theme).
- Dark mode: use `dark:` variant classes. The app supports system, light, dark, and seasonal themes.
- Mobile-first: design for small screens, add responsive breakpoints (`sm:`, `md:`, `lg:`) as needed.
- Safe areas: use `var(--sat)`, `var(--sab)` for iOS safe area insets.

### API Functions
- Each function file exports `onRequest` (for middleware) or `onRequestGet`/`onRequestPost`/etc.
- Type the context with `PagesFunction<Env>`.
- Return `Response` objects with appropriate status codes and JSON content type.
- All data stored in KV under prefixed keys: `recipe:`, `recipe_index`, `session:`, `shopping_list`, `meal_plan`, `tag_index`.
- Photos stored in R2 bucket `whisk-photos` under the `photos/` key prefix (e.g. `photos/import-abc123.jpg`). The `thumbnailUrl` field on recipes stores the path as `/photos/import-abc123.jpg`, and the serving route at `functions/photos/[[path]].ts` prepends `photos/` to form the R2 key. **When uploading to R2 via the REST API, always include the `photos/` prefix in the object key.**

### localStorage Keys
All prefixed with `whisk_`: `whisk_token`, `whisk_theme`, `whisk_units`, `whisk_temp_unit`, `whisk_show_grams`, `whisk_display_name`, `whisk_household_size`, `whisk_install_dismissed`, etc.

## Environment Variables

Set in Cloudflare dashboard or `.dev.vars` locally:

| Variable | Required | Purpose |
|---|---|---|
| `APP_SECRET` | Yes | Shared password for authentication |
| `GROQ_API_KEY` | No | Groq API (fast text + vision, llama models) |
| `GEMINI_API_KEY` | No | Google Gemini API (free tier, text + vision) |
| `CEREBRAS_API_KEY` | No | Cerebras API (fastest inference, free tier) |
| `OPENAI_API_KEY` | No | OpenAI API (GPT-4.1/4o, vision) |
| `ANTHROPIC_API_KEY` | No | Anthropic API (Claude 4.5/4.6, vision) |
| `XAI_API_KEY` | No | xAI Grok API (text + vision) |
| `APIFY_API_TOKEN` | No | Apify API (Instagram post scraping, free $5/mo tier) |

At least one AI provider key is needed for AI features. Vision requires a provider that supports image input. Free options with vision: Groq (Llama 4 Scout), Gemini (2.5 Flash). Configurable per-feature in Settings > AI Model Configuration.

## PWA Requirements

- `manifest.json` must have valid icons, `display: standalone`, correct `start_url`
- Service worker (`sw.js`) caches static assets and API responses
- `viewport-fit=cover` in index.html for iOS safe area support
- `apple-mobile-web-app-capable` and `apple-mobile-web-app-status-bar-style` meta tags
- App must work offline for cached data (read from localStorage cache)

## Data Scripts (`scripts/`)

One-off Bun scripts for bulk recipe data operations. They use the Cloudflare REST API directly (KV + R2) with the wrangler OAuth token from `%APPDATA%/xdg.config/.wrangler/config/default.toml`.

### Key scripts
- `list-recipes.ts` — List all recipes with IDs, titles, thumbnail/ingredient/step counts
- `rebuild-index.ts` — Rebuild the `recipe_index` KV key from all `recipe:*` entries
- `update-recipes.ts` / `update-missing.ts` — Bulk update recipes with scraped data + photos

### Recipe scraping strategy (in order of preference)
1. **Direct fetch** with browser-like headers — works for most recipe sites with JSON-LD
2. **Cloudflare Browser Rendering** REST API — for JS-heavy sites (uses `CF_BR_TOKEN`). Call `POST /accounts/{id}/browser-rendering/content` with the URL, then extract JSON-LD from the rendered HTML
3. **Deployed Whisk import API** (`/api/import/url`) — runs Browser Rendering on CF edge, may have different IP/access than direct API calls
4. **Manual data entry** — last resort for sites that block all automated access (e.g. simplyrecipes.com)

### Common pitfalls
- **R2 key prefix**: When uploading photos via R2 REST API, use key `photos/filename.jpg` (not just `filename.jpg`). The serving route prepends `photos/` to the path, so the R2 key must match.
- **Recipe index**: After any KV recipe updates, always run `rebuild-index.ts` to regenerate `recipe_index`
- **OAuth token expiry**: If scripts fail with null results from KV list, the wrangler OAuth token may have expired. Run `npx wrangler whoami` to re-authenticate.

## What NOT to Do

- Don't add a CSS framework alongside Tailwind (no Bootstrap, no Material UI)
- Don't add a state management library (no Redux, no Zustand) — hooks + localStorage is the pattern
- Don't add a database client — all server data goes through KV/R2 via Cloudflare bindings
- Don't add SSR — this is a client-side SPA deployed as static files
- Don't create default exports — use named exports everywhere
- Don't scatter types — keep them in `src/types/index.ts`
- Don't add test files yet — testing infrastructure is a future phase
- Don't commit `.env`, `.dev.vars`, or any API keys
