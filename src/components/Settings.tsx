import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AppSettings, AppStyle, AICapabilities, Recipe, RecipeIndexEntry, DiscoverConfig, DiscoverSourceConfig } from "../types";
import { getSeasonalAccent, type SeasonalAccent } from "../lib/seasonal";
import { useAIConfig } from "../hooks/useAIConfig";
import { useHousehold } from "../hooks/useHousehold";
import { ACCENT_OPTIONS } from "../hooks/useTheme";
import { PRESET_TAGS, TAG_GROUP_LABELS, TAG_GROUP_ORDER } from "../lib/tags";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { AIConfigPanel } from "./AIConfigPanel";
import { classNames } from "../lib/utils";
import {
  ChevronLeft, Trash, Globe, Share, Check, ChevronDown, XMark, Sun, Moon, ComputerDesktop, CalendarDays,
  Pumpkin, ChristmasTree, Snowflake, HeartArrow, Shamrock, EasterEgg, Firework, TurkeyLeg,
  RefreshCw, Flower, Leaf, ExternalLink,
} from "./ui/Icon";

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

type SettingsTab = "general" | "account" | "ai" | "data" | "about";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "Display" },
  { id: "account", label: "Preferences" },
  { id: "ai", label: "AI" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
];

/** SVG icon components for every accent */
const ACCENT_ICON: Record<string, typeof Pumpkin> = {
  auto: RefreshCw,
  spring: Flower,
  summer: Sun,
  fall: Leaf,
  winter: Snowflake,
  valentine: HeartArrow,
  stpatrick: Shamrock,
  easter: EasterEgg,
  july4th: Firework,
  halloween: Pumpkin,
  thanksgiving: TurkeyLeg,
  christmas: ChristmasTree,
};

function AccentIcon({ accent, className = "w-5 h-5" }: { accent: string; className?: string }) {
  const SvgIcon = ACCENT_ICON[accent];
  if (SvgIcon) return <SvgIcon className={className} />;
  return null;
}

const ACCENT_COLORS: Record<string, string[]> = {
  auto: ["#22c55e", "#16a34a", "#15803d"],
  spring: ["#f080b8", "#d93884", "#991a55"],
  summer: ["#ffcc33", "#e88d0a", "#cc7400"],
  fall: ["#e09030", "#b36000", "#7a3f00"],
  winter: ["#5580cc", "#1a44aa", "#102c75"],
  valentine: ["#ff6090", "#e0115f", "#9e0042"],
  stpatrick: ["#33cc33", "#008800", "#d4a828"],
  easter: ["#bb99ff", "#8844ee", "#ffb6d9"],
  july4th: ["#cc0000", "#1e40af", "#ffffff"],
  halloween: ["#ff9900", "#ff5500", "#7b2dbd"],
  thanksgiving: ["#e09020", "#b36200", "#8b2252"],
  christmas: ["#cc0000", "#1a6b1a", "#d4a828"],
};

