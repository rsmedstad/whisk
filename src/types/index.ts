// ── Recipe ──────────────────────────────────────────────

export interface Recipe {
  id: string;
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  favorite: boolean;
  favoritedBy?: string[]; // user IDs who favorited this recipe

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
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
  cookedCount?: number;
  lastCookedAt?: string;
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
  checked: boolean;
  sourceRecipeId?: string;
  addedBy?: "manual" | "recipe" | "ai" | "scan";
  addedByUser?: string; // user name who added this item
  store?: string; // optional store tag for filtering (e.g. "Costco", "Trader Joe's")
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
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

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

export type AppStyle = "modern" | "editorial" | "soft" | "brutalist" | "glass";

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
  zipCode: string;
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
}
