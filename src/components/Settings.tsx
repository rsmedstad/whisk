import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSettings, AICapabilities, Recipe, RecipeIndexEntry } from "../types";
import { useAIConfig } from "../hooks/useAIConfig";
import { useHousehold } from "../hooks/useHousehold";
import { getSeasonalAccent } from "../lib/seasonal";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { AIConfigPanel } from "./AIConfigPanel";
import { ChevronLeft, Trash, Sunrise, Moon, Sun } from "./ui/Icon";

interface SettingsProps {
  theme: AppSettings["theme"];
  onSetTheme: (theme: AppSettings["theme"]) => void;
  onLogout: () => void;
  capabilities: AICapabilities;
}

export function Settings({ theme, onSetTheme, onLogout }: SettingsProps) {
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
  const [storeInput, setStoreInput] = useState("");
  const [showDanger, setShowDanger] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  const handleHouseholdChange = (size: number) => {
    const clamped = Math.max(1, Math.min(20, size));
    setHouseholdSize(clamped);
    localStorage.setItem("whisk_household_size", String(clamped));
  };

  const handleZipChange = (zip: string) => {
    setZipCode(zip);
    localStorage.setItem("whisk_zip_code", zip);
  };

  const handleAddStore = () => {
    const name = storeInput.trim();
    if (!name || preferredStores.includes(name)) { setStoreInput(""); return; }
    const updated = [...preferredStores, name];
    setPreferredStores(updated);
    localStorage.setItem("whisk_preferred_stores", JSON.stringify(updated));
    setStoreInput("");
  };

  const handleRemoveStore = (store: string) => {
    const updated = preferredStores.filter((s) => s !== store);
    setPreferredStores(updated);
    localStorage.setItem("whisk_preferred_stores", JSON.stringify(updated));
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
                    const ACCENT_ICONS: Record<string, string> = {
                      valentine: "\u2764\uFE0F", stpatrick: "\u2618\uFE0F",
                      easter: "\uD83D\uDC30", july4th: "\uD83C\uDDFA\uD83C\uDDF8",
                      halloween: "\uD83C\uDF83", thanksgiving: "\uD83E\uDD83",
                      christmas: "\uD83C\uDF84", spring: "\uD83C\uDF31",
                      summer: "\u2600\uFE0F", fall: "\uD83C\uDF42", winter: "\u2744\uFE0F",
                    };
                    const THEME_ICONS: Record<string, typeof Sun> = {
                      system: Sunrise, light: Sun, dark: Moon,
                    };
                    const currentAccent = getSeasonalAccent();
                    const ThemeIcon = THEME_ICONS[t];
                    const seasonalIcon = ACCENT_ICONS[currentAccent] ?? "";
                    const label = t === "seasonal"
                      ? `${seasonalIcon} ${ACCENT_LABELS[currentAccent] ?? "Auto"}`
                      : t;
                    return (
                      <button
                        key={t}
                        onClick={() => onSetTheme(t)}
                        className={`py-2 px-2 rounded-lg text-sm font-medium border capitalize flex items-center justify-center gap-1.5 ${
                          theme === t ? activeClass : inactiveClass
                        }`}
                      >
                        {ThemeIcon && <ThemeIcon className="w-4 h-4" />}
                        {label}
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
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border capitalize ${
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
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
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
                    Display weight in grams alongside volume measurements
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
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Household Size
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Used for recipe suggestions and scaling defaults
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleHouseholdChange(householdSize - 1)}
                    className="w-9 h-9 rounded-lg border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 font-medium text-lg"
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-lg font-semibold dark:text-stone-100">
                    {householdSize}
                  </span>
                  <button
                    onClick={() => handleHouseholdChange(householdSize + 1)}
                    className="w-9 h-9 rounded-lg border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 font-medium text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              <Input
                label="Zip Code"
                value={zipCode}
                onChange={(e) => handleZipChange(e.target.value)}
                placeholder="90210"
              />

              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Preferred Stores
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Used for deal scanning and shopping list store tags
                </p>
                {preferredStores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {preferredStores.map((store) => (
                      <span
                        key={store}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                      >
                        {store}
                        <button
                          onClick={() => handleRemoveStore(store)}
                          className="text-orange-400 hover:text-red-500"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={storeInput}
                    onChange={(e) => setStoreInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddStore(); } }}
                    placeholder="e.g. Costco, Trader Joe's"
                    className="flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <button
                    onClick={handleAddStore}
                    disabled={!storeInput.trim()}
                    className="px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Add
                  </button>
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
                Import from CSV
              </Button>
            </div>
          </Card>
        </section>

        {/* About */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
            About
          </h2>
          <Card>
            <div className="text-sm text-stone-500 dark:text-stone-400 space-y-1">
              <p className="font-medium dark:text-stone-300">Whisk v0.1.0</p>
              <p>Personal Recipe Manager</p>
            </div>
          </Card>
        </section>

        {/* Sign out */}
        <Button variant="secondary" fullWidth onClick={onLogout}>
          Sign Out
        </Button>

        {/* Danger zone */}
        <section>
          <button
            onClick={() => setShowDanger(!showDanger)}
            className="text-xs text-stone-400 dark:text-stone-500 w-full text-center py-2"
          >
            {showDanger ? "Hide" : "Show"} advanced options
          </button>
          {showDanger && (
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Danger Zone
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
    </div>
  );
}
