import { lazy, Suspense, useState, useCallback, useMemo } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { useStyle } from "./hooks/useStyle";
import { useRecipes } from "./hooks/useRecipes";
import { useShoppingList } from "./hooks/useShoppingList";
import { useMealPlan } from "./hooks/useMealPlan";
import { useTimers } from "./hooks/useTimers";
import { useTags } from "./hooks/useTags";
import { useCapabilities } from "./hooks/useCapabilities";
import { Login } from "./components/auth/Login";
import { BottomNav } from "./components/BottomNav";
import { TimerBar } from "./components/ui/TimerBar";
import { RecipeList } from "./components/recipes/RecipeList";
import { DemoBanner } from "./components/ui/DemoBanner";
import type { Ingredient, AppSettings, AppStyle, OnboardingPrefs, UserPreferences } from "./types";

/** Full-page placeholder shown when a demo-restricted route is accessed */
function DemoRestrictedPage({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 pt-24 pb-16">
      <DemoBanner feature={feature} className="max-w-sm" />
    </div>
  );
}

// Retry dynamic imports on failure (stale chunks after deploy) by reloading once
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRetry(factory: () => Promise<any>, pick: string) {
  return lazy(() =>
    factory()
      .then((m: Record<string, unknown>) => ({ default: m[pick] as React.ComponentType<any> })) // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => {
        const key = "whisk_chunk_retry";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
        }
        return { default: (() => null) as React.ComponentType<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
      }),
  );
}

// Lazy-load everything except the home tab (RecipeList) for instant first paint
const RecipeDetail = lazyRetry(() => import("./components/recipes/RecipeDetail"), "RecipeDetail");
const RecipeForm = lazyRetry(() => import("./components/recipes/RecipeForm"), "RecipeForm");
const CookMode = lazyRetry(() => import("./components/recipes/CookMode"), "CookMode");
const ShoppingList = lazyRetry(() => import("./components/list/ShoppingList"), "ShoppingList");
const MealPlan = lazyRetry(() => import("./components/plan/MealPlan"), "MealPlan");
const Discover = lazyRetry(() => import("./components/discover/Discover"), "Discover");
const AskChat = lazyRetry(() => import("./components/suggest/SuggestChat"), "SuggestChat");
const Settings = lazyRetry(() => import("./components/Settings"), "Settings");
const ImportRecipes = lazyRetry(() => import("./components/import/ImportRecipes"), "ImportRecipes");

// Minimal skeleton for lazy-loaded routes — no layout shift
function RouteSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-16 space-y-4">
      <div className="h-6 w-40 bg-stone-200 dark:bg-stone-800 rounded" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-[var(--wk-radius-card)]" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-[var(--wk-radius-card)]" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-[var(--wk-radius-card)]" />
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const { theme, setTheme, accentOverride, setAccentOverride } = useTheme();
  const { style, setStyle } = useStyle();
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const handleLogin = useCallback(async (password: string, name?: string) => {
    await auth.login(password, name);
    if (localStorage.getItem("whisk_onboarded") !== "true") {
      setNeedsOnboarding(true);
    }
  }, [auth.login]);

  const handleCompleteOnboarding = useCallback((prefs: OnboardingPrefs) => {
    // Apply units + auto-sync temperature
    localStorage.setItem("whisk_units", prefs.units);
    const tempUnit = prefs.units === "metric" ? "C" : "F";
    localStorage.setItem("whisk_temp_unit", tempUnit);

    // Apply grams preference
    localStorage.setItem("whisk_show_grams", String(prefs.showGrams));

    // Mark onboarding complete
    localStorage.setItem("whisk_onboarded", "true");
    setNeedsOnboarding(false);
  }, []);

  if (!auth.isAuthenticated) {
    return (
      <Login
        onLogin={handleLogin}
        isLoading={auth.isLoading}
        error={auth.error}
      />
    );
  }

  if (needsOnboarding) {
    return (
      <Login
        onLogin={handleLogin}
        isLoading={auth.isLoading}
        error={auth.error}
        showOnboarding
        userName={auth.userName ?? ""}
        currentTheme={theme}
        onSetTheme={setTheme}
        onCompleteOnboarding={handleCompleteOnboarding}
      />
    );
  }

  return (
    <BrowserRouter>
      <AppShell
        theme={theme}
        onSetTheme={setTheme}
        accentOverride={accentOverride}
        onSetAccent={setAccentOverride}
        style={style}
        onSetStyle={setStyle}
        onLogout={auth.logout}
      />
    </BrowserRouter>
  );
}

