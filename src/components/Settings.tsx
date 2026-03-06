import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSettings, AppStyle, AICapabilities, Recipe, RecipeIndexEntry } from "../types";
import type { SeasonalAccent } from "../lib/seasonal";
import { useAIConfig } from "../hooks/useAIConfig";
import { useHousehold } from "../hooks/useHousehold";
import { getSeasonalAccent } from "../lib/seasonal";
import { ACCENT_OPTIONS } from "../hooks/useTheme";
import { PRESET_TAGS } from "../lib/tags";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { AIConfigPanel } from "./AIConfigPanel";
import { classNames } from "../lib/utils";
import { ChevronLeft, Trash, ComputerDesktop, Moon, Sun, Globe, Share, Check, ChevronDown } from "./ui/Icon";

interface SettingsProps {
  theme: AppSettings["theme"];
  onSetTheme: (theme: AppSettings["theme"]) => void;
  accentOverride: "auto" | SeasonalAccent;
  onSetAccent: (accent: "auto" | SeasonalAccent) => void;
  style: AppStyle;
  onSetStyle: (style: AppStyle) => void;
  onLogout: () => void;
  capabilities: AICapabilities;
}

export function Settings({ theme, onSetTheme, accentOverride, onSetAccent, style, onSetStyle, onLogout, capabilities }: SettingsProps) {
  const aiConfig = useAIConfig();
  const hh = useHousehold();
  const navigate = useNavigate();
  const [units, setUnits] = useState<"imperial" | "metric">(() => {
    return (localStorage.getItem("whisk_units") as "imperial" | "metric") ?? "imperial";
  });
  const [tempUnit, setTempUnit] = useState<"F" | "C">(() => {
    return (localStorage.getItem("whisk_temp_unit") as "F" | "C") ?? "F";
  });
  const [showGrams, setShowGrams] = useState(() => {
    return localStorage.getItem("whisk_show_grams") === "true";
  });
  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem("whisk_display_name") ?? "";
  });
  const [householdSize, setHouseholdSize] = useState(() => {
    return parseInt(localStorage.getItem("whisk_household_size") ?? "4", 10);
  });
  const [zipCode, setZipCode] = useState(() => {
    return localStorage.getItem("whisk_zip_code") ?? "";
  });
  const [preferredStores, setPreferredStores] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferred_stores");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });

  const [recipeLayout, setRecipeLayout] = useState<"horizontal" | "vertical">(() => {
    return (localStorage.getItem("whisk_recipe_layout") as "horizontal" | "vertical") ?? "horizontal";
  });

  const [mealSlots, setMealSlots] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_meal_slots");
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ["dinner"];
  });

  const handleRecipeLayoutChange = (layout: "horizontal" | "vertical") => {
    setRecipeLayout(layout);
    localStorage.setItem("whisk_recipe_layout", layout);
  };

  const [showShareModal, setShowShareModal] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportExcludeTags, setExportExcludeTags] = useState<string[]>([]);
  const [exportIncludeNotes, setExportIncludeNotes] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRetagging, setIsRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<string | null>(null);
  const [isFixingText, setIsFixingText] = useState(false);
  const [fixTextResult, setFixTextResult] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<{ recipes: Record<string, unknown>[]; name: string } | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; errors: number } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleUnitsChange = (u: "imperial" | "metric") => {
    setUnits(u);
    localStorage.setItem("whisk_units", u);
    // Auto-align temperature if not independently set
    if (!localStorage.getItem("whisk_temp_independent")) {
      const t = u === "metric" ? "C" : "F";
      setTempUnit(t);
      localStorage.setItem("whisk_temp_unit", t);
    }
  };

  const handleTempChange = (t: "F" | "C") => {
    setTempUnit(t);
    localStorage.setItem("whisk_temp_unit", t);
    localStorage.setItem("whisk_temp_independent", "true");
  };

  const handleGramsToggle = () => {
    const next = !showGrams;
    setShowGrams(next);
    localStorage.setItem("whisk_show_grams", String(next));
  };

  const handleNameChange = (name: string) => {
    setDisplayName(name);
    localStorage.setItem("whisk_display_name", name);
  };

  const handleZipChange = (zip: string) => {
    setZipCode(zip);
    if (zip.trim()) {
      localStorage.setItem("whisk_zip_code", zip.trim());
    } else {
      localStorage.removeItem("whisk_zip_code");
    }
  };

  const handleHouseholdChange = (size: number) => {
    const clamped = Math.max(1, Math.min(20, size));
    setHouseholdSize(clamped);
    localStorage.setItem("whisk_household_size", String(clamped));
  };


  const handleReset = () => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("whisk_") || k.startsWith("recipes_") || k.startsWith("recipe_") || k.startsWith("shopping_") || k.startsWith("meal_plan_") || k.startsWith("tag_") || k.startsWith("ai_"));
    keys.forEach((k) => localStorage.removeItem(k));
    onLogout();
  };

  const handleExportBook = async () => {
    setIsExporting(true);
    try {
      const index = await api.get<RecipeIndexEntry[]>("/recipes");
      const recipes: Recipe[] = [];
      for (const entry of index) {
        // Skip recipes that have an excluded tag
        if (exportExcludeTags.length > 0 && entry.tags.some((t) => exportExcludeTags.includes(t))) continue;
        try {
          const recipe = await api.get<Recipe>(`/recipes/${entry.id}`);
          recipes.push(recipe);
        } catch {
          // Skip recipes that fail to load
        }
      }

      const origin = window.location.origin;
      const exportRecipes = recipes.map((r) => {
        // Make photo URLs absolute so importers can download them
        const absUrl = (u?: string) => u && u.startsWith("/") ? `${origin}${u}` : u;
        const cleaned: Record<string, unknown> = {
          title: r.title,
          description: r.description,
          ingredients: r.ingredients,
          steps: r.steps,
          photos: r.photos.map((p) => ({ ...p, url: absUrl(p.url) ?? p.url })),
          thumbnailUrl: absUrl(r.thumbnailUrl),
          videoUrl: r.videoUrl,
          source: r.source,
          tags: r.tags,
          cuisine: r.cuisine,
          prepTime: r.prepTime,
          cookTime: r.cookTime,
          servings: r.servings,
          yield: r.yield,
          difficulty: r.difficulty,
        };
        if (exportIncludeNotes && r.notes) cleaned.notes = r.notes;
        return cleaned;
      });

      const exportData = {
        whiskVersion: 1,
        exportedAt: new Date().toISOString(),
        source: origin,
        recipeCount: exportRecipes.length,
        recipes: exportRecipes,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `whisk-book-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBook = async () => {
    if (!importFile) return;
    const { recipes } = importFile;
    setImportProgress({ done: 0, total: recipes.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < recipes.length; i++) {
      try {
        await api.post("/import/book", recipes[i]);
      } catch {
        errors++;
      }
      setImportProgress({ done: i + 1, total: recipes.length, errors });
    }
  };

  const handleImportFileChange = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Record<string, unknown>;
        const recipes = (data.recipes ?? []) as Record<string, unknown>[];
        if (!Array.isArray(recipes) || recipes.length === 0) {
          alert("No recipes found in this file.");
          return;
        }
        setImportFile({ recipes, name: file.name });
        setImportProgress(null);
      } catch {
        alert("Could not read this file. Make sure it's a valid Whisk export.");
      }
    };
    reader.readAsText(file);
  };

  const activeClass = "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
  const inactiveClass = "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400";

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-stone-600 dark:text-stone-400 text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-xl font-bold dark:text-stone-100">Settings</h1>
          <button
            onClick={() => setShowShareModal(true)}
            className="ml-auto p-2 text-stone-400 hover:text-orange-500 dark:text-stone-500 dark:hover:text-orange-400 transition-colors"
            title="Invite to recipe book"
          >
            <Share className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            Appearance
          </h2>
          <Card>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Theme
                </label>
                {(() => {
                  const THEME_ICONS: Record<string, typeof Sun> = {
                    system: ComputerDesktop, light: Sun, dark: Moon,
                  };
                  const isSeasonal = theme === "seasonal";
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {/* Left column: system / light / dark stacked */}
                      <div className="flex flex-col gap-2">
                        {(["system", "light", "dark"] as const).map((t) => {
                          const ThemeIcon = THEME_ICONS[t];
                          return (
                            <button
                              key={t}
                              onClick={() => onSetTheme(t)}
                              className={`py-2.5 px-3 rounded-[var(--wk-radius-btn)] font-medium border flex items-center gap-2 text-sm capitalize ${theme === t ? activeClass : inactiveClass}`}
                            >
                              {ThemeIcon && <ThemeIcon className="w-4 h-4" />}
                              {t}
                            </button>
                          );
                        })}
                      </div>

                      {/* Right column: Seasonal tile */}
                      <button
                        onClick={() => onSetTheme("seasonal")}
                        className={`rounded-[var(--wk-radius-btn)] font-medium border flex flex-col items-center justify-center gap-1.5 p-3 ${isSeasonal ? activeClass : inactiveClass}`}
                      >
                        <Globe className="w-6 h-6" />
                        <span className="text-sm font-semibold">Seasonal</span>
                        <span className="text-[10px] leading-tight text-center opacity-70">
                          Colors shift with holidays &amp; seasons
                        </span>
                      </button>
                    </div>
                  );
                })()}
                {theme === "seasonal" && (
                  <div className="mt-3 space-y-1.5">
                    <label className="text-xs font-medium text-stone-500 dark:text-stone-400 block">
                      Color palette
                    </label>
                    <select
                      value={accentOverride}
                      onChange={(e) => onSetAccent(e.target.value as "auto" | SeasonalAccent)}
                      className="w-full rounded-[var(--wk-radius-input)] border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    >
                      {ACCENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {accentOverride === "auto"
                        ? "Changes automatically with the calendar"
                        : "Locked — won't change with the date"}
                    </p>
                  </div>
                )}
              </div>

              {/* Design Style */}
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Design Style
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: "modern" as const, label: "Modern", desc: "Clean & minimal" },
                    { id: "editorial" as const, label: "Editorial", desc: "Magazine-style dividers" },
                    { id: "soft" as const, label: "Soft", desc: "Rounded & cozy" },
                    { id: "brutalist" as const, label: "Brutalist", desc: "Thick borders & hard shadows" },
                    { id: "glass" as const, label: "Glass", desc: "Frosted & layered" },
                  ]).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSetStyle(s.id)}
                      className={`py-2 px-2 rounded-[var(--wk-radius-btn)] font-medium border flex flex-col items-center justify-center gap-0.5 ${
                        style === s.id ? activeClass : inactiveClass
                      }`}
                    >
                      <span className="text-sm">{s.label}</span>
                      <span className="text-[10px] opacity-60">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipe Layout */}
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Recipe Layout
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  How categories display on the Recipes tab
                </p>
                <div className="flex gap-2">
                  {([
                    { id: "horizontal" as const, label: "Carousel", desc: "Scroll sideways per category" },
                    { id: "vertical" as const, label: "Grid", desc: "All recipes in a vertical list" },
                  ]).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => handleRecipeLayoutChange(l.id)}
                      className={`flex-1 py-2 px-2 rounded-[var(--wk-radius-btn)] font-medium border flex flex-col items-center justify-center gap-0.5 ${
                        recipeLayout === l.id ? activeClass : inactiveClass
                      }`}
                    >
                      <span className="text-sm">{l.label}</span>
                      <span className="text-[10px] opacity-60">{l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Units & Measurements */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            Units & Measurements
          </h2>
          <Card>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Measurement System
                </label>
                <div className="flex gap-2">
                  {(["imperial", "metric"] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => handleUnitsChange(u)}
                      className={`flex-1 py-2 rounded-[var(--wk-radius-btn)] text-sm font-medium border capitalize ${
                        units === u ? activeClass : inactiveClass
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Temperature
                </label>
                <div className="flex gap-2">
                  {(["F", "C"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTempChange(t)}
                      className={`flex-1 py-2 rounded-[var(--wk-radius-btn)] text-sm font-medium border ${
                        tempUnit === t ? activeClass : inactiveClass
                      }`}
                    >
                      °{t} — {t === "F" ? "Fahrenheit" : "Celsius"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium dark:text-stone-200">
                  Show gram weights
                </label>
                <button
                  onClick={handleGramsToggle}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                    showGrams ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      showGrams ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </Card>
        </section>

        {/* Account */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            Account
          </h2>
          <Card>
            <div className="space-y-4">
              <Input
                label="Display Name"
                value={displayName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Ryan"
              />
              <div>
                <Input
                  label="Zip Code"
                  value={zipCode}
                  onChange={(e) => handleZipChange(e.target.value)}
                  placeholder="e.g. 90210"
                  maxLength={10}
                  inputMode="numeric"
                />
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                  Used locally for seasonal suggestions. Not shared.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Household Size
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Used for recipe suggestions and scaling defaults
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleHouseholdChange(householdSize - 1)}
                    className="w-9 h-9 rounded-[var(--wk-radius-btn)] border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 font-medium text-lg"
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-lg font-semibold dark:text-stone-100">
                    {householdSize}
                  </span>
                  <button
                    onClick={() => handleHouseholdChange(householdSize + 1)}
                    className="w-9 h-9 rounded-[var(--wk-radius-btn)] border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 font-medium text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Meal Plan Slots
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Which meals to show in your weekly plan
                </p>
                <div className="flex gap-2">
                  {(["breakfast", "lunch", "dinner"] as const).map((slot) => {
                    const enabled = mealSlots.includes(slot);
                    return (
                      <label
                        key={slot}
                        className="flex items-center gap-2 px-3 py-2 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => {
                            const updated = enabled
                              ? mealSlots.filter((s) => s !== slot)
                              : [...mealSlots, slot];
                            // Must have at least one slot
                            if (updated.length === 0) return;
                            setMealSlots(updated);
                            localStorage.setItem("whisk_meal_slots", JSON.stringify(updated));
                          }}
                          className="w-4 h-4 rounded border-stone-300 text-orange-500 accent-orange-500"
                        />
                        <span className="text-sm dark:text-stone-200 capitalize">{slot}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <PreferredStoresDropdown
                stores={preferredStores}
                onChange={(updated) => {
                  setPreferredStores(updated);
                  localStorage.setItem("whisk_preferred_stores", JSON.stringify(updated));
                }}
              />
            </div>
          </Card>
        </section>

        {/* Household Members */}
        {hh.household.members.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
              Household Members
            </h2>
            <Card>
              <div className="space-y-3">
                {hh.household.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 flex items-center justify-center text-sm font-bold">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium dark:text-stone-200">
                          {member.name}
                          {member.id === hh.currentUserId && (
                            <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-stone-400 dark:text-stone-500">
                          {member.isOwner ? "Owner" : "Member"}
                          {" \u00B7 Joined "}
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {hh.isOwner && member.id !== hh.currentUserId && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${member.name} from the household?`)) {
                            hh.removeMember(member.id);
                          }
                        }}
                        className="p-1.5 text-stone-400 hover:text-red-500"
                        title={`Remove ${member.name}`}
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* AI Model Configuration */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            AI Model Configuration
          </h2>
          <AIConfigPanel
            config={aiConfig.config}
            providers={aiConfig.providers}
            isLoading={aiConfig.isLoading}
            isSaving={aiConfig.isSaving}
            error={aiConfig.error}
            onSave={aiConfig.saveConfig}
          />
        </section>

        {/* Integrations */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            Integrations
          </h2>
          <Card>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-300">Instagram Import</p>
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    Import recipes from Instagram post captions
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    capabilities.instagramImport
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                  }`}
                >
                  {capabilities.instagramImport ? "Active" : "Not configured"}
                </span>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                {capabilities.instagramImport
                  ? "Paste any public Instagram post URL into the recipe import field to extract the recipe."
                  : "Add APIFY_API_TOKEN to your environment variables. Sign up at apify.com for a free account ($5/month credit)."}
              </p>
            </div>
          </Card>
        </section>

        {/* Data */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            Data
          </h2>
          <Card>
            <div className="space-y-3">
              {/* Export Book */}
              <div>
                <Button variant="secondary" fullWidth onClick={() => setShowExportPanel(!showExportPanel)}>
                  {showExportPanel ? "Hide Export Options" : "Export Book"}
                </Button>
                {showExportPanel && (
                  <div className="mt-3 space-y-3 border border-stone-200 dark:border-stone-700 rounded-lg p-3">
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Export recipes as a shareable file. Personal data (favorites, ratings, cook history) is not included.
                    </p>
                    <div>
                      <label className="text-xs font-medium text-stone-600 dark:text-stone-300 block mb-1.5">
                        Exclude by meal type
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_TAGS.filter((t) => t.group === "meal").map((tag) => {
                          const excluded = exportExcludeTags.includes(tag.name);
                          return (
                            <button
                              key={tag.name}
                              onClick={() => setExportExcludeTags(
                                excluded
                                  ? exportExcludeTags.filter((t) => t !== tag.name)
                                  : [...exportExcludeTags, tag.name]
                              )}
                              className={classNames(
                                "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                                excluded
                                  ? "border-red-300 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-950 dark:text-red-400 line-through"
                                  : "border-stone-200 text-stone-600 dark:border-stone-600 dark:text-stone-300"
                              )}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                      {exportExcludeTags.length > 0 && (
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                          Recipes tagged {exportExcludeTags.map((t) => `"${t}"`).join(", ")} will be excluded
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-stone-600 dark:text-stone-300">
                        Include personal notes
                      </label>
                      <button
                        onClick={() => setExportIncludeNotes(!exportIncludeNotes)}
                        className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${
                          exportIncludeNotes ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                            exportIncludeNotes ? "translate-x-4" : ""
                          }`}
                        />
                      </button>
                    </div>
                    <Button variant="primary" fullWidth onClick={handleExportBook} disabled={isExporting}>
                      {isExporting ? "Exporting..." : "Download Book"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Import Book */}
              <div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFileChange(file);
                    e.target.value = "";
                  }}
                />
                {!importFile ? (
                  <Button variant="secondary" fullWidth onClick={() => importFileRef.current?.click()}>
                    Import Book
                  </Button>
                ) : (
                  <div className="border border-stone-200 dark:border-stone-700 rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium dark:text-stone-200">
                          {importFile.recipes.length} recipe{importFile.recipes.length !== 1 ? "s" : ""} found
                        </p>
                        <p className="text-xs text-stone-400 dark:text-stone-500">{importFile.name}</p>
                      </div>
                      <button
                        onClick={() => { setImportFile(null); setImportProgress(null); }}
                        className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Recipes will be added to your book. Existing recipes won't be overwritten. Photos will be copied to your storage.
                    </p>
                    {importProgress ? (
                      <div className="space-y-2">
                        <div className="w-full bg-stone-200 dark:bg-stone-700 rounded-full h-2">
                          <div
                            className="bg-orange-500 h-2 rounded-full transition-all"
                            style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-center text-stone-500 dark:text-stone-400">
                          {importProgress.done === importProgress.total
                            ? `Done! Imported ${importProgress.done - importProgress.errors} recipe${importProgress.done - importProgress.errors !== 1 ? "s" : ""}${importProgress.errors > 0 ? `, ${importProgress.errors} failed` : ""}`
                            : `Importing ${importProgress.done} of ${importProgress.total}...`}
                        </p>
                        {importProgress.done === importProgress.total && (
                          <Button variant="secondary" fullWidth onClick={() => { setImportFile(null); setImportProgress(null); window.location.reload(); }}>
                            Done
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button variant="primary" fullWidth onClick={handleImportBook}>
                        Import {importFile.recipes.length} Recipe{importFile.recipes.length !== 1 ? "s" : ""}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-stone-200 dark:border-stone-700 pt-3">
                <Button variant="secondary" fullWidth onClick={() => navigate("/settings/import")}>
                  Import from URL / Text
                </Button>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                  Import individual recipes from websites or pasted text
                </p>
              </div>
              <div>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={isRetagging}
                  onClick={async () => {
                    setIsRetagging(true);
                    setRetagResult(null);
                    try {
                      const data = await api.post<{ updated: number }>("/recipes/retag");
                      setRetagResult(`Updated ${data.updated} recipe${data.updated === 1 ? "" : "s"}`);
                    } catch {
                      setRetagResult("Failed to refresh tags");
                    } finally {
                      setIsRetagging(false);
                    }
                  }}
                >
                  {isRetagging ? "Refreshing..." : "Refresh Speed Tags"}
                </Button>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                  Recalculates time-based tags for all recipes
                </p>
                {retagResult && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 text-center font-medium">
                    {retagResult}
                  </p>
                )}
              </div>
              <div>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={isFixingText}
                  onClick={async () => {
                    setIsFixingText(true);
                    setFixTextResult(null);
                    try {
                      const data = await api.post<{ updated: number }>("/recipes/fix-text");
                      setFixTextResult(`Fixed ${data.updated} recipe${data.updated === 1 ? "" : "s"}`);
                    } catch {
                      setFixTextResult("Failed to fix text");
                    } finally {
                      setIsFixingText(false);
                    }
                  }}
                >
                  {isFixingText ? "Fixing..." : "Fix Text Artifacts"}
                </Button>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                  Fixes &quot;teaspoon s&quot; and similar parsing artifacts
                </p>
                {fixTextResult && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 text-center font-medium">
                    {fixTextResult}
                  </p>
                )}
              </div>
              <div className="border-t border-stone-200 dark:border-stone-700 pt-3">
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={isClearingCache}
                  onClick={async () => {
                    setIsClearingCache(true);
                    try {
                      const keys = await caches.keys();
                      await Promise.all(keys.map((k) => caches.delete(k)));
                      const registrations = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(registrations.map((r) => r.unregister()));
                      window.location.reload();
                    } catch {
                      window.location.reload();
                    }
                  }}
                >
                  {isClearingCache ? "Clearing..." : "Clear Cache & Reload"}
                </Button>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                  Fixes stale styles or broken updates. Your data is not affected.
                </p>
              </div>
            </div>
          </Card>
        </section>

        {/* About & Updates */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            About & Updates
          </h2>
          <Card>
            <div className="space-y-4">
              <div className="text-sm text-stone-500 dark:text-stone-400 space-y-1">
                <p className="font-medium dark:text-stone-300">Whisk v0.3.1</p>
                <p>Personal Recipe Manager</p>
              </div>

              <div className="border-t border-stone-200 dark:border-stone-700 pt-3">
                <p className="text-sm font-medium dark:text-stone-300 mb-1">
                  Check for Updates
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
                  If you self-host Whisk, you can pull the latest features from the main repo. Go to your fork on GitHub, click "Sync fork", then "Update branch". Cloudflare Pages will automatically rebuild and deploy.
                </p>
                <div className="flex gap-2">
                  <a
                    href="https://github.com/rsmedstad/whisk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[var(--wk-radius-btn)] text-sm font-medium border border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400 hover:border-orange-500 hover:text-orange-600 dark:hover:border-orange-500 dark:hover:text-orange-400 transition-colors"
                  >
                    <Globe className="w-4 h-4" />
                    View on GitHub
                  </a>
                </div>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">
                  Updates are applied automatically. The app checks for new versions in the background.
                </p>
              </div>

              <div className="border-t border-stone-200 dark:border-stone-700 pt-3">
                <p className="text-sm font-medium dark:text-stone-300 mb-1">
                  Self-Hosting Guide
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Full setup instructions for deploying your own instance with Cloudflare Pages, KV, R2, and optional AI providers.
                </p>
                <a
                  href="https://github.com/rsmedstad/whisk#self-hosting-guide"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline"
                >
                  Read the setup guide on GitHub
                </a>
              </div>
            </div>
          </Card>
        </section>

        {/* Sign out */}
        <Button variant="secondary" fullWidth onClick={onLogout}>
          Sign Out
        </Button>

        {/* Reset */}
        <section>
          <button
            onClick={() => setShowDanger(!showDanger)}
            className="text-xs text-stone-400 dark:text-stone-500 w-full text-center py-2"
          >
            {showDanger ? "Hide" : "Show"} reset options
          </button>
          {showDanger && (
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Reset Data
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  This will clear all local data including cached recipes, settings, and sign you out. Server data is not affected.
                </p>
                <Button
                  variant="danger"
                  fullWidth
                  onClick={() => {
                    if (window.confirm("Reset all local data? This cannot be undone.")) {
                      handleReset();
                    }
                  }}
                >
                  Reset Local Data & Sign Out
                </Button>
              </div>
            </Card>
          )}
        </section>
      </div>

      {/* Share / Invite Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setShowShareModal(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold dark:text-stone-100">Invite to Recipe Book</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Share this link and password with someone to give them access to your recipe book.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-stone-500 dark:text-stone-400 block mb-1">Link</label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={window.location.origin}
                    className="flex-1 rounded-[var(--wk-radius-input)] border border-stone-300 bg-stone-50 px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin);
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                They'll need the shared password to sign in. Share it separately for security.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {navigator.share && (
                <Button
                  variant="primary"
                  onClick={() => {
                    navigator.share({
                      title: "Join my Whisk recipe book",
                      text: "Join my recipe book on Whisk!",
                      url: window.location.origin,
                    }).catch(() => {});
                  }}
                >
                  Share
                </Button>
              )}
              <Button variant="secondary" onClick={() => setShowShareModal(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STORE_OPTIONS = ["Jewel", "Trader Joe's", "Walmart", "Whole Foods", "Costco", "Aldi", "Target", "Other"];

function PreferredStoresDropdown({ stores, onChange }: { stores: string[]; onChange: (stores: string[]) => void }) {
  const [open, setOpen] = useState(false);

  const toggle = (store: string) => {
    const updated = stores.includes(store)
      ? stores.filter((s) => s !== store)
      : [...stores, store];
    onChange(updated);
  };

  return (
    <div>
      <label className="text-sm font-medium dark:text-stone-200 block mb-2">
        Preferred Stores
      </label>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between rounded-[var(--wk-radius-input)] border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        >
          <span className={stores.length === 0 ? "text-stone-400 dark:text-stone-500" : ""}>
            {stores.length === 0 ? "Select stores..." : stores.join(", ")}
          </span>
          <ChevronDown className={classNames("w-4 h-4 text-stone-400 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 py-1 max-h-60 overflow-y-auto">
              {STORE_OPTIONS.map((store) => {
                const checked = stores.includes(store);
                return (
                  <button
                    key={store}
                    onClick={() => toggle(store)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors"
                  >
                    <span className={classNames(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                      checked
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "border-stone-300 dark:border-stone-600"
                    )}>
                      {checked && <Check className="w-3 h-3" />}
                    </span>
                    <span className="dark:text-stone-200">{store}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
