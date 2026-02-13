# Recipe App - Implementation Plan

**Project**: Whisk (Personal Recipe Manager)
**Status**: Planning
**Target**: recipes.ryansmedstad.com (Cloudflare Pages + Workers)
**Open Source**: Yes - others can self-host with their own Cloudflare account
**Repo**: `rsmedstad/whisk`

---

## Design Principles

- **Mobile-first**: Primarily designed for iPhone use (added to home screen as PWA)
- **Responsive**: Works in portrait and landscape, adapts to any screen size
- **System theme**: Light/dark mode follows system preference, with manual override
- **Fast**: Minimal bundle, KV reads are sub-millisecond, cached for offline
- **Simple**: No account creation, no onboarding flow, just a password and you're in

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                recipes.ryansmedstad.com                       │
│                Cloudflare Pages (SPA)                         │
│                                                              │
│   React + Vite + PWA (mobile-first, system light/dark)       │
│                                                              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────┐ │
│   │ Recipes  │ │ Identify │ │ Suggest  │ │  List  │ │Plan│ │
│   │ Browse,  │ │ Photo AI │ │ LLM chat │ │Shopping│ │Meal│ │
│   │ Add, URL │ │ + context│ │ discover │ │  list  │ │cal.│ │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └─┬──┘ │
└────────│─────────────│────────────│────────────│────────│────┘
         │             │            │            │        │
         ▼             ▼            ▼            ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│                Cloudflare Pages Functions                      │
│                /functions/api/                                 │
│                                                              │
│   /recipes          CRUD + search + browse                   │
│   /recipes/[id]     Single recipe ops                        │
│   /import/url       Scrape recipe from URL (JSON-LD)         │
│   /identify/photo   Photo → AI food identification           │
│   /ai/suggest       LLM suggestions from context             │
│   /ai/chat          Conversational assistant                 │
│   /shopping         Shopping list CRUD + AI merge            │
│   /shopping/scan    Photo → OCR handwritten list             │
│   /plan             Meal plan calendar CRUD                  │
│   /upload           Photo upload to R2                       │
│   /auth             Token validation                         │
└───────┬──────────┬──────────┬────────────────────────────────┘
        │          │          │
        ▼          ▼          ▼
    ┌───────┐  ┌──────┐  ┌──────────────────────────────┐
    │  KV   │  │  R2  │  │  AI Models                    │
    │Recipes│  │Photos│  │  xAI Grok (vision primary)    │
    │ List  │  │      │  │  Groq (text primary, speed)   │
    │ Plan  │  │      │  │  Gemini Flash-Lite (fallback) │
    └───────┘  └──────┘  │  CF Workers AI (fallback)     │
                         └──────────────────────────────┘
```

**Separate repo, separate Cloudflare Pages project.** No dependency on the main ryansmedstad.com codebase.

---

## Navigation: 5 Tabs

The app is organized around five bottom-navigation tabs. Each has a clear, distinct purpose:

| Tab | Icon | Purpose |
|-----|------|---------|
| **Recipes** | book/utensils | Browse, search, add manually, import from URL. The recipe collection. |
| **Identify** | camera | Take a photo of food, a cookbook page, or a handwritten card. AI identifies it and pre-fills a recipe. User can add context ("this is my mom's version"). |
| **Suggest** | sparkles/wand | LLM-powered discovery. "What can I make with X?" "Suggest something similar to Y." "Help me substitute Z." Works against your existing recipes or suggests new ones. |
| **List** | checklist | Shopping list. Add items manually, generate from recipes, ask AI, or scan a handwritten list photo. Items grouped by category (produce, dairy, meat, etc.) and sortable. |
| **Plan** | calendar | Meal planner. Drag recipes onto calendar days. See the week at a glance. Generate shopping list from planned meals. |

---

## Data Model

### Recipe (stored in KV as JSON)

```typescript
interface Recipe {
  id: string;                    // nanoid, e.g. "r_V1StGXR8"
  title: string;
  description?: string;          // short summary
  ingredients: Ingredient[];
  steps: Step[];                 // ordered instructions with optional media
  favorite: boolean;             // quick-access flag (heart icon)

  // Media
  photos: RecipePhoto[];         // multiple photos (finished result + step-by-step)
  thumbnailUrl?: string;         // compressed card image for list view
  videoUrl?: string;             // external video link (YouTube, TikTok, etc.)

  // Metadata
  source?: {
    type: "manual" | "url" | "photo" | "ai";
    url?: string;                // original recipe URL if imported
    domain?: string;             // "allrecipes.com"
  };
  tags: string[];                // mix of preset + custom: ["dinner", "italian", "erica's favorite"]
  cuisine?: string;              // "Italian", "Mexican", etc.
  shareToken?: string;           // nanoid for public sharing (generated on first share)
  prepTime?: number;             // minutes
  cookTime?: number;             // minutes
  servings?: number;
  yield?: string;                // freeform: "2 loaves", "24 cookies"
  difficulty?: "easy" | "medium" | "hard";
  notes?: string;                // personal notes, substitution history

  // System
  createdAt: string;             // ISO 8601
  updatedAt: string;
  lastViewedAt?: string;         // for "recently viewed" sorting
  createdBy?: string;            // display label ("Ryan", etc.)
}

interface Step {
  text: string;                  // instruction text
  photoUrl?: string;             // optional step photo (R2 path)
  timerMinutes?: number;         // parsed from text or manually set (e.g., "bake 15 min" → 15)
}

interface RecipePhoto {
  url: string;                   // R2 path
  caption?: string;              // "finished dish", "after mixing dough"
  isPrimary: boolean;            // used as hero image and in card thumbnails
}

interface Ingredient {
  name: string;
  amount?: string;               // "2", "1/2"
  unit?: string;                 // "cups", "tbsp", "lbs"
  group?: string;                // "Sauce", "Dough" - for grouping
  category?: string;             // "produce", "dairy", "meat" - for shopping list grouping
}
```

### Tag System

Tags use a flat string array on each recipe. The app maintains a separate tag index with metadata about each tag (preset vs custom, color, usage count). This keeps the recipe data simple while giving the UI rich filtering and management.

```typescript
interface TagIndex {
  tags: TagDefinition[];
  updatedAt: string;
}

