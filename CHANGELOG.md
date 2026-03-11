# Changelog

## [0.5.1] - 2026-03-11

### AI Chat — Smarter Query Classification

- **Three-tier query routing**: General, Follow-up, and Collection tiers skip unnecessary KV/Vectorize/NYT lookups
  - **General questions** (substitutions, temps, seasonal, troubleshooting, pairings) go straight to the LLM with no data fetches
  - **Follow-up questions** in multi-turn chats skip full index reload — the LLM already has the conversation context
  - **Collection queries** ("suggest from my recipes", "meal plan") still load the full recipe index + Vectorize
- **Contraction normalization**: "what's", "how's", etc. now correctly match query classification patterns
- **Expanded general patterns**: `temp`, `tips`, `freeze`/`thaw`/`reheat`, `why did...`, `pairs with`, `best...for`, `vs`/`better than`, `substitute`/`replace`/`alternative`/`instead of`, `in season`/`seasonal`
- **Faster follow-ups**: Asking "what temp for that?" or "can I freeze the leftovers?" after getting recipe cards no longer re-fetches the entire recipe index and Vectorize embeddings

---

## [0.5.0] - 2026-03-11

### AI Chat — Vectorize RAG & Streaming

- **Semantic search**: Cloudflare Vectorize index (`whisk-recipes`) with Workers AI embeddings (bge-base-en-v1.5)
  - Recipes auto-embed on create/update via `waitUntil()` fire-and-forget
  - Smart context selection: Vectorize semantic search + keyword scoring → top 20 detailed recipes + compact list for the rest
  - Backfill script (`scripts/backfill-vectorize.ts`) for existing recipes
- **SSE streaming**: Real-time token-by-token AI responses instead of waiting for full completion
  - Multi-provider streaming: OpenAI, Anthropic, and Gemini stream formats
  - Progressive UI updates as text arrives
  - Graceful fallback to non-streaming JSON responses
- **Markdown rendering**: AI chat messages now render bold, italic, inline code, and bullet/numbered lists
  - New lightweight JSX renderer (`src/lib/markdown.tsx`)
  - `.prose-chat` CSS for compact spacing

### Bug Fixes

- Fixed Plan "Get Suggestions" suggesting meals for disabled slots (breakfast/lunch when only dinner enabled)
  - `enabledSlots` now sent from client based on `whisk_meal_slots` localStorage
- Fixed `**bold**` text showing as literal asterisks in AI responses
- Fixed broken action markers like `[RECIPE_CARD: r_id, Title` leaking into display text
  - Increased maxTokens from 1024 to 2048 to prevent mid-marker truncation
  - Added incomplete marker stripping on both server and client
- Added `ingredientNames` to recipe index for richer AI context without fetching full recipes

### Infrastructure

- Cloudflare Vectorize index: `whisk-recipes` (768 dimensions, cosine similarity)
- Workers AI binding for embedding generation
- `wrangler.toml` updated with `[ai]` and `[[vectorize]]` bindings

---

## [0.4.1] - 2026-03-10

### Shopping List UX

- Add-item input moved to sticky bottom bar (always visible above nav)
- Scan results now show as a reviewable checklist before adding to list
  - Toggle individual items, A-Z sort, clear all, confirm or cancel

### Ask Tab

- Retry button on failed chat messages — red error bubble with reason and one-tap retry

### Bug Fixes

