# Whisk Redesign: Plan, List & Ask Tabs

## Overview

Reshape the List and Plan tabs into a cohesive meal planning + shopping system, add store deals integration, receipt-based spending tracking, and replace Suggest with a context-aware AI assistant tab called "Ask".

**Tab bar change:** `Recipes | Discover | Suggest | List | Plan` → `Recipes | Discover | Plan | List | Ask`

---

## Phase 1: Foundation — Plan & List Tab Upgrades

### 1A. New Types (`src/types/index.ts`)

Add these new types alongside existing ones:

```typescript
// Store & Deals
interface Store {
  id: string;
  name: string;
  adUrl?: string;           // Weekly circular URL pattern
  adFormat?: 'pdf' | 'html' | 'image';
  refreshDay?: number;      // 0=Sun..6=Sat (when new ads drop)
  location?: string;        // User label like "nearby" or address
}

interface Deal {
  id: string;
  storeId: string;
  storeName: string;
  item: string;
  price: number;
  originalPrice?: number;
  unit?: string;
  category?: ShoppingCategory;
  validFrom: string;        // ISO date
  validTo: string;          // ISO date
  notes?: string;
  scannedAt: string;
}

interface DealIndex {
  deals: Deal[];
  lastScanned: Record<string, string>; // storeId → ISO timestamp
  updatedAt: string;
}

// Receipt & Spending
interface Receipt {
  id: string;
  store?: string;
  date: string;             // ISO date
  items: ReceiptItem[];
  total?: number;
  scannedAt: string;
}

interface ReceiptItem {
  name: string;
  price: number;
  quantity?: number;
  unit?: string;
  category?: ShoppingCategory;
}

interface SpendingSummary {
  weekOf: string;           // ISO date of week start
  total: number;
  byStore: Record<string, number>;
  byCategory: Record<ShoppingCategory, number>;
  itemCount: number;
}

// User Preferences (for Ask tab context)
interface UserPreferences {
  dietaryRestrictions?: string[];   // vegetarian, gluten-free, etc.
  favoriteCuisines?: string[];     // italian, mexican, etc.
  budgetPreference?: 'budget' | 'moderate' | 'no-preference';
  dislikedIngredients?: string[];
}

// Extend PlannedMeal
// Add: completed?: boolean
// Add: sourceRecipeServings?: number (for scaling)

// Extend ShoppingItem
// Add: price?: number (from receipt scanning)
// Add: dealMatch?: { storeId: string; storeName: string; salePrice: number; }
```

### 1B. Plan Tab Improvements (`src/components/plan/MealPlan.tsx`)

**Changes:**
1. Add a "History" toggle alongside the existing list/tiles toggle
   - History view: month calendar grid showing dots for days with planned meals
   - Tap a past week → loads that week's plan in read-only mode
   - "Back to current week" button to return
2. Add `completed` toggle on each meal (checkmark icon)
   - Tracks what was actually cooked vs. just planned
   - Completed meals show with strikethrough/muted style
3. Add "Copy week" action in the week header overflow menu
   - Copies all meals to clipboard state, "Paste to this week" appears on target week
4. Add "Repeat last week" quick action when viewing an empty week
5. Improve the shopping list generation UX:
   - Show a preview modal of items before adding (grouped by category)
   - Highlight items that are already on the list
   - "Add missing items" button (skip duplicates by default)

**Hook changes (`src/hooks/useMealPlan.ts`):**
- Add `toggleCompleted(mealId)` method
- Add `copyWeek(weekId)` / `pasteWeek(targetWeekId)` methods
- Add `getWeekHistory(count: number)` → returns last N week summaries (id, date range, meal count, completion rate)
- Store completion state in existing `PlannedMeal` object

### 1C. List Tab Improvements (`src/components/list/ShoppingList.tsx`)