interface TagDefinition {
  name: string;                  // lowercase, display name: "dinner", "erica's favorite"
  type: "preset" | "custom";    // preset tags ship with app, custom are user-created
  color?: string;                // optional color for visual grouping (hex or tailwind class)
  group?: string;                // visual grouping: "meal", "cuisine", "diet", "method", "custom"
  usageCount: number;            // auto-updated, for sorting/relevance
}
```

**Preset tags** (ship with app, cannot be deleted, can be hidden):

| Group | Tags |
|-------|------|
| **Meal** | breakfast, brunch, lunch, dinner, dessert, appetizer, snack, side dish |
| **Cuisine** | italian, mexican, chinese, thai, indian, japanese, korean, mediterranean, american, french |
| **Diet** | vegetarian, vegan, gluten-free, dairy-free, keto, low-carb, healthy |
| **Method** | grilling, baking, slow cook, instant pot, one-pot, air fryer, no-cook, stir-fry |
| **Speed** | under 30 min, quick, weeknight, meal prep |
| **Season** | summer, fall, winter, spring, holiday |

**Custom tags** (user-created): "erica's favorite", "family recipe", "ryan's specialty", "thanksgiving", "game day", "kid-friendly", "date night", etc.

**Tag behavior across the app**:
- **Recipe list**: Horizontal scroll filter chips. Preset tags shown first (by group), then custom. Tap to filter. Multi-select to combine ("dinner" + "italian"). "All" and "Favorites" are always-visible special chips.
- **Recipe detail**: Tags shown below the title. Tap any tag to jump to filtered list.
- **Recipe form**: Tag picker shows presets organized by group, plus custom tags. Type-ahead autocomplete for existing tags. "New tag" button to create custom. Multi-select.
- **Suggest tab**: AI can reference tags ("suggest something tagged 'weeknight' I haven't made recently").
- **Search**: Tags are included in full-text search. Searching "grilling" matches both the tag and any recipe mentioning grilling in steps/notes.

### Shopping List

```typescript
interface ShoppingList {
  id: string;                    // "current" for active list, or nanoid for archived
  items: ShoppingItem[];
  updatedAt: string;
}

interface ShoppingItem {
  id: string;                    // nanoid
  name: string;
  amount?: string;
  unit?: string;
  category: string;              // "produce", "dairy", "meat", "pantry", "frozen", "bakery", "other"
  checked: boolean;
  sourceRecipeId?: string;       // which recipe added this item
  addedBy?: string;              // "manual", "recipe", "ai", "scan"
}
```

### Meal Plan

```typescript
interface MealPlan {
  id: string;                    // "YYYY-WW" (year-week) or "YYYY-MM"
  meals: PlannedMeal[];
  updatedAt: string;
}

interface PlannedMeal {
  id: string;                    // nanoid
  date: string;                  // "YYYY-MM-DD"
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  recipeId?: string;             // link to saved recipe
  title: string;                 // recipe title or freeform text ("Leftovers", "Eat out")
  notes?: string;
}
```

### KV Key Structure

```
recipe:{id}              → Recipe JSON
recipes:index            → Array of {id, title, tags, cuisine, favorite, updatedAt, thumbnailUrl}
tags:index               → TagIndex JSON (preset + custom definitions, usage counts)

shopping:current         → Current ShoppingList JSON
shopping:archive:{id}    → Past shopping lists

plan:{YYYY-WW}           → MealPlan for that week
plan:current             → Pointer to current week key

share:{token}            → {recipeId, createdAt, expiresAt?} (public share lookup)

import:queue:{id}        → Pending import jobs (TTL: 1 hour)
ai:cache:{hash}          → Cached AI responses (TTL: 7 days)
```

### R2 Key Structure

```
photos/{recipe-id}/hero.webp         → Primary photo (compressed, max 1200px wide)
photos/{recipe-id}/thumb.webp        → Thumbnail for list cards (300px, heavily compressed)
photos/{recipe-id}/step-{n}.webp     → Step-by-step photos (compressed)
photos/{recipe-id}/original-{n}.{ext}→ Original uploads (preserved for quality)
identify/{timestamp}.{ext}           → Temporary photo for AI identification (TTL: 1 hour)
exports/recipes-backup.json          → Full export for portability
```

---

## Authentication

**Simple shared-secret approach** (appropriate for 2 users, private app):

1. First visit shows a password screen
2. User enters shared password
3. Frontend hashes it, sends to `/api/auth` endpoint
4. Worker validates against stored secret (`wrangler secret put APP_SECRET`)
5. Returns a session token (stored in localStorage)
6. All subsequent API calls include `Authorization: Bearer {token}`
7. Token expires after 30 days, re-enter password

For open source users: they set their own `APP_SECRET` via wrangler secrets.

---

## App Wireframes

### Recipes Tab (Home)

```
┌──────────────────────────────────┐
│  Whisk                    🔍  +  │  ← search, add new
├──────────────────────────────────┤
│                                  │
│ [All] [Dinner] [Quick] [Italian] │  ← tag chips (horizontal scroll)
│                                  │
│ ┌──────────────────────────────┐ │
│ │ ┌────────┐                   │ │
│ │ │        │  Chicken Parm     │ │
│ │ │  photo │  dinner, italian  │ │
│ │ │        │  45 min · 4 srv   │ │
│ │ └────────┘                   │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ ┌────────┐                   │ │
│ │ │        │  Sheet Pan Salmon │ │
│ │ │  photo │  dinner, healthy  │ │
│ │ │        │  25 min · 2 srv   │ │
│ │ └────────┘                   │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ ┌────────┐                   │ │
│ │ │        │  Banana Bread     │ │
│ │ │  photo │  baking, sweet    │ │
│ │ │        │  60 min · 8 srv   │ │
│ │ └────────┘                   │ │
│ └──────────────────────────────┘ │
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
│Recipes Identify Suggest List Plan│  ← 5-tab bottom nav
└──────────────────────────────────┘
```

**Landscape mode**: Recipe cards switch to a 2-column grid. On tablets/wider screens, 3 columns.

**Add (+) menu options**:
- Add manually (opens recipe form)
- Import from URL (paste link)
- Import from CSV/Google Sheets (settings)

### Recipe Detail

```
┌──────────────────────────────────┐
│ ←  Chicken Parmesan    ♡  ✏  ⋮  │  ← back, favorite, edit, overflow
├──────────────────────────────────┤     (delete, duplicate, add to plan,
│                                  │      add to list, print, share)
│ ┌──────────────────────────────┐ │
│ │                              │ │
│ │         (hero photo)         │ │
│ │                              │ │
│ │  ◀  ● ● ◉ ●  ▶  📹         │ │  ← swipe through photos, video link
│ └──────────────────────────────┘ │
│                                  │
│  🕐 45 min  🍽 4 servings        │
│  dinner, italian                 │
│  Yields: 4 cutlets               │
│                                  │
│  ┌──────────────────────────────┐│
│  │ 🍳 Start Cooking             ││  ← enters cook mode
│  └──────────────────────────────┘│
│                                  │
│  ── Ingredients ──── [g/mL ⇄] ── │  ← unit conversion toggle
│                                  │
│  Servings: [ - ]  4  [ + ]      │  ← scales all amounts
│                                  │
│  ☐ 2 chicken breasts            │
│  ☐ 1 cup breadcrumbs            │
│  ☐ 1/2 cup parmesan             │
│  ☐ 2 cups marinara              │
│  ☐ 1 cup mozzarella             │
│  ☐ 2 eggs                       │
│                                  │
│  [Add to Shopping List]          │  ← adds unchecked items to List tab
│                                  │
│  ── Steps ────────────────────── │
│                                  │
│  1. Preheat oven to 400F.       │
│     [⏱ Set Timer]                │  ← appears when step has a time
│                                  │
│  2. Pound chicken breasts to     │
│     even thickness.              │
│     ┌────────────────────┐       │
│     │ (step photo)       │       │  ← inline step photo if available
│     └────────────────────┘       │
│                                  │
│  3. Dip in beaten eggs, then     │
│     coat with breadcrumb and     │
│     parmesan mixture.            │
│                                  │
│  4. Pan fry 3 min per side       │
│     until golden.                │
│     [⏱ 3:00]                     │  ← tap to start 3-min timer
│                                  │
│  5. Transfer to baking dish,     │
│     top with marinara and        │
│     mozzarella. Bake 15 min.     │
│     [⏱ 15:00]                    │
│                                  │
│  ── Notes ────────────────────── │
│                                  │
│  Use panko for extra crunch.     │
│  Can air fry at 380F instead.    │
│                                  │
│  Source: allrecipes.com ↗        │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ ✨  Ask AI about this recipe │ │  ← jumps to Suggest tab
│ └──────────────────────────────┘ │
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

