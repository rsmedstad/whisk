// ── Recipe ──────────────────────────────────────────────

export interface Recipe {
  id: string;
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  favorite: boolean;
  favoritedBy?: string[]; // user IDs who favorited this recipe
  wantToMake?: boolean; // flagged as "want to make" for meal planning

  // Media
  photos: RecipePhoto[];
  thumbnailUrl?: string;
  videoUrl?: string;

  // Metadata
  source?: {
    type: "manual" | "url" | "photo" | "ai";
    url?: string;
    domain?: string;
    attribution?: string;
  };
  tags: string[];
  cuisine?: string;
  shareToken?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  yield?: string;
  difficulty?: "easy" | "medium" | "hard";
  notes?: string;

  // Ratings (per-user, keyed by display name)
  ratings?: Record<string, number>; // e.g. { "Alex": 4, "Sam": 5 }

  // Cooking history
  cookedCount?: number;
  lastCookedAt?: string;

  // System
  createdAt: string;
  updatedAt: string;
  lastViewedAt?: string;
  lastCrawledAt?: string; // when recipe data was last fetched from source URL
  createdBy?: string;
}

export interface Step {
  text: string;
  photoUrl?: string;
  timerMinutes?: number;
  group?: string;
}

export interface RecipePhoto {
  url: string;
  caption?: string;
  isPrimary: boolean;
}

export interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
  category?: string;
}

// ── Recipe Index (lightweight list for browsing) ────────

export interface RecipeIndexEntry {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  wantToMake?: boolean;
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
  cookedCount?: number;
  lastCookedAt?: string;
  avgRating?: number; // pre-computed average of ratings
  ratingCount?: number; // number of users who rated
  spirits?: string[]; // display-only: primary liquors for drinks
  ingredientCount?: number; // number of ingredients (for difficulty)
  stepCount?: number; // number of steps (for difficulty)
  difficulty?: "easy" | "medium" | "hard"; // computed from time + ingredients + steps
  ingredientNames?: string[]; // compact ingredient list for AI context
  sourceUrl?: string; // original recipe URL (for feed image backfill)
}

// ── Tags ────────────────────────────────────────────────

export interface TagIndex {
  tags: TagDefinition[];
  updatedAt: string;
}

export interface TagDefinition {
  name: string;
  type: "preset" | "custom";
  color?: string;
  group?: string;
  usageCount: number;
}

export type TagGroup = "meal" | "cuisine" | "diet" | "method" | "speed" | "season" | "custom";

// ── Shopping List ───────────────────────────────────────

export interface ShoppingList {
  id: string;
  items: ShoppingItem[];
  updatedAt: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount?: string;
  unit?: string;
  category: ShoppingCategory;
  subcategory?: string; // AI-assigned subcategory within department (e.g. "Fresh Herbs", "Canned Goods")
  checked: boolean;
  sourceRecipeId?: string;
  addedBy?: "manual" | "recipe" | "ai" | "scan";
  addedByUser?: string; // user name who added this item
}

export type ShoppingCategory =
  | "produce"
  | "dairy"
  | "meat"
  | "pantry"
  | "snacks"
  | "frozen"
  | "bakery"
  | "beverages"
  | "other";

// ── Meal Plan ───────────────────────────────────────────

export interface MealPlan {
  id: string;
  meals: PlannedMeal[];
  updatedAt: string;
}

export interface PlannedMeal {
  id: string;
  date: string;
  slot: MealSlot;
  recipeId?: string;
  title: string;
  notes?: string;
  completed?: boolean;
  sourceRecipeServings?: number;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "dessert" | "extra";


// ── User Preferences (for Ask tab context) ─────────────

export interface UserPreferences {
  dietaryRestrictions?: string[];
  favoriteCuisines?: string[];
  dislikedIngredients?: string[];
}

// ── Auth ────────────────────────────────────────────────

export interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
}

// ── Household / Multi-User ──────────────────────────────

export interface Household {
  members: HouseholdMember[];
  updatedAt: string;
}

export interface HouseholdMember {
  id: string;
  name: string;
  isOwner: boolean;
  joinedAt: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  name: string;
  isOwner: boolean;
  demoMode: boolean;
  isDemoOwner: boolean;
}

// ── Timer ───────────────────────────────────────────────

export interface CookingTimer {
  id: string;
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  completedAt?: number;
  recipeId?: string;
  stepIndex?: number;
}

// ── Settings ────────────────────────────────────────────

export type AppStyle = "modern" | "editorial" | "soft" | "glass";