function AppShell({
  theme,
  onSetTheme,
  accentOverride,
  onSetAccent,
  style,
  onSetStyle,
  onLogout,
}: {
  theme: AppSettings["theme"];
  onSetTheme: (t: AppSettings["theme"]) => void;
  accentOverride: "auto" | import("./lib/seasonal").SeasonalAccent;
  onSetAccent: (a: "auto" | import("./lib/seasonal").SeasonalAccent) => void;
  style: AppStyle;
  onSetStyle: (s: AppStyle) => void;
  onLogout: () => void;
}) {
  const recipes = useRecipes();
  const shoppingList = useShoppingList();
  const mealPlan = useMealPlan();
  const timers = useTimers();
  const tags = useTags();
  const capabilities = useCapabilities();

  // Demo mode: restrict expensive features for non-owner users
  const isDemoRestricted = capabilities.demoMode && localStorage.getItem("whisk_demo_owner") !== "true";

  // Unique recipe IDs linked to this week's meal plan
  const plannedRecipeIds = useMemo(() => {
    return [...new Set(mealPlan.plan.meals.filter((m) => m.recipeId).map((m) => m.recipeId!))];
  }, [mealPlan.plan.meals]);

  const userPreferences = useMemo((): UserPreferences | undefined => {
    try {
      const raw = localStorage.getItem("whisk_preferences");
      if (raw) return JSON.parse(raw) as UserPreferences;
    } catch { /* ignore */ }
    return undefined;
  }, []);

  const handleStartTimer = (
    label: string,
    minutes: number,
    recipeId: string,
    stepIndex: number
  ) => {
    timers.startTimer(label, minutes, recipeId, stepIndex);
  };

  const handleAddToShoppingList = async (ingredients: Ingredient[], recipeId: string) => {
    return shoppingList.addFromRecipe(ingredients, recipeId);
  };

  const handleUndoShoppingList = async (recipeId: string) => {
    await shoppingList.removeFromRecipe(recipeId);
  };

  const handleAddRecipeIngredients = async (recipeId: string) => {
    const recipe = await recipes.getRecipe(recipeId);
    return shoppingList.addFromRecipe(recipe.ingredients, recipeId);
  };

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-black">
      <div className="max-w-6xl mx-auto min-h-screen bg-white dark:bg-stone-950 shadow-[0_0_40px_rgba(0,0,0,0.08)] dark:shadow-[0_0_40px_rgba(0,0,0,0.4)]">
      {/* Timer bar */}
      {timers.hasActiveTimers && (
        <TimerBar
          timers={timers.timers}
          onPause={timers.pauseTimer}
          onResume={timers.resumeTimer}
          onCancel={timers.cancelTimer}
          onDismissCompleted={timers.dismissCompleted}
        />
      )}

      <main>
      <Suspense fallback={<RouteSkeleton />}>
        <Routes>
          {/* Recipes — eagerly loaded, it's the home screen */}
          <Route
            path="/"
            element={
              <RecipeList
                recipes={recipes.recipes}
                isLoading={recipes.isLoading}
                onToggleFavorite={recipes.toggleFavorite}
                onToggleWantToMake={recipes.toggleWantToMake}
                availableTags={tags.allTagNames}
                isDemoRestricted={isDemoRestricted}
              />
            }
          />
          <Route
            path="/recipes/new"
            element={
              isDemoRestricted ? <DemoRestrictedPage feature="Adding recipes" /> :
              <RecipeForm
                allTags={tags.allTagNames}
                onAddTag={async (name: string) => { await tags.addCustomTag(name); }}
                chatEnabled={capabilities.chat}
              />
            }
          />
          <Route
            path="/recipes/:id"
            element={
              <RecipeDetail
                onStartTimer={handleStartTimer}
                onAddToShoppingList={handleAddToShoppingList}
                onUndoShoppingList={handleUndoShoppingList}
                onAddMeal={mealPlan.addMeal}
                isDemoRestricted={isDemoRestricted}
              />
            }
          />
          <Route
            path="/recipes/:id/edit"
            element={
              isDemoRestricted ? <DemoRestrictedPage feature="Editing recipes" /> :
              <RecipeForm
                allTags={tags.allTagNames}
                onAddTag={async (name: string) => { await tags.addCustomTag(name); }}
                chatEnabled={capabilities.chat}
              />
            }
          />
          <Route
            path="/recipes/:id/cook"
            element={<CookMode onStartTimer={handleStartTimer} />}
          />

          {/* Other tabs — lazy loaded */}
          <Route path="/discover" element={<Discover onSaveRecipe={isDemoRestricted ? undefined : recipes.createRecipe} onUpdateRecipe={isDemoRestricted ? undefined : recipes.updateRecipe} chatEnabled={isDemoRestricted ? false : capabilities.chat} recipes={recipes.recipes} isDemoRestricted={isDemoRestricted} />} />
          <Route path="/identify" element={<Navigate to="/discover" replace />} />
          <Route path="/ask" element={
            <AskChat
              chatEnabled={capabilities.chat}
              recipes={recipes.recipes}
              mealPlan={mealPlan.plan.meals}
              shoppingList={shoppingList.list.items}
              preferences={userPreferences}
              onAddMeal={mealPlan.addMeal}
              onAddToList={(name: string) => shoppingList.addItem(name)}
              onAddRecipeIngredients={handleAddRecipeIngredients}
            />
          } />
          <Route path="/suggest" element={<Navigate to="/ask" replace />} />
          <Route
            path="/list"
            element={
              <ShoppingList
                list={shoppingList.list}
                isLoading={shoppingList.isLoading}
                onAddItem={(name: string, options?: Parameters<typeof shoppingList.addItem>[1]) => shoppingList.addItem(name, options)}
                onToggleItem={shoppingList.toggleItem}
                onRemoveItem={shoppingList.removeItem}
                onClearChecked={shoppingList.clearChecked}
                onClearAll={shoppingList.clearAll}
                onUpdateItem={shoppingList.updateItem}
                onClearCategory={shoppingList.clearCategory}
                onClassifyUncategorized={shoppingList.classifyUncategorized}
                recipeIndex={recipes.recipes}
                visionEnabled={capabilities.vision}
                chatEnabled={capabilities.chat}
                plannedRecipeIds={plannedRecipeIds}
                onAddFromPlan={shoppingList.addFromRecipe}
                onSyncWithPlan={shoppingList.removeStaleRecipeItems}
              />
            }
          />
          <Route
            path="/plan"
            element={
              <MealPlan
                currentDate={mealPlan.currentDate}
                getMealsForDate={mealPlan.getMealsForDate}
                onAddMeal={mealPlan.addMeal}
                onRemoveMeal={mealPlan.removeMeal}
                onNextWeek={mealPlan.goToNextWeek}
                onPrevWeek={mealPlan.goToPrevWeek}
                onToday={mealPlan.goToToday}
                isLoading={mealPlan.isLoading}
                recipeIndex={recipes.recipes}
                onGenerateShoppingList={shoppingList.addFromRecipe}
                onCopyWeek={mealPlan.copyWeek}
                onPasteWeek={mealPlan.pasteWeek}
                copiedMeals={mealPlan.copiedMeals}
                getWeekHistory={mealPlan.getWeekHistory}
                weekId={mealPlan.plan.id}
                onToggleWantToMake={recipes.toggleWantToMake}
                onClearWeek={mealPlan.clearWeek}
                onReplaceMealsForDate={mealPlan.replaceMealsForDate}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <Settings
                theme={theme}
                onSetTheme={onSetTheme}
                accentOverride={accentOverride}
                onSetAccent={onSetAccent}
                style={style}
                onSetStyle={onSetStyle}
                onLogout={onLogout}
                capabilities={capabilities}
              />
            }
          />
          <Route
            path="/import"
            element={
              isDemoRestricted ? <DemoRestrictedPage feature="Importing recipes" /> :
              <ImportRecipes
                onImportComplete={recipes.fetchRecipes}
              />
            }
          />
          <Route path="/settings/import" element={<Navigate to="/import" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </main>

      {/* Bottom nav (hidden in cook mode) */}
      <Routes>
        <Route path="/recipes/:id/cook" element={null} />
        <Route path="*" element={<BottomNav />} />
      </Routes>
      </div>
    </div>
  );
}
