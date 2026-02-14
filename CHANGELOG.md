# Changelog

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