### Identify Tab

```
┌──────────────────────────────────┐
│  Identify                        │
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │                              ││
│  │     ┌──────────────────┐     ││
│  │     │                  │     ││
│  │     │   📷  Take Photo │     ││
│  │     │                  │     ││
│  │     │  or tap to pick  │     ││
│  │     │  from gallery    │     ││
│  │     │                  │     ││
│  │     └──────────────────┘     ││
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  Add context (optional):         │
│  ┌──────────────────────────────┐│
│  │ "This is my mom's pot roast ││
│  │  recipe, about 6 servings"  ││
│  └──────────────────────────────┘│
│                                  │
│  [Identify This]                 │
│                                  │
│  ── Result ───────────────────── │
│                                  │
│  ┌──────────────────────────────┐│
│  │ 🤖 This looks like:         ││
│  │                              ││
│  │ Beef Pot Roast with          ││
│  │ Root Vegetables              ││
│  │                              ││
│  │ Confidence: High             ││
│  │                              ││
│  │ Detected ingredients:        ││
│  │ • Beef chuck roast           ││
│  │ • Carrots                    ││
│  │ • Potatoes                   ││
│  │ • Onions                     ││
│  │ • Fresh herbs (rosemary?)    ││
│  │                              ││
│  │ [Save as Recipe]  [Try Again]││
│  └──────────────────────────────┘│
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

**"Save as Recipe"** opens the recipe form pre-filled with the AI-detected title, ingredients, and the photo. User edits/confirms before saving.

**Also handles**: Cookbook page photos, handwritten recipe cards (xAI Grok OCR extracts text and structures it into recipe format).

### Suggest Tab

```
┌──────────────────────────────────┐
│  Suggest                  model ▾│
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────────┐│
│  │ Quick Actions:               ││
│  │                              ││
│  │ [What can I make?]           ││
│  │ [Dinner tonight]             ││
│  │ [Help with a substitution]   ││
│  │ [Something new to try]       ││
│  └──────────────────────────────┘│
│                                  │
│  ── Conversation ─────────────── │
│                                  │
│  You: I have chicken thighs,    │
│  rice, and some vegetables.     │
│  What should I make?            │
│                                  │
│  ┌──────────────────────────┐   │
│  │ ✨ Based on your recipes: │   │
│  │                           │   │
│  │ 1. Teriyaki Chicken Bowl  │   │
│  │    You have everything!   │   │
│  │    [Open] [+ Plan] [+ List│   │
│  │                           │   │
│  │ 2. Chicken Fried Rice     │   │
│  │    Need: soy sauce,       │   │
│  │    sesame oil              │   │
│  │    [Save New] [+ List]    │   │
│  │                           │   │
│  │ 3. One-Pot Chicken & Rice │   │
│  │    Quick weeknight meal   │   │
│  │    [Save New] [+ Plan]    │   │
│  └──────────────────────────┘   │
│                                  │
│  You: What can I sub for soy    │
│  sauce?                          │
│                                  │
│  ┌──────────────────────────┐   │
│  │ ✨ For soy sauce:         │   │
│  │                           │   │
│  │ • Coconut aminos (1:1)   │   │
│  │   Best match, less sodium │   │
│  │                           │   │
│  │ • Worcestershire + salt   │   │
│  │   (1:1) Works in stir-fry │   │
│  │                           │   │
│  │ • Fish sauce (half amount)│   │
│  │   Strong umami, very salty│   │
│  └──────────────────────────┘   │
│                                  │
├──────────────────────────────────┤
│ ┌────────────────────────────┐ ▲│
│ │ Ask about your recipes...  │  │
│ └────────────────────────────┘  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

**Context-aware**: The LLM always has access to your recipe index (titles, ingredients, tags) so it can reference your collection. Inline actions let you open existing recipes, save new suggestions, add to plan, or add missing ingredients to shopping list.

### List Tab (Shopping List)

```
┌──────────────────────────────────┐
│  Shopping List            ✨  ⋮  │  ← AI add, overflow (clear checked,
├──────────────────────────────────┤     clear all, export)
│                                  │
│  ┌────────────────────────────┐  │
│  │ + Add item...              │  │  ← quick add (type and enter)
│  └────────────────────────────┘  │
│                                  │
│  ── Produce ──────────────────── │
│                                  │
│  ☐ Carrots (3)                   │
│  ☐ Broccoli (2 heads)           │
│  ☐ Garlic (1 head)              │
│  ☑ Onions (2)              ──── │  ← strikethrough when checked
│                                  │
│  ── Dairy ────────────────────── │
│                                  │
│  ☐ Mozzarella (1 cup)           │
│  ☐ Parmesan (1/2 cup)           │
│  ☐ Eggs (6)                     │
│                                  │
│  ── Meat ─────────────────────── │
│                                  │
│  ☐ Chicken breasts (4)          │
│  ☐ Ground beef (1 lb)           │
│                                  │
│  ── Pantry ───────────────────── │
│                                  │
│  ☐ Breadcrumbs (1 cup)          │
│  ☐ Marinara (2 cups)            │
│  ☐ Soy sauce                    │
│                                  │
│  ──────────────────────────────  │
│  12 items · 3 from Chicken Parm │  ← summary + source recipes
│  ──────────────────────────────  │
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

**Ways to add items**:
1. **Manual**: Type in the quick-add bar at top
2. **From recipe**: "Add to Shopping List" button on recipe detail (adds all unchecked ingredients)
3. **From meal plan**: "Generate List" from Plan tab (combines ingredients from all planned meals, deduplicates)
4. **AI ask**: Tap ✨ icon, say "add what I need for tacos for 4" and AI adds items
5. **Scan photo**: Take photo of a handwritten list, AI OCR reads it, merges new items with existing list (no duplicates)

**Grouping**: Items auto-categorize by type (produce, dairy, meat, pantry, frozen, bakery, other). Groups are collapsible. Within each group, items are sortable by drag.

**Checked items**: Move to bottom of their group with strikethrough. "Clear checked" in overflow menu removes them.

### List Tab - AI Add / Scan Modes

```
┌──────────────────────────────────┐
│  Add to List                     │
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │  ✨  Ask AI                  ││
│  │                              ││
│  │  "Add ingredients for tacos" ││
│  │  "What do I need for the     ││
│  │   chicken parm recipe?"      ││
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │  📷  Scan Written List       ││
│  │                              ││
│  │  Take a photo of a           ││
│  │  handwritten or printed      ││
│  │  shopping list                ││
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  ── Scanned Result ───────────── │
│                                  │
│  ┌──────────────────────────────┐│
│  │ Found 8 items:               ││
│  │                              ││
│  │ ✓ Milk (1 gallon)       NEW  ││
│  │ ✓ Eggs (1 dozen)    ALREADY  ││
│  │ ✓ Bread                 NEW  ││
│  │ ✓ Butter                NEW  ││
│  │ ✓ Apples (6)           NEW  ││
│  │ ✗ Bananas         (remove?)  ││
│  │ ✓ Chicken breast    ALREADY  ││
│  │ ✓ Rice (2 lbs)         NEW  ││
│  │                              ││
│  │ 5 new · 2 already on list    ││
│  │ 1 unrecognized               ││
│  │                              ││
│  │ [Add 5 New Items]            ││
│  └──────────────────────────────┘│
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

### Plan Tab (Meal Planner)

```
┌──────────────────────────────────┐
│  Meal Plan          ◀ Week ▶  📋│  ← week nav, generate shopping list
├──────────────────────────────────┤
│                                  │
│  ── Mon, Feb 17 ──────────────── │
│  🌅 Overnight Oats              │  ← breakfast (tap to open recipe)
│  🌞 (empty)              [+ add]│  ← lunch
│  🌙 Chicken Parm         [+ add]│  ← dinner (linked to recipe)
│                                  │
│  ── Tue, Feb 18 ──────────────── │
│  🌅 (empty)              [+ add]│
│  🌞 Leftover Chicken     [+ add]│  ← freeform text (no recipe link)
│  🌙 Sheet Pan Salmon     [+ add]│
│                                  │
│  ── Wed, Feb 19 ──────────────── │
│  🌅 (empty)              [+ add]│
│  🌞 (empty)              [+ add]│
│  🌙 Tacos                [+ add]│
│                                  │
│  ── Thu, Feb 20 ──────────────── │
│  🌅 (empty)              [+ add]│
│  🌞 (empty)              [+ add]│
│  🌙 (empty)              [+ add]│
│                                  │
│  ── Fri, Feb 21 ──────────────── │
│  🌅 (empty)              [+ add]│
│  🌞 (empty)              [+ add]│
│  🌙 Eat out                     │  ← freeform text
│                                  │
│  ── Sat, Feb 22 ──────────────── │
│  ...                             │
│                                  │
│  ┌──────────────────────────────┐│
│  │ ✨ Suggest meals for empty   ││
│  │    slots this week            ││
│  └──────────────────────────────┘│
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

**Adding a meal**: Tap [+ add], pick from:
1. Your recipe collection (search/browse)
2. Type freeform text ("Leftovers", "Eat out", "Pizza night")
3. Ask AI to suggest something

**Generate shopping list** (📋 icon in header): Combines ingredients from all planned recipes for the week, deduplicates, categorizes, and sends to the List tab.

**AI assist**: "Suggest meals for empty slots" fills gaps with variety (different proteins, cuisines, difficulty levels) based on your recipe collection and what's already planned.

**Landscape mode**: Shows a full week calendar grid view instead of stacked days.

### Plan Tab - Add Meal Picker

```
┌──────────────────────────────────┐
│ ←  Add Meal · Mon Dinner         │
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ 🔍 Search recipes...       │  │
│  └────────────────────────────┘  │
│                                  │
│  ── Recent ───────────────────── │
│                                  │
│  Chicken Parm                    │
│  Sheet Pan Salmon                │
│  Tacos                           │
│                                  │
│  ── Quick Options ────────────── │
│                                  │
│  [Leftovers]  [Eat out]          │
│  [Takeout]    [Skip]             │
│                                  │
│  ── Or type custom ───────────── │
│                                  │
│  ┌────────────────────────────┐  │
│  │ e.g. "Pizza night"         │  │
│  └────────────────────────────┘  │
│                                  │
│  ── AI Suggest ───────────────── │
│                                  │
│  ┌──────────────────────────────┐│
│  │ ✨ You had chicken Mon and  ││
│  │ salmon Tue. How about:      ││
│  │                              ││
│  │ • Vegetable Stir Fry (yours)││
│  │ • Pasta Primavera (new)     ││
│  │ • Black Bean Tacos (yours)  ││
│  └──────────────────────────────┘│
│                                  │
├──────────────────────────────────┤
│ 📖      📷      ✨     📋    📅 │
└──────────────────────────────────┘
```

### Add/Edit Recipe Form

```
┌──────────────────────────────────┐
│ ←  New Recipe            [Save]  │
├──────────────────────────────────┤
│                                  │
│  ┌──────────────────────────────┐│
│  │  📷  Tap to add photo       ││
│  │      (camera or gallery)     ││
│  └──────────────────────────────┘│
│                                  │
│  Title                           │
│  ┌──────────────────────────────┐│
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  Description (optional)          │
│  ┌──────────────────────────────┐│
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  ── Ingredients ──────────────── │
│                                  │
│  ┌──────┐ ┌─────┐ ┌───────────┐ │
│  │ Amt  │ │ Unit│ │ Name      │ │
│  └──────┘ └─────┘ └───────────┘ │
│  ┌──────┐ ┌─────┐ ┌───────────┐ │
│  │ 2    │ │ cups│ │ flour     │ │
│  └──────┘ └─────┘ └───────────┘ │
│  ┌──────┐ ┌─────┐ ┌───────────┐ │
│  │ 1    │ │ tsp │ │ salt      │ │
│  └──────┘ └─────┘ └───────────┘ │
│                                  │
│  [ + Add Ingredient ]            │
│  [ + Add Group Header ]          │
│                                  │
│  ── Steps ────────────────────── │
│                                  │
│  1. ┌───────────────────────────┐│
│     │ Preheat oven to 350F     ││
│     └───────────────────────────┘│
│  2. ┌───────────────────────────┐│
│     │ Mix dry ingredients...    ││
│     └───────────────────────────┘│
│                                  │
│  [ + Add Step ]                  │
│                                  │
│  ── Details ──────────────────── │
│                                  │
│  Prep Time      Cook Time        │
│  ┌──────┐ min   ┌──────┐ min    │
│  │ 15   │       │ 45   │        │
│  └──────┘       └──────┘        │
│                                  │
│  Servings       Difficulty       │
│  ┌──────┐       [Easy|Med|Hard]  │
│  │  4   │                        │
│  └──────┘                        │
│                                  │
│  Tags                            │
│  [dinner] [italian]             │
│  [erica's favorite] [+ Add]    │  ← type-ahead + preset picker
│                                  │
│  Cuisine                         │
│  ┌──────────────────────────────┐│
│  │ Italian                   ▾ ││
│  └──────────────────────────────┘│
│                                  │
│  Notes (optional)                │
│  ┌──────────────────────────────┐│
│  │ Personal tips, tweaks...    ││
│  └──────────────────────────────┘│
│                                  │
│  Import from URL                 │
│  ┌──────────────────────────────┐│
│  │ https://...                 ││
│  └──────────────────────────────┘│
│  [Import & Fill]                 │
│                                  │
└──────────────────────────────────┘
```

### Settings

```
┌──────────────────────────────────┐
│ ←  Settings                      │
├──────────────────────────────────┤
│                                  │
│  ── Appearance ───────────────── │
│                                  │
│  Theme: [System] [Light] [Dark]  │
│  Units: [Imperial] [Metric]      │
│                                  │
│  ── Account ──────────────────── │
│                                  │
│  Display Name: Ryan              │
│  [Change Password]               │
│                                  │
│  ── Tags ─────────────────────── │
│                                  │
│  Preset tags (39)           [▾]  │
│  ┌──────────────────────────────┐│
│  │ Meal: breakfast, brunch,    ││
│  │   lunch, dinner, dessert... ││
│  │ Cuisine: italian, mexican,  ││
│  │   chinese, thai, indian...  ││
│  │ Diet: vegetarian, vegan,    ││
│  │   gluten-free, keto...      ││
│  │ Method: grilling, baking,   ││
│  │   slow cook, air fryer...   ││
│  └──────────────────────────────┘│
│                                  │
│  Custom tags (5)                 │
│  [erica's favorite ✕]           │
│  [family recipe ✕]              │
│  [ryan's specialty ✕]           │
│  [game day ✕]                   │
│  [kid-friendly ✕]              │
│                                  │
│  [ + Add Custom Tag ]            │
│                                  │
│  [Merge Tags]  [Rename Tag]     │
│                                  │
│  ── Data ─────────────────────── │
│                                  │
│  Recipes: 47 · Photos: 32 (64MB)│
│                                  │
│  [Import from Google Sheets/CSV] │
│  [Import from JSON]              │
│  [Export All (JSON)]             │
│                                  │
│  ── AI ───────────────────────── │
│                                  │
│  Preferred Model                 │
│  ( ) Auto (recommended)          │
│  ( ) Groq (fastest)              │
│  ( ) xAI Grok (best vision)     │
│  ( ) Gemini Flash                │
│  ( ) Cloudflare AI               │
│                                  │
│  ── About ────────────────────── │
│                                  │
│  Whisk v1.0.0                    │
│  github.com/rsmedstad/whisk      │
│                                  │
│  [Clear All Data]                │
│                                  │
└──────────────────────────────────┘
```

**Tag management**:
- View all preset tags grouped by category (collapsible). Can't delete presets, but can hide them from filter chips.
- Custom tags shown with delete (✕) button. Deleting a tag removes it from all recipes.
- "Merge Tags" lets you combine two tags (e.g., merge "quick" into "under 30 min"). All recipes with the old tag get the new one.
- "Rename Tag" changes a tag name across all recipes that use it.
- Usage count shown next to each tag (e.g., "dinner (23)") to help identify unused tags.

---

## Cook Mode

Cook mode is a dedicated cooking companion view accessed from any recipe detail screen. Designed for hands-free, eyes-up use while actively cooking.

### Activation
- Tap "Start Cooking" button on recipe detail
- Enters full-screen step-by-step view
- Screen stays on via Wake Lock API (no screen dimming or sleep)
- Exit via "Done Cooking" or swipe down to close

### Cook Mode Wireframe

```
┌──────────────────────────────────┐
│  Cook Mode          [Done] [🔊] │  ← exit, read aloud toggle
├──────────────────────────────────┤
│                                  │
│            Step 3 of 5           │
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │       (step photo if         ││
│  │        available)            ││
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│   Dip chicken in beaten eggs,    │
│   then coat with breadcrumb      │
│   and parmesan mixture.          │
│   Press firmly to adhere.        │
│                                  │  ← large text, high contrast
│                                  │
│                                  │
│                                  │
│  ── Active Timers ────────────── │
│                                  │
│  🔴  Oven preheat     2:34      │  ← from step 1
│                                  │
│                                  │
│  ┌──────┐            ┌──────┐   │
│  │  ◀   │            │  ▶   │   │  ← prev/next step (large tap targets)
│  │ Prev │            │ Next │   │
│  └──────┘            └──────┘   │
│                                  │
│          ● ● ◉ ● ●              │  ← step dots
│                                  │
└──────────────────────────────────┘
```

### Features
- **Wake Lock**: Screen never dims or sleeps while cook mode is active. Uses the Screen Wake Lock API (supported on all modern browsers). Falls back gracefully (just shows a "keep screen on" reminder) if unsupported.
- **Step-by-step navigation**: Large prev/next buttons. Swipe left/right also works. Each step shows one instruction at a time in large, readable text.
- **Step photos**: If the recipe has step-by-step photos, they display above the instruction for visual reference.
- **Read aloud**: Toggle speaker icon to have each step read aloud via Web Speech API when you navigate to it. Useful for hands-in-dough moments. Voice and speed adjustable in settings.
- **Timers**: When a step mentions a time ("bake 15 min", "simmer 20 minutes"), a timer button appears. Tap to start countdown. Multiple timers can run simultaneously, shown at the bottom. Audio alert when a timer completes (even if phone is locked, via notification).
- **High contrast**: Larger text, simplified layout. Dark background option to reduce glare in a dim kitchen.
- **Ingredient checklist**: Swipe up from bottom to peek at the ingredient list without leaving cook mode. Check off items as you add them.

### Read Aloud Details
- Uses Web Speech API (`speechSynthesis`) for zero-cost text-to-speech
- Reads the current step text when navigating forward
- Manual replay button on each step
- Settings: voice selection, speech rate (0.8x to 1.5x)
- Pauses if you navigate manually before speech finishes
- Works offline (TTS is browser-native, no API calls)

---

## Image Handling

### Upload Compression Pipeline

All photos are compressed client-side before uploading to R2, saving bandwidth and storage significantly.

**Pipeline**:
1. User selects photo (camera or gallery)
2. Client-side: load into `<canvas>`, resize, export as WebP
3. Upload compressed version to R2 via `/api/upload`
4. Optionally preserve original at lower priority

**Compression settings**:

| Output | Max Width | Format | Quality | Typical Size |
|--------|-----------|--------|---------|-------------|
| Hero (detail view) | 1200px | WebP | 80% | ~80-150 KB |
| Thumbnail (list card) | 300px | WebP | 70% | ~8-15 KB |
| Step photo | 800px | WebP | 75% | ~40-80 KB |
| Original (backup) | As-is | Original | Original | 2-8 MB |

**Implementation**: Pure browser Canvas API. No server-side processing needed. The `<canvas>` element handles resize + format conversion natively. Roughly 10:1 compression ratio on iPhone photos (4MB original to 100KB hero WebP).

**Storage impact**: With compression, 100 recipes with photos use ~15 MB instead of ~400 MB in R2. Extends the free tier dramatically.

### Multiple Photos Per Recipe

Recipes support multiple photos with different roles:

- **Primary/hero photo**: The finished dish. Shown in list cards and at top of recipe detail. Required for import from URL (pulled from source site).
- **Step photos**: Optional photos tied to specific steps. Shown inline during cook mode and in the recipe detail steps section.
- **Gallery**: All photos viewable in a horizontal scroll gallery on recipe detail. Tap to enlarge.

### Adding Photos
- **During creation**: Tap "Add Photo" multiple times. First photo auto-set as primary. Drag to reorder.
- **During editing**: Add/remove/reorder photos. Change which is primary.
- **From URL import**: Hero photo scraped automatically. Step photos imported if the source site has them (rare but some sites like Serious Eats include them in JSON-LD).
- **From Identify**: The photo you took becomes the primary photo of the saved recipe.

### Video References

Recipes can store an external video URL (not hosted, just a link):

- Stored as `videoUrl` on the recipe (YouTube, TikTok, Instagram Reel, etc.)
- Displayed as a tappable thumbnail/play button on recipe detail
- Opens in native player or in-app browser
- URL import auto-extracts video if present in page metadata (og:video, JSON-LD video)
- Users can manually paste a video URL when editing a recipe
- No video hosting, no bandwidth cost, just a reference link

---

## Additional Features

### Favorites
- Heart icon on recipe cards and detail view
- Toggle on/off with a single tap
- "Favorites" appears as a permanent filter chip on the Recipes tab (alongside tag-based chips)
- Favorites sync via KV like everything else

### Built-in Timers
- Parsed automatically from step text ("bake 15 minutes", "simmer for 20 min", "rest 5 mins")
- Manual timer creation from cook mode (tap + icon, set custom time)
- Multiple concurrent timers with labels ("Oven", "Sauce", "Resting")
- Audio + vibration alert on completion
- Notification API for alerts when app is backgrounded
- Timer state stored in React context (not KV, timers are ephemeral but persist across navigation)

**Timer visibility**: Timers started in cook mode are **app-wide**. A persistent floating timer bar appears at the top of any screen when timers are active. Tap the bar to expand into a full timers panel showing all running/completed timers. This way you can navigate away from cook mode (check shopping list, browse another recipe) without losing track of active timers.

**Timer bar wireframe** (shown at top of any screen when timers active):

```
┌──────────────────────────────────┐
│ ⏱ 2 timers running  12:34  ▾   │  ← tap to expand
├──────────────────────────────────┤
│  (normal app content below)      │
```

**Expanded timers panel**:

```
┌──────────────────────────────────┐
│ ⏱ Active Timers            [✕]  │
├──────────────────────────────────┤
│                                  │
│  🔴 Oven preheat      12:34     │
│     from: Chicken Parm, step 1   │
│     [Pause]  [Cancel]            │
│                                  │
│  🔴 Pan fry            1:47     │
│     from: Chicken Parm, step 4   │
│     [Pause]  [Cancel]            │
│                                  │
│  ✅ Boil water         Done!     │
│     completed 2 min ago          │
│     [Dismiss]                    │
│                                  │
│  [ + Add Custom Timer ]          │
│                                  │
└──────────────────────────────────┘
```

### Unit Conversion
- Global toggle in settings: Imperial (default) or Metric
- Per-recipe toggle on detail view
- Conversions: cups/tbsp/tsp to mL, oz to g, lbs to kg, F to C
- Fraction display: 1/3 cup stays as fraction, not "78.86 mL" (round to sensible metric values)
- Applied to ingredients and step text temperatures
- Conversion logic is client-side (no API calls)

### Search and Sort
- **Full-text search**: Title, ingredients, tags, cuisine, notes (all searched)
- **Ingredient search**: "chicken thighs" returns all recipes using that ingredient
- **Sort options**: Recently added, recently viewed, alphabetical, cook time (shortest first), most planned
- **Recently viewed**: Tracked via `lastViewedAt` timestamp on recipe. Shows as a section above the main list or as a sort option.

### Duplicate Recipe
- Available in recipe detail overflow menu
- Creates a copy with "(Copy)" appended to title
- Opens in edit mode immediately so you can rename and modify
- Useful for variations: "Chicken Parm (Air Fryer Version)"

### Print View
- Available in recipe detail overflow menu
- Renders a clean, single-column layout optimized for paper
- Includes: title, ingredients, steps, notes, source URL
- Excludes: photos (optional include toggle), navigation, buttons
- Uses `@media print` CSS, no separate page needed

---

## Sharing

Recipes can be shared in multiple ways, from quick text to public links.

### Share Options (recipe detail overflow menu)

| Method | How It Works | Requires Auth? |
|--------|-------------|----------------|
| **Share Link** | Generates a public URL anyone can view (no login needed) | No (read-only) |
| **Native Share** | Uses Web Share API (iOS share sheet: Messages, Mail, AirDrop, etc.) | N/A |
| **Copy as Text** | Copies formatted recipe to clipboard (title, ingredients, steps) | N/A |
| **Print** | Clean print layout via `@media print` CSS | N/A |

### Public Share Links

When you tap "Share Link" on a recipe:

1. App generates a `shareToken` (nanoid) and stores it on the recipe
2. A KV entry `share:{token}` maps the token to the recipe ID
3. The public URL is: `recipes.ryansmedstad.com/s/{token}`
4. Anyone with the link can view the recipe (read-only, no auth required)
5. Shared view shows: hero photo, ingredients, steps, notes, source. No editing, no navigation to other recipes.
6. Optional: set expiration (7 days, 30 days, never) or revoke at any time

**Share page wireframe**:

```
┌──────────────────────────────────┐
│                                  │
│  ┌──────────────────────────────┐│
│  │                              ││
│  │       (hero photo)           ││
│  │                              ││
│  └──────────────────────────────┘│
│                                  │
│  Chicken Parmesan                │
│  Shared from Whisk               │
│                                  │
│  🕐 45 min  🍽 4 servings        │
│                                  │
│  ── Ingredients ──────────────── │
│                                  │
│  • 2 chicken breasts             │
│  • 1 cup breadcrumbs             │
│  • 1/2 cup parmesan              │
│  • ...                           │
│                                  │
│  ── Steps ────────────────────── │
│                                  │
│  1. Preheat oven to 400F.       │
│  2. ...                          │
│                                  │
│  ── Notes ────────────────────── │
│                                  │
│  Use panko for extra crunch.     │
│                                  │
│  ──────────────────────────────  │
│  Made with Whisk                 │
│  github.com/rsmedstad/whisk      │
│  ──────────────────────────────  │
│                                  │
└──────────────────────────────────┘
```

### Native Share (Web Share API)

- Uses `navigator.share()` for native iOS/Android share sheet
- Shares the public link URL + recipe title as text
- Falls back to "Copy Link" button if Web Share API is unsupported
- Also available as "Copy as Text" which formats the full recipe as plain text:

```
Chicken Parmesan

Prep: 15 min | Cook: 30 min | Serves: 4

Ingredients:
- 2 chicken breasts
- 1 cup breadcrumbs
- 1/2 cup parmesan
...

Steps:
1. Preheat oven to 400F.
2. Pound chicken breasts to even thickness.
...

Notes:
Use panko for extra crunch.

Source: allrecipes.com
Shared from Whisk
```

### Implementation Details

- `shareToken` is generated lazily (only when first shared, not on every recipe)
- Shared page is a lightweight static route (`/s/[token]`) that fetches the recipe via a public API endpoint
- The public endpoint only returns the recipe data, nothing else (no index, no other recipes, no auth tokens)
- Share tokens are per-recipe (resharing the same recipe returns the same link)
- Revoking a share deletes the `share:{token}` KV entry and clears `shareToken` on the recipe
- R2 photos referenced by shared recipes are served via public URL (already accessible)

---

## Tech Stack

### Frontend
- **Vite + React 19** - fast dev, small bundle
- **React Router** - client-side routing for SPA
- **Tailwind CSS** - utility-first, dark mode via `dark:` variant, responsive via `sm:`/`md:`/`lg:`
- **Workbox** - service worker for PWA offline support
- **nanoid** - compact unique IDs
- **@dnd-kit** - drag-and-drop for shopping list reorder and meal plan (lightweight, accessible)

### Browser APIs (zero-dependency features)
- **Screen Wake Lock API** - keeps screen on during cook mode (no library needed)
- **Web Speech API** - read aloud for recipe steps (browser-native TTS, works offline)
- **Canvas API** - client-side image compression (resize + WebP conversion before upload)
- **Notification API** - timer completion alerts when app is backgrounded
- **Vibration API** - haptic feedback on timer completion
- **Web Share API** - native share sheet on iOS/Android (Messages, Mail, AirDrop)
- **@media print CSS** - print-friendly recipe layout (no JS library needed)

### Backend (Cloudflare Pages Functions)
- **Pages Functions** - file-based API routing, no separate Worker needed
- **KV** - recipe, shopping list, and meal plan storage
- **R2** - photo storage (public bucket or Worker proxy)
- **xAI Grok API** - vision (food ID, OCR)
- **Groq API** - fast text generation (suggestions, substitutions, chat)
- **Gemini Flash-Lite** - fallback text generation
- **CF Workers AI** - fallback vision

### PWA
- `manifest.json` with app name, icons, theme color, display: standalone
- Service worker caches recipe index + recently viewed recipes + shopping list
- Offline mode: browse cached recipes and view/check shopping list items
- Background sync for edits made offline (future)

---

## Project Structure

```
whisk/                                ← new repo: "whisk"
├── README.md                         ← setup guide, screenshots
├── package.json
├── vite.config.js
├── wrangler.toml                     ← KV + R2 bindings
├── wrangler.toml.example            ← template for self-hosters
├── tailwind.config.js
│
├── public/
│   ├── manifest.json                 ← PWA manifest
│   ├── icons/                        ← app icons (192, 512, maskable)
│   └── sw.js                         ← service worker
│
├── src/
│   ├── main.jsx                      ← app entry
│   ├── App.jsx                       ← router + auth + theme wrapper
│   │
│   ├── components/
│   │   ├── recipes/
│   │   │   ├── RecipeList.jsx        ← browse, search, filter, sort
│   │   │   ├── RecipeDetail.jsx      ← full recipe view + scaling + photos
│   │   │   ├── RecipeForm.jsx        ← add/edit + URL import + multi-photo
│   │   │   └── CookMode.jsx          ← step-by-step cooking view
│   │   ├── identify/
│   │   │   └── IdentifyPhoto.jsx     ← camera capture + AI result
│   │   ├── suggest/
│   │   │   └── SuggestChat.jsx       ← LLM conversation UI
│   │   ├── list/
│   │   │   ├── ShoppingList.jsx      ← grouped checklist
│   │   │   └── ListScan.jsx          ← photo scan + merge UI
│   │   ├── plan/
│   │   │   ├── MealPlan.jsx          ← week view
│   │   │   └── AddMeal.jsx           ← meal picker/search
│   │   ├── auth/
│   │   │   └── Login.jsx             ← password screen
│   │   ├── share/
│   │   │   └── SharedRecipe.jsx      ← public read-only recipe view
│   │   ├── Settings.jsx              ← data, theme, AI, units, tags config
│   │   ├── TagManager.jsx            ← tag CRUD, merge, rename (sub-view of Settings)
│   │   ├── BottomNav.jsx             ← 5-tab navigation
│   │   └── ui/                       ← shared: Button, Card, Input, Timer, TagPicker, etc.
│   │
│   ├── hooks/
│   │   ├── useRecipes.js             ← recipe CRUD + search + favorites
│   │   ├── useTags.js                ← tag index CRUD, presets, autocomplete
│   │   ├── useAuth.js                ← auth state + token
│   │   ├── useAi.js                  ← AI chat state
│   │   ├── useShoppingList.js        ← list CRUD + merge
│   │   ├── useMealPlan.js            ← plan CRUD
│   │   ├── useTheme.js               ← system/manual theme
│   │   ├── useWakeLock.js            ← screen wake lock for cook mode
│   │   ├── useTimers.js              ← concurrent cooking timers
│   │   ├── useSpeech.js              ← read aloud (Web Speech API)
│   │   └── useImageCompress.js       ← client-side photo compression
│   │
│   ├── lib/
│   │   ├── api.js                    ← fetch wrapper with auth
│   │   ├── utils.js                  ← formatting, scaling math
│   │   ├── categories.js             ← ingredient → category mapping
│   │   ├── units.js                  ← imperial ⇄ metric conversion
│   │   └── compress.js               ← canvas resize + WebP export
│   │
│   └── styles/
│       └── app.css                   ← tailwind imports + CSS vars
│
├── functions/                        ← Cloudflare Pages Functions (API)
│   └── api/
│       ├── auth.js                   ← POST: validate password
│       ├── recipes.js                ← GET: list, POST: create
│       ├── recipes/
│       │   └── [id].js              ← GET, PUT, DELETE
│       ├── import/
│       │   └── url.js               ← POST: scrape recipe from URL
│       ├── identify/
│       │   └── photo.js             ← POST: photo → AI identification
│       ├── ai/
│       │   ├── suggest.js           ← POST: recipe suggestions
│       │   └── chat.js              ← POST: conversational assistant
│       ├── shopping.js               ← GET, PUT: shopping list
│       ├── shopping/
│       │   └── scan.js              ← POST: photo → OCR → items
│       ├── plan.js                   ← GET, PUT: meal plan
│       ├── tags.js                   ← GET, PUT: tag index (presets + custom)
│       ├── share/
│       │   ├── create.js            ← POST: generate share token for recipe
│       │   └── [token].js           ← GET: public recipe view (no auth!)
│       └── upload.js                 ← POST: photo upload to R2
│
├── scripts/
│   ├── import-csv.js                 ← CSV/Google Sheets migration
│   ├── seed-demo.js                  ← demo data for open source
│   └── setup.sh                      ← interactive Cloudflare setup
│
└── docs/
    ├── SELF-HOSTING.md               ← step-by-step Cloudflare setup
    └── API.md                        ← endpoint reference
```

---

## Open Source Strategy

### What makes this easy to self-host

1. **Single platform**: Everything runs on Cloudflare free tier. One account, one dashboard.
2. **No database**: KV is key-value, no migrations, no schema management.
3. **No external services required for core**: AI features are optional. Core CRUD + photos + shopping list + meal plan works with zero API keys.
4. **Simple secrets**: Just `APP_SECRET` for auth. AI keys are optional.
5. **Interactive setup**: `npm run setup` walks you through creating KV/R2 and configuring secrets.

### Setup for self-hosters

```bash
# Clone
git clone https://github.com/rsmedstad/whisk.git
cd whisk

# Install
npm install

# Interactive setup (creates KV, R2, configures wrangler.toml)
npm run setup

# Or manual setup:
npx wrangler kv namespace create RECIPES
npx wrangler r2 bucket create whisk-photos
# Copy IDs into wrangler.toml

# Set auth secret
npx wrangler secret put APP_SECRET

# Optional: AI features (all have free tiers)
npx wrangler secret put GROQ_API_KEY      # console.groq.com (fast text)
npx wrangler secret put XAI_API_KEY       # console.x.ai (vision)
npx wrangler secret put GEMINI_API_KEY    # aistudio.google.com (fallback)

# Deploy
npm run deploy

# Add custom domain (optional)
# Cloudflare dashboard → Pages → Custom Domains
```

---

## Free Tier Capacity Estimates

With client-side WebP compression (~100 KB hero, ~15 KB thumb, ~60 KB step photos):

| Scenario | Recipes | Photos | KV Storage | R2 (compressed) | R2 (uncompressed) |
|----------|---------|--------|-----------|-----------------|-------------------|
| Light use (you two) | 100 | 150 | ~2 MB | ~15 MB | ~400 MB |
| Medium use | 500 | 800 | ~10 MB | ~80 MB | ~2 GB |
| Heavy use | 1,000 | 2,000 | ~20 MB | ~200 MB | ~5 GB |
| Limit | ~50,000 | ~50,000 | 1 GB | 10 GB | 10 GB |

**Compression saves ~25x on R2 storage.** At 1,000 recipes you're using 2% of R2 instead of 50%.

Shopping lists and meal plans add negligible storage (~1-5 KB each).

---

## AI Model Strategy

| Task | Primary Model | Fallback | Why |
|------|--------------|----------|-----|
| Photo → food ID | xAI Grok Vision | CF Workers AI (Llama 3.2 Vision) | Grok excels at visual recognition, especially text in images |
| Cookbook/card OCR | xAI Grok Vision | Gemini Flash | Best text extraction from photos |
| Shopping list scan | xAI Grok Vision | Gemini Flash | Read handwritten/printed lists |
| Recipe suggestions | Groq (Llama 3) | Gemini Flash-Lite | Speed (500+ tok/sec) for kitchen use |
| Substitutions | Groq (Llama 3) | Gemini Flash-Lite | Fast responses mid-cooking |
| Meal plan assist | Groq (Llama 3) | Gemini Flash-Lite | Quick weekly suggestions |
| Chat/conversation | Groq (Llama 3) | Gemini Flash-Lite | Conversational speed |
| URL scraping | No AI needed | - | Pure HTML/JSON-LD parsing |

**Model priority: Groq for speed on text tasks, xAI Grok for vision tasks.**

**Cost for typical personal use: $0.00/month**

AI features are entirely optional. The app works as a full recipe manager, shopping list, and meal planner without any AI keys configured.

---

## Implementation Order

```
Phase 1 (MVP)                              ~3-4 sessions
├── Project scaffolding (Vite, React, Tailwind, PWA, wrangler.toml)
├── Theme system (system preference + manual override, light/dark)
├── Auth flow (login screen, token in localStorage)
├── Bottom nav (5 tabs) + responsive layout (portrait + landscape)
├── Tag system: preset tags + custom tags, tag index API, tag picker component
├── Image compression pipeline (Canvas → WebP, runs on all uploads)
├── Recipe CRUD API (Pages Functions + KV)
├── Recipes tab: list with search, tag filter chips, sort, favorites
├── Recipe detail: multi-photo gallery, ingredient scaling, steps, video link
├── Recipe form: add/edit, multi-photo upload, video URL, tag picker, URL import
├── Cook mode: step-by-step view, wake lock, large text, step photos
├── Timers: parsed from step text, concurrent, floating bar across all screens
├── Shopping list: manual add, check/uncheck, category grouping, sortable
├── Meal plan: week view, add meals from recipes or freeform
├── PWA manifest + service worker (offline recipe/list viewing)
└── Google Sheets CSV import script

Phase 2 (AI + Voice)                       ~2-3 sessions
├── Identify tab: camera capture → xAI Grok Vision → pre-fill recipe
├── Cookbook/card OCR (photo of page → structured recipe)
├── Suggest tab: LLM chat with recipe context (Groq primary)
├── Substitution suggestions
├── Shopping list AI add ("add what I need for tacos")
├── Shopping list photo scan (handwritten list → OCR → merge)
├── Meal plan AI suggestions (fill empty slots)
└── Read aloud: Web Speech API for cook mode steps

Phase 3 (Connections, Sharing & Polish)    ~2-3 sessions
├── Recipe detail → "Add to Shopping List" (sends ingredients)
├── Meal plan → "Generate Shopping List" (combines week's recipes)
├── Suggest tab inline actions (save new, add to plan, add to list)
├── Recipe detail → "Add to Plan" (pick day/slot)
├── Sharing: public share links, native share (Web Share API), copy as text
├── Shared recipe page (/s/{token}, read-only, no auth)
├── Tag management in Settings: rename, merge, delete custom, hide presets
├── Unit conversion (imperial ⇄ metric toggle, per-recipe and global)
├── Duplicate recipe (overflow menu → copy → edit mode)
├── Print view (@media print)
├── Recently viewed section on Recipes tab
├── Landscape layouts (recipe grid, week calendar grid)
├── Drag-and-drop reorder in shopping list
└── Performance optimization (lazy loading, thumbnail preloading)

Phase 4 (Open Source Release)              ~1-2 sessions
├── Interactive setup script (npm run setup)
├── wrangler.toml.example + SELF-HOSTING.md
├── Demo recipes + seed script
├── README with screenshots
├── Export/backup functionality (JSON, clipboard)
└── Final testing across devices and orientations
```

---

## Decisions Made

1. **App name**: Whisk
2. **Repo**: `rsmedstad/whisk` (separate repo, open source)
3. **AI model priority**: Groq for speed on text tasks, xAI Grok for vision, Gemini/CF Workers AI as fallbacks
4. **Navigation**: 5 tabs (Recipes, Identify, Suggest, List, Plan)
5. **Design**: Mobile-first, system light/dark mode, portrait + landscape, any screen size
6. **Shopping list**: Grouped by category, multiple input methods (manual, recipe, AI, photo scan)
7. **Meal planner**: Weekly calendar view, links to recipes, generates shopping lists
8. **Cook mode**: Wake lock + step-by-step + read aloud + timers. Core cooking companion feature.
9. **Multi-photo**: Recipes support hero photo + step photos + video link. All compressed client-side.
10. **Image compression**: Client-side Canvas → WebP before upload. ~10:1 ratio on phone photos.
11. **Unit conversion**: Imperial ⇄ metric, global setting with per-recipe override
12. **Favorites**: Dedicated heart icon, separate from tags, permanent filter chip
13. **Tags**: Preset tags (meal, cuisine, diet, method, speed, season) + custom user-created tags. Managed in Settings. Filter chips on recipe list.
14. **Timers**: App-wide floating timer bar. Start from cook mode or recipe detail. Persist across navigation. Expandable panel for managing multiple concurrent timers.
15. **Sharing**: Public share links (no auth), native share (iOS share sheet), copy as text, print. Share tokens per-recipe, revocable.

## Questions Before Building

1. **Your Google Sheets structure**: What columns do you currently have? This helps write the import script.
2. **Display names**: Want user labels on recipes (e.g., "Added by Ryan")? Just cosmetic.
3. **xAI API key**: Do you have one, or start with CF Workers AI for vision and add Grok vision later?
4. **Ready to build?**: Any adjustments, or should we start Phase 1?