export interface AppSettings {
  theme: "system" | "light" | "dark" | "seasonal";
  style: AppStyle;
  units: "imperial" | "metric";
  temperatureUnit: "F" | "C";
  showGramWeights: boolean;
  displayName: string;
  householdSize: number;
  preferredAiModel: "auto" | "groq" | "xai" | "gemini" | "cf";
}

// ── Onboarding ──────────────────────────────────────────

export interface OnboardingPrefs {
  units: "imperial" | "metric";
  showGrams: boolean;
}

// ── AI Configuration ───────────────────────────────────────

export interface AIFunctionConfig {
  provider: string;
  model: string;
}

export interface AIConfig {
  mode: "simple" | "advanced";
  defaultProvider?: string;
  defaultTextModel?: string;
  defaultVisionModel?: string;
  chat?: AIFunctionConfig;
  suggestions?: AIFunctionConfig;
  vision?: AIFunctionConfig;
  ocr?: AIFunctionConfig;
}

export interface AIModelInfo {
  id: string;
  name: string;
}

export interface AIAvailableProvider {
  id: string;
  name: string;
  available: boolean;
  textModels: AIModelInfo[];
  visionModels: AIModelInfo[];
}

export interface AIConfigResponse {
  config: AIConfig | null;
  providers: AIAvailableProvider[];
}

// ── AI Capabilities (returned by /api/capabilities) ────

export interface AICapabilities {
  chat: boolean;
  vision: boolean;
  suggestions: boolean;
  nutritionEstimate: boolean;
  instagramImport: boolean;
  unsplash: boolean;
  browserRendering: boolean;
  demoMode: boolean;
}

export interface InspirationIdea {
  title: string;
  description: string;
  searchTerm: string;
  imageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
}

export interface InspirationResponse {
  ideas: InspirationIdea[];
  generatedAt: string;
  season: string;
  greeting: string;
}

// ── Discover Feed ──────────────────────────────────────

/** Legacy hardcoded source IDs (kept for backward compat with existing archives) */
export type DiscoverSourceLegacy = "nyt" | "allrecipes" | "seriouseats";

/** Source is now a free-form string — either a legacy ID or a user-configured slug */
export type DiscoverSource = string;

export type DiscoverCategory =
  | "dinner"
  | "breakfast"
  | "side dish"
  | "salad"
  | "soups"
  | "dessert"
  | "appetizer"
  | "drinks"
  | "snack"
  | "baking";

export interface DiscoverFeedItem {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
  source?: DiscoverSource;
  category?: DiscoverCategory;
  addedAt?: string;
  expiresAt?: string; // ISO date when this item leaves the discover feed
  tags?: string[];
  totalTime?: number; // estimated total minutes (from AI tagging)
}

/** Legacy format: grouped by source (used by scraper, converted for UI) */
export interface DiscoverFeedRaw {
  lastRefreshed: string;
  sources: Record<string, DiscoverFeedItem[]>;
}

/** New format: grouped by category (used by archive + UI) */
export interface DiscoverFeed {
  lastRefreshed: string;
  categories: Partial<Record<DiscoverCategory, DiscoverFeedItem[]>>;
}

// ── Discover Configuration ────────────────────────────

export interface DiscoverSourceConfig {
  id: string;        // slug identifier (e.g. "nyt", "budgetbytes")
  label: string;     // display name (e.g. "NYT Cooking", "Budget Bytes")
  url: string;       // homepage URL to scrape (e.g. "https://cooking.nytimes.com/")
  enabled: boolean;  // whether this source is active
}

export interface DiscoverConfig {
  sources: DiscoverSourceConfig[];
  autoRefreshEnabled: boolean; // when false, feed only refreshes on manual tap
  expirationEnabled: boolean; // when false, items never expire from the feed
  itemLifetimeDays: number;   // how long items stay visible (when expiration is enabled)
  refreshIntervalDays: number; // minimum days between auto-refreshes
}

// ── Import ─────────────────────────────────────────────

export interface CsvRow {
  category: string;
  dishName: string;
  recipeLink: string;
  notes: string;
  ingredientNotes: string;
}

export interface ImportResult {
  title: string;
  status: "pending" | "importing" | "created" | "failed";
  error?: string;
  recipeId?: string;
}

// ── Cloudflare Env ──────────────────────────────────────

export interface Env {
  WHISK_KV: KVNamespace;
  WHISK_R2: R2Bucket;
  APP_SECRET: string;
  // AI providers — add any/all, features auto-enable
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  XAI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  // Cloudflare Browser Rendering (for 403-blocked sites)
  CF_ACCOUNT_ID?: string;
  CF_BR_TOKEN?: string;
  // Instagram import via Apify scraper
  APIFY_API_TOKEN?: string;
  // Demo mode — restricts expensive features to owner only
  DEMO_MODE?: string;
  OWNER_PASSWORD?: string;
}
