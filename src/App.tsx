import { lazy, Suspense, useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
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
import type { Ingredient, AppSettings, OnboardingPrefs } from "./types";

// Lazy-load everything except the home tab (RecipeList) for instant first paint
const RecipeDetail = lazy(() => import("./components/recipes/RecipeDetail").then(m => ({ default: m.RecipeDetail })));
const RecipeForm = lazy(() => import("./components/recipes/RecipeForm").then(m => ({ default: m.RecipeForm })));
const CookMode = lazy(() => import("./components/recipes/CookMode").then(m => ({ default: m.CookMode })));
const ShoppingList = lazy(() => import("./components/list/ShoppingList").then(m => ({ default: m.ShoppingList })));
const MealPlan = lazy(() => import("./components/plan/MealPlan").then(m => ({ default: m.MealPlan })));
const Discover = lazy(() => import("./components/discover/Discover").then(m => ({ default: m.Discover })));
const SuggestChat = lazy(() => import("./components/suggest/SuggestChat").then(m => ({ default: m.SuggestChat })));
const Settings = lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));
const ImportRecipes = lazy(() => import("./components/import/ImportRecipes").then(m => ({ default: m.ImportRecipes })));

// Minimal skeleton for lazy-loaded routes — no layout shift
function RouteSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-16 space-y-4">
      <div className="h-6 w-40 bg-stone-200 dark:bg-stone-800 rounded" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-xl" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-xl" />
      <div className="h-20 bg-stone-100 dark:bg-stone-800 rounded-xl" />
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
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

    // Store zip code if provided
    if (prefs.zipCode) {
      localStorage.setItem("whisk_zip_code", prefs.zipCode);
    }

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
        onLogout={auth.logout}
      />
    </BrowserRouter>
  );
}

function AppShell({
  theme,
  onSetTheme,
  onLogout,
}: {
  theme: AppSettings["theme"];
  onSetTheme: (t: AppSettings["theme"]) => void;
  onLogout: () => void;
}) {
  const recipes = useRecipes();
  const shoppingList = useShoppingList();
  const mealPlan = useMealPlan();
  const timers = useTimers();
  const tags = useTags();
  const capabilities = useCapabilities();

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

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-black">
      <div className="max-w-2xl mx-auto min-h-screen bg-white dark:bg-stone-950 shadow-[0_0_40px_rgba(0,0,0,0.08)] dark:shadow-[0_0_40px_rgba(0,0,0,0.4)]">
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
                availableTags={tags.allTagNames}
              />
            }
          />
          <Route
            path="/recipes/new"
            element={
              <RecipeForm
                allTags={tags.allTagNames}
                onAddTag={async (name) => { await tags.addCustomTag(name); }}
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
              />
            }
          />
          <Route
            path="/recipes/:id/edit"
            element={
              <RecipeForm
                allTags={tags.allTagNames}
                onAddTag={async (name) => { await tags.addCustomTag(name); }}
              />
            }
          />
          <Route
            path="/recipes/:id/cook"
            element={<CookMode onStartTimer={handleStartTimer} />}
          />

          {/* Other tabs — lazy loaded */}
          <Route path="/discover" element={<Discover visionEnabled={capabilities.vision} chatEnabled={capabilities.chat} />} />
          <Route path="/identify" element={<Navigate to="/discover" replace />} />
          <Route path="/suggest" element={<SuggestChat chatEnabled={capabilities.chat} />} />
          <Route
            path="/list"
            element={
              <ShoppingList
                list={shoppingList.list}
                isLoading={shoppingList.isLoading}
                onAddItem={(name) => shoppingList.addItem(name)}
                onToggleItem={shoppingList.toggleItem}
                onRemoveItem={shoppingList.removeItem}
                onClearChecked={shoppingList.clearChecked}
                onClearAll={shoppingList.clearAll}
                onUpdateItem={shoppingList.updateItem}
                onClearCategory={shoppingList.clearCategory}
                onClassifyUncategorized={shoppingList.classifyUncategorized}
                recipeIndex={recipes.recipes}
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
              />
            }
          />
          <Route
            path="/settings"
            element={
              <Settings
                theme={theme}
                onSetTheme={onSetTheme}
                onLogout={onLogout}
                capabilities={capabilities}
              />
            }
          />
          <Route
            path="/import"
            element={
              <ImportRecipes
                onImportComplete={recipes.fetchRecipes}
              />
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      {/* Bottom nav (hidden in cook mode) */}
      <Routes>
        <Route path="/recipes/:id/cook" element={null} />
        <Route path="*" element={<BottomNav />} />
      </Routes>
      </div>
    </div>
  );
}