**Changes:**
1. **Store-split view** — new sort mode "by-store" alongside existing department/alpha/unchecked-first
   - Groups items by their `store` field
   - Unassigned items in an "Unassigned" group at bottom
   - Each store group is collapsible
2. **Camera FAB** — floating action button (bottom-right, above bottom nav) for photo scanning
   - Tap → camera/file picker → sends to `/api/shopping/scan`
   - Returns scanned items → shows preview modal with dedup check
   - "Add X new items (Y already on list)" confirmation
3. **Spending summary header** — if receipt data exists, show "This week: $XX.XX" in list header
   - Tap to expand weekly/monthly breakdown
4. **Deal badges** — items matching active deals show a small sale tag: "Sale at Store — $X.XX"

### 1D. Settings Additions (`src/components/Settings.tsx`)

Add to **Account tab** (which already has "Preferred Stores"):

1. **Store Ad Configuration** — expand the existing preferred stores multi-select:
   - For each selected store, optional "Weekly ad URL" field
   - "Ad format" selector (auto-detect | PDF | HTML | image)
   - "New ads on" day-of-week picker (default: Wednesday)
   - Save to KV as `stores:{bookId}`
2. **Dietary Preferences** section:
   - Dietary restrictions multi-select (vegetarian, vegan, gluten-free, dairy-free, nut-free, keto, paleo, halal, kosher)
   - Favorite cuisines multi-select (Italian, Mexican, Asian, Indian, Mediterranean, American, French, Japanese, Thai, Middle Eastern)
   - Budget preference radio (budget-friendly, moderate, no preference)
   - Disliked ingredients text input (comma-separated)
   - Save to localStorage as `whisk_preferences`

### 1E. Cache & Storage Keys (`src/lib/cache.ts`)

Add new cache keys:
```
DEAL_INDEX: "deal_index"
RECEIPTS: "receipts"
SPENDING(weekId): `spending_${weekId}`
STORES: "stores"
USER_PREFERENCES: "preferences"
```

### 1F. Bottom Nav Update (`src/components/BottomNav.tsx`)

- Rename tabs and reorder: `Recipes | Discover | Plan | List | Ask`
- Plan icon: CalendarDays (keep current)
- List icon: ShoppingCart or ListBullet (keep current)
- Ask icon: Sparkles or ChatBubble
- Update routes: `/suggest` → `/ask`

### 1G. App.tsx Route Updates

- Rename `/suggest` route to `/ask`
- Update lazy import for `AskChat` (renamed from `SuggestChat`)
- Pass additional props to Ask: `recipes`, `plan`, `shoppingList`, `preferences`, `deals`
- Add new hooks: `useStores()`, `useDeals()`, `useReceipts()`

---

## Phase 2: Receipt Scanning & Spending Tracking

### 2A. Receipt Scan API (`functions/api/shopping/receipt.ts`)

**New endpoint:** `POST /api/shopping/receipt`
- Input: photo (FormData)
- Vision AI prompt: extract store name, date, line items (name, price, qty, unit), subtotal/tax/total
- Return: `Receipt` object
- Store receipt in KV: `receipt:{id}` with TTL of 90 days
- Also maintain `receipt_index` (list of receipt IDs + dates + totals for quick lookup)

### 2B. Spending Hook (`src/hooks/useReceipts.ts`)

**New hook:** `useReceipts()`
- `scanReceipt(photo: File)` → calls API, stores result, updates spending
- `getSpendingSummary(weekId?)` → aggregated spending for a week
- `getSpendingHistory(weeks: number)` → array of weekly summaries
- `getItemPriceHistory(itemName: string)` → price over time for an item
- Cache receipts locally, sync from KV

### 2C. Spending Display in List Tab

- Weekly spend card at top of list (collapsible)
- "This week: $142.50 across 3 stores" summary
- Expandable breakdown: by store, by category
- Trend indicator: "↑ $12 vs last week" or "↓ $8 vs last week"

### 2D. Receipt Scan UX (in List tab)