export function Settings({ theme, onSetTheme, accentOverride, onSetAccent, style, onSetStyle, onLogout, capabilities }: SettingsProps) {
  const aiConfig = useAIConfig();
  const hh = useHousehold();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [units, setUnits] = useState<"imperial" | "metric">(() => {
    return (localStorage.getItem("whisk_units") as "imperial" | "metric") ?? "imperial";
  });
  const [tempUnit, setTempUnit] = useState<"F" | "C">(() => {
    return (localStorage.getItem("whisk_temp_unit") as "F" | "C") ?? "F";
  });
  const [showGrams, setShowGrams] = useState(() => {
    const saved = localStorage.getItem("whisk_show_grams");
    return saved === null ? true : saved === "true";
  });
  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem("whisk_display_name") ?? "";
  });
  const [householdSize, setHouseholdSize] = useState(() => {
    const saved = localStorage.getItem("whisk_household_size");
    return saved ? parseInt(saved, 10) : 2;
  });

  const [showAccentPicker, setShowAccentPicker] = useState(false);

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

  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferences");
      if (raw) {
        const prefs = JSON.parse(raw) as Record<string, unknown>;
        return Array.isArray(prefs.dietaryRestrictions) ? prefs.dietaryRestrictions as string[] : [];
      }
    } catch {}
    return [];
  });
  const [favoriteCuisines, setFavoriteCuisines] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferences");
      if (raw) {
        const prefs = JSON.parse(raw) as Record<string, unknown>;
        return Array.isArray(prefs.favoriteCuisines) ? prefs.favoriteCuisines as string[] : [];
      }
    } catch {}
    return [];
  });
  const [dislikedIngredients, setDislikedIngredients] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferences");
      if (raw) {
        const prefs = JSON.parse(raw) as Record<string, unknown>;
        return Array.isArray(prefs.dislikedIngredients) ? prefs.dislikedIngredients as string[] : [];
      }
    } catch {}
    return [];
  });
  const [dislikedInput, setDislikedInput] = useState("");

  const savePreferences = (updates: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem("whisk_preferences");
      const existing = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      localStorage.setItem("whisk_preferences", JSON.stringify({ ...existing, ...updates }));
    } catch {}
  };

  const [showShareModal, setShowShareModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportExcludeTags, setExportExcludeTags] = useState<string[]>([]);
  const [exportIncludeNotes, setExportIncludeNotes] = useState(false);
  const [discoverConfig, setDiscoverConfig] = useState<DiscoverConfig | null>(null);
  const [discoverConfigSnapshot, setDiscoverConfigSnapshot] = useState<DiscoverConfig | null>(null);
  const [discoverConfigDirty, setDiscoverConfigDirty] = useState(false);
  const [discoverConfigSaving, setDiscoverConfigSaving] = useState(false);
  const [discoverConfigError, setDiscoverConfigError] = useState<string | null>(null);

  // Load discover config from server
  useEffect(() => {
    api.get<DiscoverConfig>("/discover/config").then((config) => {
      if (config) {
        setDiscoverConfig(config);
        setDiscoverConfigSnapshot(config);
      }
    }).catch(() => {});
  }, []);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRetagging, setIsRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<string | null>(null);
  const [isFixingText, setIsFixingText] = useState(false);
  const [fixTextResult, setFixTextResult] = useState<string | null>(null);
  const [isRecrawling, setIsRecrawling] = useState(false);
  const [recrawlResult, setRecrawlResult] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<{ recipes: Record<string, unknown>[]; name: string } | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; errors: number; skipped: number } | null>(null);
  const [importMode, setImportMode] = useState<"add" | "skip" | "overwrite">("skip");
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleUnitsChange = (u: "imperial" | "metric") => {
    setUnits(u);
    localStorage.setItem("whisk_units", u);
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

  const handleExportBook = async () => {
    setIsExporting(true);
    try {
      const index = await api.get<RecipeIndexEntry[]>("/recipes");
      const recipes: Recipe[] = [];
      for (const entry of index) {
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
    setImportProgress({ done: 0, total: recipes.length, errors: 0, skipped: 0 });
    let errors = 0;
    let skipped = 0;
    for (let i = 0; i < recipes.length; i++) {
      try {
        const resp = await api.post<{ id?: string; skipped?: boolean }>(`/import/book?mode=${importMode}`, recipes[i]);
        if (resp.skipped) skipped++;
      } catch {
        errors++;
      }
      setImportProgress({ done: i + 1, total: recipes.length, errors, skipped });
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
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 pt-[var(--sat)]">
        <div className="flex items-center gap-3 px-4 py-3">
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

        {/* Tab bar */}
        <div className="flex px-4 gap-1 -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={classNames(
                "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-orange-500 text-orange-600 dark:text-orange-400"
                  : "border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* ===== GENERAL TAB ===== */}
        {activeTab === "general" && (
          <>
            {/* Theme */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Theme
              </h2>
              <Card>
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { id: "system" as const, label: "System", IconComp: ComputerDesktop },
                      { id: "light" as const, label: "Light", IconComp: Sun },
                      { id: "dark" as const, label: "Dark", IconComp: Moon },
                      { id: "seasonal" as const, label: "Seasonal", IconComp: CalendarDays },
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          onSetTheme(t.id);
                          if (t.id === "seasonal" && !showAccentPicker) setShowAccentPicker(true);
                        }}
                        className={classNames(
                          "flex flex-col items-center gap-1 py-2.5 px-1 rounded-[var(--wk-radius-btn)] text-xs font-medium border transition-all",
                          theme === t.id ? activeClass : inactiveClass
                        )}
                      >
                        <t.IconComp className="w-5 h-5" />
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Seasonal accent picker */}
                  {theme === "seasonal" && (
                    <div>
                      {(() => {
                        const resolvedAccent = accentOverride === "auto" ? getSeasonalAccent() : accentOverride;
                        const resolvedLabel = ACCENT_OPTIONS.find((o) => o.value === resolvedAccent)?.label ?? resolvedAccent;
                        const displayAccent = accentOverride === "auto" ? resolvedAccent : accentOverride;
                        const displayColors = ACCENT_COLORS[resolvedAccent] ?? [];
                        return (
                          <button
                            onClick={() => setShowAccentPicker(!showAccentPicker)}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--wk-radius-input)] border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm transition-colors hover:border-stone-400 dark:hover:border-stone-500"
                          >
                            <AccentIcon accent={displayAccent} />
                            <div className="flex-1 text-left">
                              <span className="font-medium dark:text-stone-200">
                                {accentOverride === "auto" ? "Auto" : ACCENT_OPTIONS.find((o) => o.value === accentOverride)?.label ?? accentOverride}
                              </span>
                              {accentOverride === "auto" && (
                                <span className="ml-1.5 text-xs text-stone-400 dark:text-stone-500">
                                  Currently {resolvedLabel}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1 mr-1">
                              {displayColors.map((c, i) => (
                                <span key={i} className="w-3 h-3 rounded-full border border-stone-200 dark:border-stone-600" style={{ background: c }} />
                              ))}
                            </div>
                            <ChevronDown className={classNames("w-4 h-4 text-stone-400 transition-transform", showAccentPicker && "rotate-180")} />
                          </button>
                        );
                      })()}

                      {showAccentPicker && (
                        <div className="mt-1.5 relative rounded-[var(--wk-radius-input)] border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 overflow-hidden">
                          <div className="max-h-72 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-700/50">
                            {ACCENT_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => {
                                  onSetAccent(opt.value);
                                  setShowAccentPicker(false);
                                }}
                                className={classNames(
                                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors",
                                  accentOverride === opt.value
                                    ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                    : "text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/50"
                                )}
                              >
                                <AccentIcon accent={opt.value} />
                                <span className="flex-1">{opt.label}</span>
                                <div className="flex gap-1">
                                  {(ACCENT_COLORS[opt.value] ?? []).map((c, i) => (
                                    <span key={i} className="w-2.5 h-2.5 rounded-full border border-stone-200/50 dark:border-stone-600/50" style={{ background: c }} />
                                  ))}
                                </div>
                                {accentOverride === opt.value && <Check className="w-4 h-4 text-orange-500 shrink-0" />}
                              </button>
                            ))}
                          </div>
                          {/* Scroll fade hint */}
                          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white dark:from-stone-800 to-transparent" />
                        </div>
                      )}

                      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                        {accentOverride === "auto"
                          ? `Colors shift automatically with the calendar — currently showing ${ACCENT_OPTIONS.find((o) => o.value === getSeasonalAccent())?.label ?? "seasonal"}`
                          : `Locked to ${ACCENT_OPTIONS.find((o) => o.value === accentOverride)?.label ?? accentOverride} colors`}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </section>

            {/* Design Style */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Design Style
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                {/* Modern */}
                <button
                  onClick={() => onSetStyle("modern")}
                  className={classNames(
                    "relative p-3 border transition-all rounded-xl shadow-sm text-left",
                    style === "modern"
                      ? "border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 ring-1 ring-orange-500/30"
                      : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600"
                  )}
                >
                  <div className="text-sm font-semibold dark:text-stone-200 mb-2">Modern</div>
                  <div className="space-y-1.5">
                    {/* Header: thin bottom border */}
                    <div className="h-2 -mx-3 border-b border-stone-200 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80" />
                    {/* Card: rounded corners, thin border, subtle shadow */}
                    <div className="h-4 rounded-lg bg-stone-100 dark:bg-stone-700 border border-stone-200/50 dark:border-stone-600/50 shadow-[0_1px_2px_rgba(0,0,0,0.05)]" />
                    {/* Pill + text line */}
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-8 rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800" />
                      <div className="h-1.5 flex-1 rounded bg-stone-200 dark:bg-stone-600" />
                    </div>
                  </div>
                  {style === "modern" && <Check className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-orange-500" />}
                </button>

                {/* Editorial */}
                <button
                  onClick={() => onSetStyle("editorial")}
                  className={classNames(
                    "relative p-3 transition-all text-left",
                    style === "editorial"
                      ? "border-t-2 border-t-orange-500 border-b border-l border-r border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/30"
                      : "border-t-2 border-t-stone-800 dark:border-t-stone-300 border-b border-l border-r border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-stone-300"
                  )}
                >
                  <div className="text-sm font-extrabold tracking-tight uppercase dark:text-stone-200 mb-2">Editorial</div>
                  <div className="space-y-1.5">
                    {/* Header: thick bottom border */}
                    <div className="h-2 -mx-3 border-b-2 border-stone-800 dark:border-stone-300 bg-white/80 dark:bg-stone-900/80" />
                    {/* Card: top border only, no rounded corners */}
                    <div className="h-4 border-t-2 border-t-stone-400 dark:border-t-stone-500 bg-stone-50 dark:bg-stone-800" />
                    {/* Sharp pill + text line */}
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-8 rounded-[2px] border-2 border-stone-800 dark:border-stone-300 bg-white dark:bg-stone-800 text-[5px] font-bold uppercase leading-none flex items-center justify-center text-stone-800 dark:text-stone-300">TAG</div>
                      <div className="h-1.5 flex-1 bg-stone-300 dark:bg-stone-600" />
                    </div>
                  </div>
                  {style === "editorial" && <Check className="absolute top-2 right-1.5 w-3.5 h-3.5 text-orange-500" />}
                </button>

                {/* Soft */}
                <button
                  onClick={() => onSetStyle("soft")}
                  className={classNames(
                    "relative p-3 transition-all rounded-2xl border text-left",
                    style === "soft"
                      ? "border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 shadow-lg ring-1 ring-orange-500/20"
                      : "border-transparent bg-white dark:bg-stone-900 shadow-md hover:shadow-lg"
                  )}
                >
                  <div style={{ fontFamily: '"Nunito", system-ui, sans-serif' }} className="text-sm font-semibold dark:text-stone-200 mb-2">Soft</div>
                  <div className="space-y-1.5">
                    {/* Header: no border, soft shadow underneath */}
                    <div className="h-2 -mx-3 bg-white/80 dark:bg-stone-900/80 shadow-[0_2px_8px_rgba(0,0,0,0.05)]" />
                    {/* Card: extra rounded, no border, shadow only */}
                    <div className="h-4 rounded-xl bg-stone-100 dark:bg-stone-700 shadow-[0_2px_8px_rgba(0,0,0,0.06)]" />
                    {/* Rounded font label + pill */}
                    <div className="flex items-center gap-1.5">
                      <div style={{ fontFamily: '"Nunito", system-ui, sans-serif' }} className="h-3 w-8 rounded-full bg-stone-100 dark:bg-stone-700 shadow-[0_1px_3px_rgba(0,0,0,0.06)] text-[5px] font-bold leading-none flex items-center justify-center text-stone-500 dark:text-stone-400">cozy</div>
                      <div className="h-1.5 flex-1 rounded-full bg-stone-200 dark:bg-stone-600" />
                    </div>
                  </div>
                  {style === "soft" && <Check className="absolute top-2 right-2 w-3.5 h-3.5 text-orange-500" />}
                </button>

                {/* Glass — Liquid Glass */}
                <button
                  onClick={() => onSetStyle("glass")}
                  className={classNames(
                    "relative p-3 transition-all rounded-2xl border text-left overflow-hidden",
                    style === "glass"
                      ? "border-orange-500/40 ring-1 ring-orange-500/20"
                      : "border-white/40 dark:border-stone-500/30 hover:border-white/60 dark:hover:border-stone-400/40"
                  )}
                  style={{
                    background: "linear-gradient(168deg, rgba(148,163,184,0.1), rgba(255,255,255,0.28), rgba(255,255,255,0.12), rgba(148,163,184,0.06))",
                    backdropFilter: "blur(20px) saturate(1.5)",
                    WebkitBackdropFilter: "blur(20px) saturate(1.5)",
                    boxShadow: "0 2px 16px rgba(0,0,0,0.04), 0 8px 24px rgba(148,163,184,0.06), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -0.5px 0 rgba(255,255,255,0.1)",
                  }}
                >
                  <div className="text-sm font-medium dark:text-stone-200 mb-2">Liquid Glass</div>
                  <div className="space-y-2">
                    {/* Header: frosted bar with visible bottom edge */}
                    <div className="-mx-3 h-2.5 border-b" style={{ background: "rgba(255,255,255,0.45)", borderColor: "rgba(148,163,184,0.3)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }} />
                    {/* Card: frosted glass with visible borders */}
                    <div className="h-5 rounded-xl" style={{ background: "linear-gradient(168deg, rgba(255,255,255,0.5), rgba(148,163,184,0.15))", border: "1px solid rgba(148,163,184,0.3)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(0,0,0,0.06)" }} />
                    {/* Pill + text line with visible contrast */}
                    <div className="flex items-center gap-1.5">
                      <div className="h-3.5 w-10 rounded-full" style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(148,163,184,0.35)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.6)" }} />
                      <div className="h-1.5 flex-1 rounded-full" style={{ background: "rgba(148,163,184,0.25)" }} />
                    </div>
                  </div>
                  {style === "glass" && <Check className="absolute top-2 right-2 w-3.5 h-3.5 text-orange-500" />}
                </button>
              </div>
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

            {/* Discover Feed */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Discover Feed
              </h2>
              <Card>
                {discoverConfig ? (
                <div className="space-y-4">
                  {/* Sources */}
                  <div>
                    <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                      Sources
                    </label>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                      Recipe sites to browse in your Discover feed. Add any recipe site homepage URL.
                    </p>
                    <div className="space-y-3">
                      {discoverConfig.sources.map((src, idx) => (
                        <div key={src.id} className="flex items-start gap-2">
                          <button
                            onClick={() => {
                              const updated = { ...discoverConfig, sources: discoverConfig.sources.map((s, i) => i === idx ? { ...s, enabled: !s.enabled } : s) };
                              setDiscoverConfig(updated);
                              setDiscoverConfigDirty(true);
                            }}
                            className={`relative w-11 h-6 shrink-0 mt-1 rounded-full transition-colors ${
                              src.enabled ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                                src.enabled ? "translate-x-5" : ""
                              }`}
                            />
                          </button>
                          <div className="flex-1 space-y-1">
                            <input
                              type="text"
                              value={src.label}
                              onChange={(e) => {
                                const updated = { ...discoverConfig, sources: discoverConfig.sources.map((s, i) => i === idx ? { ...s, label: e.target.value } : s) };
                                setDiscoverConfig(updated);
                                setDiscoverConfigDirty(true);
                              }}
                              placeholder="Site name"
                              className="w-full text-sm font-medium px-2 py-1 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-700 dark:text-stone-100"
                            />
                            <input
                              type="url"
                              value={src.url}
                              onChange={(e) => {
                                const updated = { ...discoverConfig, sources: discoverConfig.sources.map((s, i) => i === idx ? { ...s, url: e.target.value } : s) };
                                setDiscoverConfig(updated);
                                setDiscoverConfigDirty(true);
                              }}
                              placeholder="https://example.com/"
                              className="w-full text-xs px-2 py-1 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-700 dark:text-stone-300"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const updated = { ...discoverConfig, sources: discoverConfig.sources.filter((_, i) => i !== idx) };
                              setDiscoverConfig(updated);
                              setDiscoverConfigDirty(true);
                            }}
                            className="p-1 mt-1 text-stone-400 hover:text-red-500"
                            title="Remove source"
                          >
                            <XMark className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {discoverConfig.sources.length < 10 && (
                      <button
                        onClick={() => {
                          const newId = `source-${Date.now()}`;
                          const updated = { ...discoverConfig, sources: [...discoverConfig.sources, { id: newId, label: "", url: "", enabled: true }] };
                          setDiscoverConfig(updated);
                          setDiscoverConfigDirty(true);
                        }}
                        className="mt-3 text-sm text-orange-600 dark:text-orange-400 font-medium"
                      >
                        + Add source
                      </button>
                    )}
                    {discoverConfig.sources.length >= 10 && (
                      <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">Maximum 10 sources</p>
                    )}
                  </div>

                  {/* Auto-refresh toggle + interval */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium dark:text-stone-200">Auto-refresh</span>
                      <button
                        onClick={() => {
                          const updated = { ...discoverConfig, autoRefreshEnabled: !discoverConfig.autoRefreshEnabled };
                          setDiscoverConfig(updated);
                          setDiscoverConfigDirty(true);
                        }}
                        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                          discoverConfig.autoRefreshEnabled !== false ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                            discoverConfig.autoRefreshEnabled !== false ? "translate-x-5" : ""
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                      {discoverConfig.autoRefreshEnabled !== false
                        ? "Discover feed checks for new trending recipes on a schedule."
                        : "Auto-refresh is off. The feed will only update when you manually refresh."}
                    </p>
                    {discoverConfig.autoRefreshEnabled !== false && (
                      <div className="flex gap-2 flex-wrap">
                        {([
                          { value: 1, label: "1 day" },
                          { value: 2, label: "2 days" },
                          { value: 3, label: "3 days" },
                          { value: 7, label: "Weekly" },
                        ] as const).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              const updated = { ...discoverConfig, refreshIntervalDays: opt.value };
                              setDiscoverConfig(updated);
                              setDiscoverConfigDirty(true);
                            }}
                            className={`px-3 py-2 rounded-[var(--wk-radius-btn)] text-sm font-medium border ${
                              discoverConfig.refreshIntervalDays === opt.value ? activeClass : inactiveClass
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expiration toggle + lifetime */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium dark:text-stone-200">Auto-expire recipes</span>
                      <button
                        onClick={() => {
                          const updated = { ...discoverConfig, expirationEnabled: !discoverConfig.expirationEnabled };
                          setDiscoverConfig(updated);
                          setDiscoverConfigDirty(true);
                        }}
                        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                          discoverConfig.expirationEnabled ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                            discoverConfig.expirationEnabled ? "translate-x-5" : ""
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                      {discoverConfig.expirationEnabled
                        ? "Older discover recipes are automatically hidden. Saved recipes are never affected."
                        : "Recipes stay in the feed permanently until manually removed."}
                    </p>
                    {discoverConfig.expirationEnabled && (
                      <div className="space-y-2">
                        <div className="flex gap-2 flex-wrap">
                          {([
                            { value: 3, label: "3 days" },
                            { value: 5, label: "5 days" },
                            { value: 7, label: "1 week" },
                            { value: 14, label: "2 weeks" },
                          ] as const).map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => {
                                const updated = { ...discoverConfig, itemLifetimeDays: opt.value };
                                setDiscoverConfig(updated);
                                setDiscoverConfigDirty(true);
                              }}
                              className={`px-3 py-2 rounded-[var(--wk-radius-btn)] text-sm font-medium border ${
                                discoverConfig.itemLifetimeDays === opt.value ? activeClass : inactiveClass
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div>
                          <p className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">
                            Restore expired recipes
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {([
                              { range: "30", label: "Past month" },
                              { range: "90", label: "Past 3 months" },
                              { range: "365", label: "Past year" },
                              { range: "all", label: "All" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.range}
                                onClick={async () => {
                                  try {
                                    const res = await api.post<{ restored: number }>(`/discover/feed/restore?range=${opt.range}`, {});
                                    if (res && res.restored > 0) {
                                      alert(`Restored ${res.restored} recipe${res.restored === 1 ? "" : "s"}. Refresh your Discover feed to see them.`);
                                    } else {
                                      alert("No expired recipes found in that range.");
                                    }
                                  } catch {
                                    alert("Failed to restore recipes.");
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-[var(--wk-radius-btn)] text-xs font-medium border ${inactiveClass}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Save / Discard buttons */}
                  {discoverConfigDirty && (
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={async () => {
                          setDiscoverConfigSaving(true);
                          setDiscoverConfigError(null);
                          try {
                            // Auto-generate IDs for new sources from label
                            const cleaned = {
                              ...discoverConfig,
                              sources: discoverConfig.sources
                                .filter((s) => s.label.trim() && s.url.trim())
                                .map((s) => ({
                                  ...s,
                                  id: s.id.startsWith("source-") ? s.label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || s.id : s.id,
                                })),
                            };
                            const result = await api.put<DiscoverConfig>("/discover/config", cleaned);
                            if (result) {
                              setDiscoverConfig(result);
                              setDiscoverConfigSnapshot(result);
                              setDiscoverConfigDirty(false);
                              // Clear old localStorage keys (migrated to server config)
                              localStorage.removeItem("whisk_feed_refresh_days");
                              localStorage.removeItem("whisk_feed_item_lifetime");
                              localStorage.removeItem("whisk_discover_sources");
                            }
                          } catch {
                            setDiscoverConfigError("Failed to save");
                          } finally {
                            setDiscoverConfigSaving(false);
                          }
                        }}
                        disabled={discoverConfigSaving}
                        className="text-sm"
                      >
                        {discoverConfigSaving ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button
                        onClick={() => {
                          if (discoverConfigSnapshot) {
                            setDiscoverConfig(discoverConfigSnapshot);
                            setDiscoverConfigDirty(false);
                            setDiscoverConfigError(null);
                          }
                        }}
                        variant="secondary"
                        className="text-sm"
                      >
                        Discard
                      </Button>
                      {discoverConfigError && (
                        <span className="text-xs text-red-500">{discoverConfigError}</span>
                      )}
                    </div>
                  )}
                </div>
                ) : (
                  <p className="text-sm text-stone-400 dark:text-stone-500">Loading...</p>
                )}
              </Card>
            </section>
          </>
        )}

        {/* ===== ACCOUNT TAB ===== */}
        {activeTab === "account" && (
          <>
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Profile
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
                    <div className="grid grid-cols-2 gap-2">
                      {(["breakfast", "lunch", "dinner", "snack", "dessert", "extra"] as const).map((slot) => {
                        const enabled = mealSlots.includes(slot);
                        return (
                          <div key={slot} className="flex items-center justify-between px-3 py-2 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-700">
                            <span className="text-sm dark:text-stone-200 capitalize">{slot}</span>
                            <button
                              onClick={() => {
                                const updated = enabled
                                  ? mealSlots.filter((s) => s !== slot)
                                  : [...mealSlots, slot];
                                if (updated.length === 0) return;
                                setMealSlots(updated);
                                localStorage.setItem("whisk_meal_slots", JSON.stringify(updated));
                              }}
                              className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                                enabled ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                                  enabled ? "translate-x-5" : ""
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>


                </div>
              </Card>
            </section>

            {/* Dietary Preferences */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Dietary Preferences
              </h2>
              <Card>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                      Dietary Restrictions
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Nut-Free", "Keto", "Paleo", "Halal", "Kosher"].map((diet) => {
                        const active = dietaryRestrictions.includes(diet.toLowerCase());
                        return (
                          <button
                            key={diet}
                            onClick={() => {
                              const key = diet.toLowerCase();
                              const updated = active
                                ? dietaryRestrictions.filter((d) => d !== key)
                                : [...dietaryRestrictions, key];
                              setDietaryRestrictions(updated);
                              savePreferences({ dietaryRestrictions: updated });
                            }}
                            className={classNames(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              active ? activeClass : inactiveClass
                            )}
                          >
                            {diet}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                      Favorite Cuisines
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {["Italian", "Mexican", "Asian", "Indian", "Mediterranean", "American", "French", "Japanese", "Thai", "Middle Eastern"].map((cuisine) => {
                        const active = favoriteCuisines.includes(cuisine.toLowerCase());
                        return (
                          <button
                            key={cuisine}
                            onClick={() => {
                              const key = cuisine.toLowerCase();
                              const updated = active
                                ? favoriteCuisines.filter((c) => c !== key)
                                : [...favoriteCuisines, key];
                              setFavoriteCuisines(updated);
                              savePreferences({ favoriteCuisines: updated });
                            }}
                            className={classNames(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              active ? activeClass : inactiveClass
                            )}
                          >
                            {cuisine}
                          </button>
                        );
                      })}
                    </div>
                  </div>


                  <div>
                    <label className="text-sm font-medium text-stone-700 dark:text-stone-300">
                      Disliked Ingredients
                    </label>
                    {dislikedIngredients.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {dislikedIngredients.map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300"
                          >
                            {item}
                            <button
                              onClick={() => {
                                const updated = dislikedIngredients.filter((i) => i !== item);
                                setDislikedIngredients(updated);
                                savePreferences({ dislikedIngredients: updated });
                              }}
                              className="ml-0.5 text-red-400 hover:text-red-600 dark:hover:text-red-200"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2">
                      <input
                        type="text"
                        value={dislikedInput}
                        onChange={(e) => setDislikedInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            const val = dislikedInput.trim().replace(/,/g, "");
                            if (val && !dislikedIngredients.includes(val.toLowerCase())) {
                              const updated = [...dislikedIngredients, val.toLowerCase()];
                              setDislikedIngredients(updated);
                              savePreferences({ dislikedIngredients: updated });
                            }
                            setDislikedInput("");
                          }
                        }}
                        onBlur={() => {
                          const val = dislikedInput.trim().replace(/,/g, "");
                          if (val && !dislikedIngredients.includes(val.toLowerCase())) {
                            const updated = [...dislikedIngredients, val.toLowerCase()];
                            setDislikedIngredients(updated);
                            savePreferences({ dislikedIngredients: updated });
                          }
                          setDislikedInput("");
                        }}
                        placeholder={dislikedIngredients.length > 0 ? "Add more..." : "e.g. cilantro, olives, anchovies"}
                        className="w-full rounded-[var(--wk-radius-input)] border-[length:var(--wk-border-input)] border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                      />
                    </div>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                      Press Enter or comma to add. Used by AI to filter suggestions.
                    </p>
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

            <section className="pt-2">
              <Button variant="secondary" fullWidth onClick={onLogout}>
                Sign Out
              </Button>
            </section>
          </>
        )}

        {/* ===== AI TAB ===== */}
        {activeTab === "ai" && (
          <>
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

            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Browser Rendering
              </h2>
              <Card>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium dark:text-stone-200">
                        Headless Browser Fallback
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                        Loads recipe pages that block direct access
                      </p>
                    </div>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        capabilities.browserRendering
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                      }`}
                    >
                      {capabilities.browserRendering ? "Active" : "Not configured"}
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    {capabilities.browserRendering
                      ? "Whisk can use a headless browser to load recipe pages from sites that block automated access."
                      : "Some recipe sites block direct access. Add CF_ACCOUNT_ID and CF_BR_TOKEN to your environment variables to enable headless browser fallback. See the self-hosting guide for setup instructions."}
                  </p>
                </div>
              </Card>
            </section>

            <AIPerformanceLogs />
          </>
        )}

        {/* ===== DATA TAB ===== */}
        {activeTab === "data" && (
          <>
            {/* Import & Export */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Import & Export
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
                        <div className="space-y-3">
                          <label className="text-xs font-medium text-stone-600 dark:text-stone-300 block">
                            Exclude by category
                          </label>
                          {TAG_GROUP_ORDER.filter((g) => g !== "custom" && g !== "speed").map((group) => {
                            const groupTags = PRESET_TAGS.filter((t) => t.group === group);
                            if (groupTags.length === 0) return null;
                            return (
                              <div key={group}>
                                <p className="text-[10px] uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-1">
                                  {TAG_GROUP_LABELS[group]}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {groupTags.map((tag) => {
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
                                          "wk-pill px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
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
                              </div>
                            );
                          })}
                          {exportExcludeTags.length > 0 && (
                            <p className="text-xs text-red-500 dark:text-red-400">
                              {exportExcludeTags.length} tag{exportExcludeTags.length !== 1 ? "s" : ""} excluded
                              <button
                                onClick={() => setExportExcludeTags([])}
                                className="ml-2 underline hover:text-red-600 dark:hover:text-red-300"
                              >
                                Clear all
                              </button>
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
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportFileChange(file);
                        e.target.value = "";
                      }}
                    />
                    {!importFile ? (
                      <div className="space-y-2">
                        <Button variant="secondary" fullWidth onClick={() => importFileRef.current?.click()}>
                          Import Book
                        </Button>
                        <p className="text-xs text-stone-400 dark:text-stone-500 text-center">
                          Accepts .json files exported from Whisk. If you don't see the file, change the file picker filter to "All Files."
                        </p>
                      </div>
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

                        {/* Import mode selector */}
                        <div>
                          <label className="text-xs font-medium text-stone-600 dark:text-stone-300 block mb-1.5">
                            If a recipe already exists
                          </label>
                          <div className="space-y-1.5">
                            {([
                              { id: "skip" as const, label: "Skip duplicates", desc: "Only import new recipes" },
                              { id: "overwrite" as const, label: "Overwrite matches", desc: "Replace existing recipes with matching titles" },
                              { id: "add" as const, label: "Add all", desc: "Import everything, even if duplicates exist" },
                            ]).map((mode) => (
                              <label
                                key={mode.id}
                                className={classNames(
                                  "flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors",
                                  importMode === mode.id
                                    ? "border-orange-500 bg-orange-50 dark:bg-orange-950"
                                    : "border-stone-200 dark:border-stone-700"
                                )}
                              >
                                <input
                                  type="radio"
                                  name="importMode"
                                  checked={importMode === mode.id}
                                  onChange={() => setImportMode(mode.id)}
                                  className="mt-0.5 accent-orange-500"
                                />
                                <div>
                                  <p className={classNames(
                                    "text-sm font-medium",
                                    importMode === mode.id ? "text-orange-700 dark:text-orange-300" : "dark:text-stone-200"
                                  )}>
                                    {mode.label}
                                  </p>
                                  <p className="text-[11px] text-stone-500 dark:text-stone-400">{mode.desc}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                          {importMode === "overwrite" && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-start gap-1">
                              <span className="shrink-0">&#9888;</span>
                              Existing recipes with matching titles will be permanently replaced. This cannot be undone.
                            </p>
                          )}
                        </div>

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
                                ? (() => {
                                    const imported = importProgress.done - importProgress.errors - importProgress.skipped;
                                    const parts = [`${imported} imported`];
                                    if (importProgress.skipped > 0) parts.push(`${importProgress.skipped} skipped`);
                                    if (importProgress.errors > 0) parts.push(`${importProgress.errors} failed`);
                                    return `Done! ${parts.join(", ")}`;
                                  })()
                                : `Importing ${importProgress.done} of ${importProgress.total}...`}
                            </p>
                            {importProgress.done === importProgress.total && (
                              <Button variant="secondary" fullWidth onClick={() => { setImportFile(null); setImportProgress(null); window.location.reload(); }}>
                                Done
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Button
                            variant={importMode === "overwrite" ? "danger" : "primary"}
                            fullWidth
                            onClick={() => {
                              if (importMode === "overwrite") {
                                if (!window.confirm(`This will overwrite any existing recipes with matching titles. Continue?`)) return;
                              }
                              handleImportBook();
                            }}
                          >
                            Import {importFile.recipes.length} Recipe{importFile.recipes.length !== 1 ? "s" : ""}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </section>

            {/* Recipe Book Maintenance */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Maintenance
              </h2>
              <Card>
                <div className="space-y-3">
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
                      disabled={isRecrawling}
                      onClick={async () => {
                        setIsRecrawling(true);
                        setRecrawlResult(null);
                        try {
                          const data = await api.post<{ updated: number; total: number; remaining: number; errors?: string[] }>("/recipes/recrawl");
                          if (data.updated === 0 && data.total === 0) {
                            setRecrawlResult("All recipes already have local images");
                          } else {
                            let msg = `Updated ${data.updated} of ${data.total} recipe${data.total === 1 ? "" : "s"}`;
                            if (data.remaining > 0) msg += ` (${data.remaining} remaining — run again)`;
                            setRecrawlResult(msg);
                          }
                        } catch {
                          setRecrawlResult("Failed to recrawl recipes");
                        } finally {
                          setIsRecrawling(false);
                        }
                      }}
                    >
                      {isRecrawling ? "Recrawling..." : "Re-fetch Recipe Images"}
                    </Button>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                      Downloads missing recipe images from their original source URLs. Useful after importing a recipe book from another Whisk instance.
                    </p>
                    {recrawlResult && (
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 text-center font-medium">
                        {recrawlResult}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </section>

            {/* Troubleshooting */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Troubleshooting
              </h2>
              <Card>
                <div className="space-y-3">
                  <div>
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
                  <div className="border-t border-stone-200 dark:border-stone-700 pt-3">
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
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5 text-center">
                      Clears cached recipes, settings, and signs you out. Server data is not affected.
                    </p>
                  </div>
                </div>
              </Card>
            </section>
          </>
        )}

        {activeTab === "about" && (
          <>
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                About
              </h2>
              <Card>
                <div className="space-y-2">
                  <p className="text-sm font-medium dark:text-stone-300">Whisk v1.0.0</p>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://github.com/rsmedstad/whisk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--wk-radius-btn)] text-xs font-medium border border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400 hover:border-orange-500 hover:text-orange-600 dark:hover:border-orange-500 dark:hover:text-orange-400 transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      GitHub
                    </a>
                    <a
                      href="https://github.com/rsmedstad/whisk#self-hosting-guide"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      Self-hosting guide
                    </a>
                  </div>
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    Updates apply automatically. Self-hosters: sync your fork on GitHub to pull new features.
                  </p>
                </div>
              </Card>
            </section>

            {/* Support / Donate */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3">
                Support
              </h2>
              <Card>
                <div className="space-y-3">
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    Found Whisk helpful? If you'd like to show your appreciation, consider making a donation to the American Diabetes Association.
                  </p>
                  <a
                    href="https://diabetes.org/ways-to-contribute"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-[var(--wk-radius-btn)] border border-stone-200 dark:border-stone-700 hover:border-orange-400 dark:hover:border-orange-500 transition-colors group"
                  >
                    {/* ADA official "A" logo — cropped from ADA85 SVG */}
                    <svg viewBox="0 0 164 144" className="w-10 h-10 shrink-0" aria-hidden="true">
                      <polygon points="65.2 32.1 82.2 61.8 126.4 139 160.4 139 81.9 3 65.2 32.1" fill="#a6192e" />
                      <polygon points="48 61.1 3.4 139 90.9 139 108.8 108.2 55.1 108.2 81.9 61.1 48 61.1" fill="#a6192e" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-700 dark:text-stone-300 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                        American Diabetes Association
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        diabetes.org
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-stone-400 dark:text-stone-500 group-hover:text-orange-500 transition-colors shrink-0" />
                  </a>
                </div>
              </Card>
            </section>
          </>
        )}

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

// ── AI Performance Logs ─────────────────────────────────────

interface AILogTiming {
  classifyMs: number;
  fetchMs: number;
  configMs: number;
  indexMs: number;
  nytMs: number;
  vectorizeMs: number;
  llmMs?: number;
}

interface AILogEntry {
  timestamp: string;
  provider: string;
  model: string;
  success: boolean;
  durationMs: number;
  error?: string;
  feature?: string;
  // Chat-specific fields
  userMessage?: string;
  systemPromptLength?: number;
  recipeCount?: number;
  vectorizeHits?: number;
  streaming?: boolean;
  responseLength?: number;
  tier?: string;
  // Action marker counts
  recipeCardsEmitted?: number;
  saveRecipesEmitted?: number;
  planActionsEmitted?: number;
  externalRecipesFetched?: number;
  responsePreview?: string;
  // Scan-specific fields
  itemCount?: number;
  photoSizeKB?: number;
  // Timing — shape varies by feature
  timing?: AILogTiming & {
    uploadProcessMs?: number;
    visionMs?: number;
  };
}

function TimingBar({ label, ms, maxMs }: { label: string; ms: number; maxMs: number }) {
  const pct = maxMs > 0 ? Math.min((ms / maxMs) * 100, 100) : 0;
  const color = ms > 500 ? "bg-red-500" : ms > 200 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-right text-stone-500 dark:text-stone-400 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right font-mono text-stone-600 dark:text-stone-300 shrink-0">{ms}ms</span>
    </div>
  );
}

function formatLogForCopy(log: AILogEntry): string {
  const time = new Date(log.timestamp);
  const isImage = IMAGE_FEATURES.has(log.feature ?? "");

  if (isImage) {
    const st = log.timing;
    const featureLabel = log.feature === "scan" ? "LIST SCAN" : log.feature === "recipe-photo" ? "RECIPE PHOTO" : "PHOTO ID";
    const lines = [
      `[${time.toLocaleString()}] ${featureLabel}`,
      `  provider: ${log.provider}/${log.model} | ${log.success ? "ok" : "FAIL"} | ${log.itemCount ?? 0} items | ${log.photoSizeKB ?? "?"}KB photo`,
    ];
    if (st) {
      lines.push(`  timing: config=${st.configMs}ms upload=${st.uploadProcessMs ?? 0}ms vision=${st.visionMs ?? 0}ms total=${log.durationMs}ms`);
    } else {
      lines.push(`  total: ${log.durationMs}ms`);
    }
    if (log.error) lines.push(`  error: ${log.error}`);
    return lines.join("\n");
  }

  const t = log.timing;
  const lines = [
    `[${time.toLocaleString()}] "${log.userMessage ?? ""}"`,
    `  provider: ${log.provider}/${log.model} | tier: ${log.tier ?? "?"} | ${log.streaming ? "stream" : "non-stream"} | ${log.success ? "ok" : "FAIL"}`,
    `  recipes: ${log.recipeCount ?? 0} | vectorize hits: ${log.vectorizeHits ?? 0} | prompt: ${log.systemPromptLength ?? 0}chars (~${Math.round((log.systemPromptLength ?? 0) / 4)}tok)`,
  ];
  // Action marker counts (only show line if any were emitted)
  const hasActions = (log.recipeCardsEmitted ?? 0) > 0 || (log.saveRecipesEmitted ?? 0) > 0 || (log.planActionsEmitted ?? 0) > 0 || (log.externalRecipesFetched ?? 0) > 0;
  if (hasActions) {
    lines.push(`  actions: cards=${log.recipeCardsEmitted ?? 0} external=${log.saveRecipesEmitted ?? 0} plan=${log.planActionsEmitted ?? 0} nyt_fetched=${log.externalRecipesFetched ?? 0}`);
  }
  if (t) {
    lines.push(`  timing: config=${t.configMs}ms index=${t.indexMs}ms vectorize=${t.vectorizeMs}ms nyt=${t.nytMs}ms fetch(total)=${t.fetchMs}ms${t.llmMs !== undefined ? ` llm=${t.llmMs}ms` : ""} total=${log.durationMs}ms`);
  } else {
    lines.push(`  total: ${log.durationMs}ms`);
  }
  if (log.responseLength) lines.push(`  response: ${log.responseLength}chars`);
  if (log.responsePreview) lines.push(`  preview: ${log.responsePreview}`);
  if (log.error) lines.push(`  error: ${log.error}`);
  return lines.join("\n");
}

type AILogTab = "all" | "text" | "image";
const AI_LOG_TABS: { value: AILogTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
];
const IMAGE_FEATURES = new Set(["scan", "recipe-photo", "identify"]);

function AIPerformanceLogs() {
  const [logs, setLogs] = useState<AILogEntry[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [activeTab, setActiveTab] = useState<AILogTab>("all");

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const data = await api.get<AILogEntry[]>("/ai/logs");
      // Auto-prune entries older than 7 days
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const fresh = data.filter((l) => new Date(l.timestamp).getTime() > weekAgo);
      setLogs(fresh);
    } catch {
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !logs) loadLogs();
  };

  const copyToClipboard = (text: string, id: number | "all") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  return (
    <section>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide mb-3"
      >
        <ChevronDown className={classNames("w-3.5 h-3.5 transition-transform", isOpen ? "" : "-rotate-90")} />
        AI Performance
      </button>
      {isOpen && (
        <Card>
          <div className="space-y-3">
            {isLoading && <p className="text-xs text-stone-400">Loading logs...</p>}
            {logs && logs.length === 0 && (
              <p className="text-xs text-stone-400">No AI logs yet. Send a message in the Ask tab to generate data.</p>
            )}
            {logs && logs.length > 0 && (() => {
              const filtered = activeTab === "all" ? logs
                : activeTab === "image" ? logs.filter((l) => IMAGE_FEATURES.has(l.feature ?? ""))
                : logs.filter((l) => !IMAGE_FEATURES.has(l.feature ?? ""));
              const todayStr = new Date().toLocaleDateString();
              const todayCount = filtered.filter((l) => new Date(l.timestamp).toLocaleDateString() === todayStr).length;
              const imageCount = logs.filter((l) => IMAGE_FEATURES.has(l.feature ?? "")).length;
              const textCount = logs.length - imageCount;
              return (
              <>
                {/* Tabs */}
                <div className="flex gap-1 border-b border-stone-200 dark:border-stone-700 mb-2">
                  {AI_LOG_TABS.map((tab) => {
                    const count = tab.value === "all" ? logs.length : tab.value === "image" ? imageCount : textCount;
                    return (
                      <button
                        key={tab.value}
                        onClick={() => setActiveTab(tab.value)}
                        className={classNames(
                          "px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                          activeTab === tab.value
                            ? "border-orange-500 text-orange-600 dark:text-orange-400"
                            : "border-transparent text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300"
                        )}
                      >
                        {tab.label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    {todayCount > 0 ? `${todayCount} today` : "None today"} &middot; {filtered.length} total
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const text = filtered.slice(0, 10).map(formatLogForCopy).join("\n\n");
                        copyToClipboard(text, "all");
                      }}
                      className="text-xs text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      {copied === "all" ? "Copied!" : "Copy All"}
                    </button>
                    <button onClick={loadLogs} className="text-xs text-orange-600 dark:text-orange-400 hover:underline">
                      Refresh
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm("Clear all AI logs?")) return;
                        await api.delete("/ai/logs");
                        setLogs([]);
                      }}
                      className="text-xs text-red-500 dark:text-red-400 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-4">
                  {filtered.slice(0, 10).map((log, i) => {
                    const t = log.timing;
                    const isImageFeature = IMAGE_FEATURES.has(log.feature ?? "");
                    const maxMs = Math.max(log.durationMs, t?.fetchMs ?? 0, t?.llmMs ?? 0, t?.visionMs ?? 0, 500);
                    const time = new Date(log.timestamp);
                    const isToday = time.toLocaleDateString() === new Date().toLocaleDateString();
                    const timeStr = isToday
                      ? time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : `${time.toLocaleDateString([], { month: "short", day: "numeric" })} ${time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
                    return (
                      <div key={i} className="border-b border-stone-100 dark:border-stone-800 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-start justify-between mb-1.5">
                          <p className="text-xs text-stone-600 dark:text-stone-300 font-medium truncate max-w-[70%]">
                            {isImageFeature ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                  {log.feature === "scan" ? "SCAN" : log.feature === "recipe-photo" ? "RECIPE" : "ID"}
                                </span>
                                {log.feature === "scan" ? "List photo scan" : log.feature === "recipe-photo" ? "Recipe photo import" : "Photo identify"}
                              </span>
                            ) : (
                              <>&ldquo;{log.userMessage}&rdquo;</>
                            )}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => copyToClipboard(formatLogForCopy(log), i)}
                              className="text-[10px] text-stone-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                            >
                              {copied === i ? "Copied!" : "Copy"}
                            </button>
                            <span className={classNames(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                              log.success
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            )}>
                              {log.durationMs}ms
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-400 dark:text-stone-500 mb-2">
                          <span>{timeStr}</span>
                          <span>{log.provider}/{log.model}</span>
                          {isImageFeature ? (
                            <>
                              {log.itemCount !== undefined && <span>{log.itemCount} items found</span>}
                              {log.photoSizeKB !== undefined && <span>{log.photoSizeKB}KB photo</span>}
                            </>
                          ) : (
                            <>
                              {log.tier && <span className="uppercase">{log.tier}</span>}
                              {log.streaming && <span>stream</span>}
                              <span>{log.recipeCount ?? 0} recipes</span>
                              {(log.systemPromptLength ?? 0) > 0 && <span>{Math.round((log.systemPromptLength ?? 0) / 4)}tok est.</span>}
                            </>
                          )}
                        </div>
                        {t && !isImageFeature && (
                          <div className="space-y-1">
                            {t.configMs > 0 && <TimingBar label="config" ms={t.configMs} maxMs={maxMs} />}
                            {t.indexMs > 0 && <TimingBar label="index" ms={t.indexMs} maxMs={maxMs} />}
                            {t.vectorizeMs > 0 && <TimingBar label="vector" ms={t.vectorizeMs} maxMs={maxMs} />}
                            {t.nytMs > 0 && <TimingBar label="nyt" ms={t.nytMs} maxMs={maxMs} />}
                            <TimingBar label="fetch" ms={t.fetchMs} maxMs={maxMs} />
                            {t.llmMs !== undefined && <TimingBar label="llm" ms={t.llmMs} maxMs={maxMs} />}
                            <TimingBar label="total" ms={log.durationMs} maxMs={maxMs} />
                          </div>
                        )}
                        {t && isImageFeature && (
                          <div className="space-y-1">
                            {t.configMs > 0 && <TimingBar label="config" ms={t.configMs} maxMs={maxMs} />}
                            {(t.uploadProcessMs ?? 0) > 0 && <TimingBar label="upload" ms={t.uploadProcessMs!} maxMs={maxMs} />}
                            {(t.visionMs ?? 0) > 0 && <TimingBar label="vision" ms={t.visionMs!} maxMs={maxMs} />}
                            <TimingBar label="total" ms={log.durationMs} maxMs={maxMs} />
                          </div>
                        )}
                        {!t && (
                          <p className="text-[10px] text-stone-400 italic">No timing breakdown (older log format)</p>
                        )}
                        {log.error && (
                          <p className="text-[10px] text-red-500 mt-1 truncate">{log.error}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
              );
            })()}
          </div>
        </Card>
      )}
    </section>
  );
}

