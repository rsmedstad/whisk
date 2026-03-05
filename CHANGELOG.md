# Changelog

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
- TheMealDB integration: random picks, category browsing, search, and area/region filters
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