- Camera FAB (from Phase 1) gains a mode toggle: "Shopping List" vs "Receipt"
- Receipt mode: scan → preview extracted items + prices → "Save Receipt"
- After saving: "Add unpurchased items back to list?" (for items on list but not on receipt)

---

## Phase 3: Store Deals & Ad Scanning

### 3A. Store Management API (`functions/api/stores.ts`)

**New endpoint:** `GET/PUT /api/stores`
- KV key: `stores:config`
- Stores array of `Store` objects (user's configured favorite stores)

### 3B. Deal Scanning Pipeline (`functions/api/deals/`)

**Refactored from existing `scan-deals.ts`:**

`POST /api/deals/scan` (rename/refactor existing endpoint):
- Input: `{ storeId, url?, photo? }`
- Enhanced URL handling:
  - HTML pages: fetch, extract deal data with AI
  - PDF URLs: fetch PDF, convert pages to images, vision AI extraction (use Cloudflare Browser Rendering if available)
  - Image URLs: direct vision AI
- Output: `{ deals: Deal[], storeName, validFrom, validTo }`
- Store results in KV: `deals:{storeId}` with TTL matching `validTo` date
- Maintain `deal_index` in KV for quick cross-store lookup

`POST /api/deals/refresh`:
- Called on cadence or manually
- For each configured store with an `adUrl`:
  - Check if existing deals have expired (`validTo < today`)
  - If expired or no deals, fetch and scan the ad URL
  - Return updated deals
- Could be triggered by the client on List tab open (if last scan > 24h)

`GET /api/deals`:
- Returns all active (non-expired) deals across all stores
- Query param: `?store={storeId}` for single-store filter

### 3C. Deal Matching (`src/lib/deals.ts`)

**New utility:**
- `matchDealsToList(items: ShoppingItem[], deals: Deal[]): Map<string, Deal[]>`
- Fuzzy matching: normalize item names, check substring + stem matching
- Returns map of item ID → matching deals
- Sort matches by best price

### 3D. Deals Hook (`src/hooks/useDeals.ts`)

**New hook:** `useDeals()`
- `deals: Deal[]` — all active deals
- `refreshDeals()` — trigger scan for all stores
- `scanAdUrl(url: string, storeId?: string)` — ad-hoc scan
- `getDealsForItem(itemName: string)` — find matching deals
- `getBestStore(items: ShoppingItem[])` — recommend store with most matching deals
- Auto-refresh: on mount, if last scan > 24h for any store, trigger refresh
- Auto-purge: filter out deals past `validTo` date on load

### 3E. Deal Display Enhancements

**In List tab:**
- Deal badges on matching items (Phase 1 placeholder → now functional)
- "Deals" expandable section at bottom: all current deals grouped by store
- "Best store for this trip" recommendation card above the list

**In Plan tab:**
- When adding meals, show "Ingredients on sale" indicator next to recipes with deal-matched ingredients

---

## Phase 4: Ask Tab (AI Assistant)

### 4A. Rename & Restructure Suggest → Ask

**File changes:**
- Rename `src/components/suggest/SuggestChat.tsx` → `src/components/ask/AskChat.tsx`
- Update all imports and routes
- Keep existing chat UI as the base

### 4B. Enhanced System Prompt

Build a rich context prompt that includes:
```
You are Whisk's AI assistant. You help with meal planning, shopping, and cooking.

Current context:
- User's saved recipes: [titles + tags + cuisines, top 50 by usage]
- This week's meal plan: [planned meals with dates/slots]
- Shopping list: [current items, checked/unchecked]
- Active deals: [store deals summary]
- User preferences: [dietary, cuisines, budget, household size]
- Season: [current season + upcoming holidays]
- Date: [today's date]

You can suggest actions. Format actionable suggestions with these markers:
[ADD_TO_PLAN: date, slot, recipeTitle, recipeId?]
[ADD_TO_LIST: itemName, amount?, unit?, category?]
[SEARCH_RECIPES: query]
```

### 4C. Quick Action Chips

Replace current landing cards with contextual quick actions:
- "Plan my week" — generates a full week plan based on preferences, variety, deals
- "What's on sale?" — summarizes current deals across stores
- "Shopping list from plan" — generates list from this week's planned meals
- "Suggest dinner" — single meal suggestion
- "What can I make?" — suggests recipes from what's likely on hand (recent purchases)
- Seasonal/contextual chip: "St. Patrick's Day ideas" (based on upcoming holidays)

### 4D. Actionable Responses

Parse AI responses for action markers and render inline buttons:
- `[ADD_TO_PLAN: ...]` → "Add to Plan" button that calls `addMeal()`
- `[ADD_TO_LIST: ...]` → "Add to List" button that calls `addItem()`
- `[SEARCH_RECIPES: ...]` → "Search Recipes" button that navigates to recipe list with filter
- Recipe links (already exist) → "Save Recipe" button (already exists)

### 4E. Ask API Enhancement (`functions/api/ai/chat.ts`)

- Accept additional context fields in the request body:
  - `mealPlan?: PlannedMeal[]`
  - `shoppingList?: ShoppingItem[]`
  - `deals?: Deal[]`
  - `preferences?: UserPreferences`
  - `recipeIndex?: RecipeIndexEntry[]`
- Build enhanced system prompt server-side with this context
- Keep streaming response format

---

## Phase 5: Polish & Refinement

### 5A. Plan Tab Polish
- Drag to reorder meals within a day (optional, stretch goal)
- "Favorites" quick-add: surface top 10 most-used recipes as one-tap adds
- Weekly summary card: meals planned, meals completed, variety score

### 5B. List Tab Polish
- Smart store suggestion: when adding items, suggest store based on past purchases + current deals
- "Trip planner" view: ordered list optimized for a single store's layout (stretch goal)
- Quantity scaling: adjust amounts based on household size vs. recipe servings

### 5C. Spending Insights
- Monthly spending chart (simple bar chart, last 4 weeks)
- "Most expensive items" list
- "Price change alerts" — if a regularly-bought item's price changed significantly

### 5D. Ask Tab Polish
- Conversation memory across sessions (store last N messages in localStorage)
- "Plan my week" full workflow: AI suggests → user approves/edits → auto-adds to plan + list
- Voice input support (Web Speech API, already have `useSpeech` hook)

---

## Implementation Order (per phase)

### Phase 1 (Foundation) — estimated files touched: ~12
1. Types additions in `src/types/index.ts`
2. Cache keys in `src/lib/cache.ts`
3. BottomNav rename + reorder
4. App.tsx route updates
5. Settings: store config + dietary preferences
6. Plan tab: history view + completed tracking + copy week
7. useMealPlan hook: new methods
8. List tab: store-split view + camera FAB + deal badge placeholders
9. useShoppingList hook: minor additions

### Phase 2 (Receipts & Spending) — estimated files touched: ~6
1. Receipt scan API endpoint
2. useReceipts hook
3. List tab: receipt scan mode + spending display
4. Spending summary component

### Phase 3 (Deals) — estimated files touched: ~8
1. Stores API endpoint
2. Deals API endpoints (refactor existing + new)
3. Deal matching utility
4. useDeals hook
5. List tab: deal display enhancements
6. Plan tab: deal indicators on recipes

### Phase 4 (Ask Tab) — estimated files touched: ~5
1. Rename suggest → ask (files + routes + nav)
2. Enhanced system prompt builder
3. Quick action chips
4. Actionable response parsing + buttons
5. Chat API enhancement

### Phase 5 (Polish) — estimated files touched: ~6
1. Plan tab polish (favorites, summary)
2. List tab polish (smart suggestions, scaling)
3. Spending insights
4. Ask tab polish (memory, voice)