- Fixed duplicate images in recipe detail gallery (thumbnailUrl-aware dedup pass)
- Fixed tab order: Discover | Recipes | Ask | Plan | List
- Fixed Discover carousel snap-scroll offset on desktop (`scroll-pl-4`)
- Removed holiday header decorations (St. Patrick's Day clover, etc.)
- Feed PATCH endpoint now sanitizes images through `sanitizeImageUrl()`

### Removed Features

- Removed receipt scanning from Shopping List (kept handwritten list scan)

### Plan Tab

- Removed week summary card
- Compact inline shopping list (only when recipes are linked)
- "Plan my week" + "Quick fill" on same row with subtitles indicating behavior

---

## [0.4.0] - 2026-03-10

### Tab Reorganization

- Reordered tabs: Recipes | Discover | **Ask** (center) | Plan | List
- Ask tab gets a raised orange pill icon — visually distinguishes it as the app's main feature
- Ask is now the center tab reflecting its role as the AI-powered differentiator

### Ask Tab Redesign

- New landing state: recipe suggestion card at top, 2x2 capabilities grid, seasonal card at bottom
- Capabilities grid: "Plan meals", "Shopping list", "Find recipes", "Discover new" — each sends a contextual prompt
- Rich recipe cards: AI can now render tappable recipe cards from your collection in chat responses
- External recipe save cards: styled import cards for AI-suggested URLs
- Bulk "Add all to plan" button when AI suggests 3+ meals at once
- Individual plan actions show recipe title instead of generic "Add to Plan"

### Plan Tab Enhancement

- "Help me plan" section at the bottom of the week view:
  - "Plan my week" — opens Ask with a pre-filled planning prompt
  - "Quick fill gaps" — auto-fills empty slots using recipe scoring (slot fit, season, rating, cooked count)
  - "What's in Season" compact card showing seasonal produce
- Extracted `SeasonalProduceCard` as a shared component used by both Ask and Plan tabs

### Agentic AI Features

- New backend action markers: `RECIPE_CARD` (inline recipe cards), `SAVE_RECIPE` (import cards)
- Recipe IDs now included in AI context so the model can reference specific recipes
- Planning workflow instructions: AI suggests meals for empty slots with one-tap add-to-plan
- Multi-turn planning: AI checks existing plan, avoids duplicates, offers shopping list generation

### Removed Features

- Removed store ads / weekly deals feature (Flipp API integration, deal scanning, store preferences)
- Removed `useDeals` hook, `deals.ts` utility, and all `/api/deals/` and `/api/stores` endpoints
- Cleaned up related props from ShoppingList, MealPlan, SuggestChat, and Settings components

### Bug Fixes

- Fixed missing images on Discover overview page (added HTML image index for NYT scraper)
- Fixed missing horizontal scrollbars on desktop in Discover category rows
- Fixed person/state images appearing on recipe cards (enhanced `isPersonImage()` URL patterns)
- Fixed St. Patrick's Day icons using emoji instead of SVG (brand icon + CSS decoration)

---

## [0.3.4] - 2026-03-08

### Discover & Recipes UX

- Title-based deduplication for Discover feed (Jaccard word similarity >= 0.75, within and cross-source)
- Non-alcoholic pill filter on Drinks category rows (Recipes and Discover tabs)
  - Only appears when there's a mix of alcoholic and non-alcoholic drinks
- Muted + icon on Recipes tab (stone gray default, orange on hover/press with frame)
- Unified search, filter bar, and theme settings across tabs
- Plan tab: generate shopping list from planned meals

### Seasonal Themes

- Dramatically enhanced holiday/seasonal color palettes with holiday brand icons
- Fixed seasonal theme resolution issues

---

## [0.3.3] - 2026-03-07

### Discover Tab Overhaul

- Category-based feed: recipes grouped by dinner, breakfast, dessert, appetizer, drinks, etc.
- Filter bar with Type and Cuisine dropdowns, search input, sort (recent/A-Z), and "New" badges
- Time filter and cook time display on discover cards
- Tabbed Ingredients/Steps view in recipe detail with Cook Mode features
- Scroll-snap hero gallery for recipe photos
- AI-based tagging for discover items at ingestion time with time estimates
- Shared recipe components between Discover, Suggest, and Recipe Detail
- Archive system with 2-day auto-refresh cycle

### Feed Quality

- Browser Rendering fallback for AllRecipes and Serious Eats scraping
- Image proxy for cross-origin recipe thumbnails
- Filter out person/author photos, promotional titles, non-recipe content
- Fix ingredient formatting (decimal fractions, letter spacing)
- Backfill totalTime on discover cards from imported recipe data
- Deduplicate by normalized URL

### Fixes

- Fix conditional hooks crash in Discover detail view
- Fix AllRecipes/Serious Eats: read HTML body on non-200 responses
- Fix feed image not updating when imported image differs
- Fix Discover category classification and Share icon

---

## [0.3.2] - 2026-03-06

### Deployment & CI/CD

- GitHub Actions auto-deploy workflow: pushes to `main` auto-deploy to Cloudflare Pages
- Migrated to wrangler v4 assets config for Cloudflare deployment compatibility
- Fixed sort dropdown rendering off-screen on small viewports
- Fixed inconsistent category header alignment

---

## [0.3.1] - 2026-03-05

### Recipe List

- Horizontal carousel layout: categories now display as horizontally scrollable rows with peeking cards to hint at more content
- Recipe count badge next to each category heading
- New layout setting in Settings > Appearance: switch between Carousel (horizontal scroll per category) and Grid (vertical list)
- Layout preference persists via `whisk_recipe_layout` localStorage key

### Theme & Display Fixes

- Fixed system theme not applying correctly on page load (synchronous theme script in index.html)
- Fixed Safari horizontal scroll for carousel layout
- Expanded seasonal palettes to tint the full stone color range (backgrounds, borders, cards, text)

### Self-Hosting & Updates

- Comprehensive README with step-by-step self-hosting guide for non-technical users
- Covers: GitHub fork, Cloudflare Pages setup, KV/R2 storage creation, environment variables, AI provider setup
- Settings > About & Updates section with GitHub link and update instructions
- "Sync fork" update flow: one click on GitHub to pull latest changes, auto-deploys via Cloudflare

---

## [0.3.0] - 2026-03-04

### Import & Scraping Overhaul

**Multi-Format Import**
- Rewritten Import page accepts CSV, TSV (Google Sheets paste), and plain text
- AI-powered parsing fallback: paste unstructured recipe lists and AI extracts titles, URLs, notes, and categories
- New `POST /api/import/parse` endpoint for AI text parsing
- TSV auto-detection in CSV parser for Google Sheets clipboard support

**Cloudflare Browser Rendering**
- Two-tier URL scraping: regular fetch with Chrome-like headers first, headless browser fallback on 403
- Uses Cloudflare Browser Rendering REST API (free tier, 10 min/day)
- Challenge page detection filters out WAF "Just a moment..." responses
- Graceful degradation: when scraping fails, switches to manual form with URL pre-filled as source

**Recipe Source Tracking**
- `lastCrawledAt` field tracks when each recipe was last fetched from its source URL
- "Update from Source" option in recipe overflow menu to re-fetch and merge updates
- "Last fetched" date displayed below source link in recipe detail
- Recrawl script updated with Browser Rendering fallback

### Discover Tab Redesign

- Replaced AI-only Identify tab with Discover: a free, public-API-powered recipe browser
- Recipe discovery: random picks, category browsing, search, and region filters
- One-tap "Add to Book" saves any discovered recipe directly to your collection
- AI features (photo identify, chat) remain available as secondary options when configured

### Recipe List Improvements

- Category sort: groups recipes by meal type (Favorites first, then Breakfast through Side Dish)
- Alphabetical sorting within each category group
- AI auto-tagging: new recipes get automatic meal-type tags from AI during import
- Ingredient sort toggle in recipe detail (alphabetical vs original order)

### Settings & Theme

- Color swatch previews replace emoji icons for seasonal theme picker
- System theme icon updated to computer/monitor
- Removed unused store preferences section
- Streamlined AI provider list: removed DeepSeek and Mistral (unused), kept Groq, Gemini, Cerebras, OpenAI, Anthropic, xAI

### Fixes

- Dark mode: switched Tailwind 4 from `media` to `class`-based dark variant for reliable toggling
- Seasonal theme label clarified to "Seasonal / Holiday"
- Service worker cache improvements

---

## [0.2.0] - 2026-02-20

### UX & Polish

**Onboarding**
- Live theme preview during setup with seasonal swatch selector
- Show grams toggle during onboarding
- Location auto-detect for zip code setting
- Password visibility toggle on login screen

**Shopping List Overhaul**
- Store tags per item (assign items to specific stores)
- Sort and filter by store
- AI-powered item categorization
- Abbreviation display for compact list view

**Desktop Layout**
- Responsive desktop layout with sidebar navigation
- API request timeouts to prevent hung requests
- JSON data export

**Recipes**
- "Made This" tracking with date history
- Improved mobile keyboard handling in forms

**Visual**
- New app icon: green gradient tile with W, whisk, and sparkles
- Green default accent theme
- Scrollable cook mode for long recipes
- Light mode theme fixes and dark mode accent improvements

**Multi-User**
- Household support with shared recipe books
- Improved recipe CRUD and shopping list sync

**AI**
- Fixed AI hallucination issues in recipe suggestions
- Per-feature AI model configuration in Settings (simple + advanced modes)

### Fixes

- Fixed "Join Book" error: prevented page reload on wrong password, parse error messages properly
- Fixed light mode theme inconsistencies
- Fixed dark mode accent color rendering

---

## [0.1.0] - 2026-02-13

### Phase 1 MVP — Complete Implementation

**Core App**
- React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 PWA
- 5-tab bottom navigation: Recipes, Identify, Suggest, List, Plan
- Cloudflare Pages Functions API with KV storage and R2 photo uploads
- Shared-password authentication with bearer token sessions (30-day TTL)
- Local-first architecture: localStorage cache with background API sync and optimistic UI
- Code-split routing: all tabs except home are lazy-loaded via React.lazy()

**Recipes**
- Browse, search, filter by tags, sort by date/name/favorites
- Add manually, import from URL (JSON-LD scraping), or identify from photo
- Full recipe detail view with ingredients, steps, photos, metadata
- Cook mode: full-screen step-by-step with wake lock, text-to-speech, and concurrent timers
- Recipe sharing via public links

**Identify Tab**
- Camera/photo upload for AI food recognition
- Graceful degradation banner when vision AI is not configured

**Suggest Tab**
- AI-powered conversational recipe discovery
- Seasonal/contextual awareness: surfaces holiday-relevant recipes, seasonal ingredients, and contextual suggestions based on calendar date and household size
- Holiday detection for 15 US holidays with 21-day lookahead
- Quick action chips generated from seasonal context

**Shopping List**
- Manual item entry with auto-categorization (produce, dairy, meat, pantry, etc.)
- Add ingredients directly from recipes
- Check/uncheck items, clear checked, clear all

**Meal Plan**
- Weekly calendar view with breakfast/lunch/dinner/snack slots
- Week navigation with today button
- Add meals from recipe collection

**Settings**
- Theme: system, light, dark, seasonal (auto-changing accent colors)
- Units: imperial/metric with independent temperature (F/C) override
- Show gram weights toggle for baking precision
- Display name and household size configuration
- AI Services status panel showing active/not-configured per feature
- Privacy notice about third-party AI data handling
- Data export (JSON) and CSV import
- Danger zone: reset all local data and sign out

**Seasonal Theme System**
- 11 accent palettes: valentine, stpatrick, easter, july4th, halloween, thanksgiving, christmas, spring, summer, fall, winter
- Leverages Tailwind CSS 4 `@theme` custom properties — swaps all orange accent colors app-wide via `data-accent` attribute with zero component changes
- Auto-refreshes at midnight

**Multi-Provider AI**
- Support for Groq, OpenAI, Anthropic Claude, Google Gemini, and xAI Grok
- Auto-detection via `/api/capabilities` endpoint based on configured env vars
- Vision features require providers with image input support

**PWA & Native Feel**
- Platform-aware install prompt (iOS Safari steps, Android beforeinstallprompt, desktop)
- Service worker with stale-while-revalidate caching
- Offline support for cached data
- Safe area support for iOS notch devices
- Portrait and landscape orientation
- Dark mode support throughout

**Onboarding**
- Welcome screen: "Join an Existing Book" or "Set Up a New Book"
- Setup guide with deployment and configuration steps

**Developer Experience**
- CLAUDE.md with full project conventions and architecture
- Comprehensive implementation plan in docs/PLAN.md
- Google Sheets CSV import script
