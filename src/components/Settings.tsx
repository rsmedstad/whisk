import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSettings, AppStyle, AICapabilities, Recipe, RecipeIndexEntry } from "../types";
import { useAIConfig } from "../hooks/useAIConfig";
import { useHousehold } from "../hooks/useHousehold";
import { getSeasonalAccent } from "../lib/seasonal";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { AIConfigPanel } from "./AIConfigPanel";
import { ChevronLeft, Trash, ComputerDesktop, Moon, Sun, Globe, Share } from "./ui/Icon";

interface SettingsProps {
  theme: AppSettings["theme"];
  onSetTheme: (theme: AppSettings["theme"]) => void;
  style: AppStyle;
  onSetStyle: (style: AppStyle) => void;
  onLogout: () => void;
  capabilities: AICapabilities;
}

export function Settings({ theme, onSetTheme, style, onSetStyle, onLogout, capabilities }: SettingsProps) {
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
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRetagging, setIsRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<string | null>(null);
  const [isFixingText, setIsFixingText] = useState(false);
  const [fixTextResult, setFixTextResult] = useState<string | null>(null);

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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const index = await api.get<RecipeIndexEntry[]>("/recipes");
      const recipes: Recipe[] = [];
      for (const entry of index) {
        try {
          const recipe = await api.get<Recipe>(`/recipes/${entry.id}`);
          recipes.push(recipe);
        } catch {
          // Skip recipes that fail to load
        }
      }
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: "0.1.0",
        recipes,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `whisk-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
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
                <div className="grid grid-cols-2 gap-2">
                  {(["system", "light", "dark", "seasonal"] as const).map((t) => {
                    const ACCENT_LABELS: Record<string, string> = {
                      valentine: "Valentine's Day", stpatrick: "St. Patrick's",
                      easter: "Easter", july4th: "4th of July",
                      halloween: "Halloween", thanksgiving: "Thanksgiving",
                      christmas: "Christmas", spring: "Spring",
                      summer: "Summer", fall: "Fall", winter: "Winter",
                    };
                    const ACCENT_SWATCHES: Record<string, [string, string]> = {
                      valentine: ["#f43f5e", "#fda4af"],
                      stpatrick: ["#10b981", "#6ee7b7"],
                      easter: ["#8b5cf6", "#c4b5fd"],
                      july4th: ["#3b82f6", "#93c5fd"],
                      halloween: ["#f59e0b", "#fcd34d"],
                      thanksgiving: ["#ca8a04", "#fde047"],
                      christmas: ["#ef4444", "#fca5a5"],
                      spring: ["#ec4899", "#f9a8d4"],
                      summer: ["#0ea5e9", "#7dd3fc"],
                      fall: ["#f59e0b", "#fcd34d"],
                      winter: ["#6366f1", "#94a3b8"],
                    };
                    const THEME_ICONS: Record<string, typeof Sun> = {
                      system: ComputerDesktop, light: Sun, dark: Moon,
                    };
                    const currentAccent = getSeasonalAccent();
                    const ThemeIcon = THEME_ICONS[t];
                    const accentLabel = ACCENT_LABELS[currentAccent] ?? "Auto";
                    const isLongName = accentLabel.length > 10;
                    const swatches = ACCENT_SWATCHES[currentAccent];
                    return (
                      <button
                        key={t}
                        onClick={() => onSetTheme(t)}
                        className={`py-2 px-2 rounded-[var(--wk-radius-btn)] font-medium border flex items-center justify-center gap-1.5 ${
                          t === "seasonal" ? "" : "capitalize text-sm "
                        }${theme === t ? activeClass : inactiveClass}`}
                      >
                        {ThemeIcon && <ThemeIcon className="w-4 h-4" />}
                        {t === "seasonal" ? (
                          <>
                            {swatches && (
                              <span className="flex gap-0.5 shrink-0">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: swatches[0] }} />
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: swatches[1] }} />
                              </span>
                            )}
                            <span className={isLongName ? "text-xs leading-tight" : "text-sm"}>
                              Seasonal ({accentLabel})
                            </span>
                          </>
                        ) : t}
                      </button>
                    );
                  })}
                </div>
                {theme === "seasonal" && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full bg-orange-500" />
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Colors change with holidays and seasons — currently <span className="font-medium text-orange-600 dark:text-orange-400">{(() => {
                        const labels: Record<string, string> = {
                          valentine: "Valentine's Day", stpatrick: "St. Patrick's",
                          easter: "Easter", july4th: "4th of July",
                          halloween: "Halloween", thanksgiving: "Thanksgiving",
                          christmas: "Christmas", spring: "Spring",
                          summer: "Summer", fall: "Fall", winter: "Winter",
                        };
                        return labels[getSeasonalAccent()] ?? "Auto";
                      })()}</span>
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
                <div>
                  <label className="text-sm font-medium dark:text-stone-200 block">
                    Show gram weights
                  </label>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Show estimated gram weights next to volume measurements. Weights are approximate, based on common densities for each ingredient type.
                  </p>
                </div>
                <button
                  onClick={handleGramsToggle}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
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

              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Preferred Stores
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Used for deal scanning and shopping list store tags
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["Jewel", "Trader Joe's", "Walmart", "Whole Foods", "Other"] as const).map((store) => {
                    const checked = preferredStores.includes(store);
                    return (
                      <label
                        key={store}
                        className="flex items-center gap-3 px-3 py-2 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const updated = checked
                              ? preferredStores.filter((s) => s !== store)
                              : [...preferredStores, store];
                            setPreferredStores(updated);
                            localStorage.setItem("whisk_preferred_stores", JSON.stringify(updated));
                          }}
                          className="w-4 h-4 rounded border-stone-300 text-orange-500 accent-orange-500"
                        />
                        <span className="text-sm dark:text-stone-200">{store}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
              <Button variant="secondary" fullWidth onClick={handleExport} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export All (JSON)"}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => navigate("/settings/import")}>
                Import Recipes
              </Button>
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
