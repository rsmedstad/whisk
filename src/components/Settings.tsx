import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSettings, AICapabilities } from "../types";
import { useAIConfig } from "../hooks/useAIConfig";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { AIConfigPanel } from "./AIConfigPanel";

interface SettingsProps {
  theme: AppSettings["theme"];
  onSetTheme: (theme: AppSettings["theme"]) => void;
  onLogout: () => void;
  capabilities: AICapabilities;
}

export function Settings({ theme, onSetTheme, onLogout }: SettingsProps) {
  const aiConfig = useAIConfig();
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
  const [showDanger, setShowDanger] = useState(false);

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

  const handleReset = () => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("whisk_") || k.startsWith("recipes_") || k.startsWith("recipe_") || k.startsWith("shopping_") || k.startsWith("meal_plan_") || k.startsWith("tag_") || k.startsWith("ai_"));
    keys.forEach((k) => localStorage.removeItem(k));
    onLogout();
  };

  const activeClass = "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
  const inactiveClass = "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400";

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-stone-600 dark:text-stone-400 text-sm font-medium"
          >
            &#8592; Back
          </button>
          <h1 className="text-xl font-bold dark:text-stone-100">Settings</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
            Appearance
          </h2>
          <Card>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                  Theme
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["system", "light", "dark", "seasonal"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => onSetTheme(t)}
                      className={`py-2 rounded-lg text-sm font-medium border capitalize ${
                        theme === t ? activeClass : inactiveClass
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {theme === "seasonal" && (
                  <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                    Colors change with holidays and seasons
                  </p>
                )}
              </div>
            </div>
          </Card>
        </section>

        {/* Units & Measurements */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
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
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
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
            </div>
          </Card>
        </section>

        {/* AI Model Configuration */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
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
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
            Data
          </h2>
          <Card>
            <div className="space-y-3">
              <Button variant="secondary" fullWidth onClick={() => alert("Export coming soon!")}>
                Export All (JSON)
              </Button>
              <Button variant="secondary" fullWidth onClick={() => navigate("/settings/import")}>
                Import from CSV
              </Button>
            </div>
          </Card>
        </section>

        {/* About */}
        <section>
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-3">
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
