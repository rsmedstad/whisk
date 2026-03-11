import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ShoppingList as ShoppingListType, ShoppingCategory, ShoppingItem, RecipeIndexEntry, Ingredient } from "../../types";
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_EMOJI } from "../../lib/categories";
import { abbreviateName, abbreviateUnit } from "../../lib/abbreviate";
import { classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { Check, XMark, ShoppingCart, ArrowUpDown, Tag, Sparkles, Trash, Camera, Filter, SquareCheck, ClipboardList } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { Card } from "../ui/Card";
import { useKeyboard } from "../../hooks/useKeyboard";


type SortMode = "department" | "alphabetical" | "unchecked-first" | "by-store" | "by-recipe";

interface ShoppingListProps {
  list: ShoppingListType;
  isLoading: boolean;
  onAddItem: (name: string) => void;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearChecked: () => void;
  onClearAll: () => void;
  onUpdateItem: (id: string, updates: Partial<Pick<ShoppingItem, "store" | "category" | "name">>) => void;
  onClearCategory: (category: ShoppingCategory) => void;
  onClassifyUncategorized: () => Promise<void>;
  recipeIndex?: RecipeIndexEntry[];
  visionEnabled?: boolean;
  chatEnabled?: boolean;
  plannedRecipeIds?: string[];
  onAddFromPlan?: (ingredients: Ingredient[], recipeId: string) => Promise<{ added: number; skippedDuplicates: number }>;
}

export function ShoppingList({
  list,
  isLoading,
  onAddItem,
  onToggleItem,
  onRemoveItem,
  onClearChecked,
  onClearAll,
  onUpdateItem,
  onClearCategory,
  onClassifyUncategorized,
  recipeIndex = [],
  visionEnabled = false,
  chatEnabled = false,
  plannedRecipeIds = [],
  onAddFromPlan,
}: ShoppingListProps) {
  const navigate = useNavigate();
  const { isKeyboardOpen } = useKeyboard();
  const [newItem, setNewItem] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("department");
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeInput, setStoreInput] = useState("");
  const [isClassifying, setIsClassifying] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  // List scan
  const [isListScanning, setIsListScanning] = useState(false);
  const [listScanResult, setListScanResult] = useState<{ count: number; message?: string } | null>(null);
  const [listScanPreview, setListScanPreview] = useState<string | null>(null);
  const [scanPendingItems, setScanPendingItems] = useState<{ name: string; selected: boolean }[]>([]);
  const [scanSortAZ, setScanSortAZ] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  // Add from plan
  const [planAddStatus, setPlanAddStatus] = useState<string | null>(null);
  const [isPlanAdding, setIsPlanAdding] = useState(false);

  const PANTRY_STAPLES = useMemo(() => new Set([
    "salt", "pepper", "black pepper", "kosher salt", "sea salt", "table salt",
    "salt & pepper", "salt and pepper", "freshly ground black pepper", "ground pepper",
    "olive oil", "vegetable oil", "canola oil", "extra virgin olive oil", "extra-virgin olive oil",
    "cooking spray", "nonstick spray", "oil", "ice",
  ]), []);

  const isPantryStaple = useCallback((name: string): boolean => {
    const lower = name.toLowerCase().trim();
    if (PANTRY_STAPLES.has(lower)) return true;
    if (/^water$/.test(lower) || /^\d+.*\btap water\b/.test(lower) || /^\d+[\s-]*(tbsp|tsp|cup|ml|oz)?\s*water$/i.test(lower)) return true;
    if (lower.includes("&") || lower.includes(" and ") || lower.includes(",")) {
      const parts = lower.split(/[&,]|\band\b/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => PANTRY_STAPLES.has(p))) return true;
    }
    return false;
  }, [PANTRY_STAPLES]);

  const handleAddFromPlan = useCallback(async (includeStaples: boolean) => {
    if (!onAddFromPlan || plannedRecipeIds.length === 0) return;
    setIsPlanAdding(true);
    setPlanAddStatus(null);
    let totalAdded = 0;
    let totalSkipped = 0;

    try {
      for (const recipeId of plannedRecipeIds) {
        const res = await fetch(`/api/recipes/${recipeId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("whisk_token")}` },
        });
        if (!res.ok) continue;
        const fullRecipe = (await res.json()) as { ingredients: Ingredient[] };
        if (!fullRecipe.ingredients?.length) continue;

        const ings = includeStaples
          ? fullRecipe.ingredients
          : fullRecipe.ingredients.filter((i) => !isPantryStaple(i.name));

        const result = await onAddFromPlan(ings, recipeId);
        totalAdded += result.added;
        totalSkipped += result.skippedDuplicates;
      }

      if (totalAdded > 0) {
        setPlanAddStatus(`Added ${totalAdded} item${totalAdded !== 1 ? "s" : ""}${totalSkipped > 0 ? ` (${totalSkipped} already on list)` : ""}`);
      } else if (totalSkipped > 0) {
        setPlanAddStatus("All ingredients already on your list");
      } else {
        setPlanAddStatus("No ingredients to add");
      }
      setTimeout(() => setPlanAddStatus(null), 4000);
    } catch {
      setPlanAddStatus("Failed to add ingredients");
      setTimeout(() => setPlanAddStatus(null), 3000);
    } finally {
      setIsPlanAdding(false);
    }
  }, [onAddFromPlan, plannedRecipeIds, isPantryStaple]);

  // Get unique store names from items
  const storeNames = useMemo(() => {
    const s = new Set<string>();
    for (const item of list.items) {
      if (item.store) s.add(item.store);
    }
    return Array.from(s).sort();
  }, [list.items]);

  // Combine duplicate items by normalized name + unit
  const combinedItems = useMemo(() => {
    const groups = new Map<string, ShoppingItem[]>();
    for (const item of list.items) {
      const normName = abbreviateName(item.name).toLowerCase();
      const normUnit = (item.unit ?? "").toLowerCase().trim();
      const key = `${normName}||${normUnit}`;
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }

    const result: ShoppingItem[] = [];
    for (const [, items] of groups) {
      if (items.length === 1) {
        result.push(items[0]!);
        continue;
      }
      // Try to combine amounts
      const first = items[0]!;
      const allNumeric = items.every((i) => {
        if (!i.amount) return true;
        return !isNaN(parseFloat(i.amount));
      });
      if (allNumeric) {
        let totalAmount = 0;
        let hasAmount = false;
        for (const i of items) {
          if (i.amount) {
            totalAmount += parseFloat(i.amount);
            hasAmount = true;
          }
        }
        // Collect all source recipe IDs for the combined item
        const sourceIds = items.map((i) => i.sourceRecipeId).filter(Boolean);
        const allChecked = items.every((i) => i.checked);
        result.push({
          ...first,
          amount: hasAmount ? (Number.isInteger(totalAmount) ? totalAmount.toString() : totalAmount.toFixed(2).replace(/\.?0+$/, "")) : first.amount,
          checked: allChecked,
          // Store sub-item IDs in a custom field for toggling
          _mergedIds: items.map((i) => i.id),
          _mergedSources: sourceIds.length > 1 ? sourceIds as string[] : undefined,
        } as ShoppingItem & { _mergedIds?: string[]; _mergedSources?: string[] });
      } else {
        // Can't combine non-numeric amounts, keep separate
        result.push(...items);
      }
    }
    return result;
  }, [list.items]);

  // Filter items by store and text query
  const filteredItems = useMemo(() => {
    let items = combinedItems;
    if (storeFilter) items = items.filter((i) => i.store === storeFilter);
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase().trim();
      items = items.filter((i) => i.name.toLowerCase().includes(q));
    }
    return items;
  }, [combinedItems, storeFilter, filterQuery]);

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<ShoppingCategory, ShoppingItem[]>();
    for (const cat of CATEGORY_ORDER) {
      groups.set(cat, []);
    }
    for (const item of filteredItems) {
      const cat = item.category ?? "other";
      const arr = groups.get(cat) ?? [];
      arr.push(item);
      groups.set(cat, arr);
    }
    return groups;
  }, [filteredItems]);

  // Flat sorted list for alphabetical mode
  const sortedFlat = useMemo(() => {
    if (sortMode !== "alphabetical") return null;
    return [...filteredItems].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredItems, sortMode]);

  // Store-grouped list
  const storeGrouped = useMemo(() => {
    if (sortMode !== "by-store") return null;
    const groups = new Map<string, ShoppingItem[]>();
    for (const item of filteredItems) {
      const store = item.store ?? "Unassigned";
      const arr = groups.get(store) ?? [];
      arr.push(item);
      groups.set(store, arr);
    }
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filteredItems, sortMode]);

  // Recipe-grouped list
  const recipeGrouped = useMemo(() => {
    if (sortMode !== "by-recipe") return null;
    const groups = new Map<string, ShoppingItem[]>();
    for (const item of filteredItems) {
      const key = item.sourceRecipeId ?? "__manual__";
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "__manual__") return 1;
      if (b === "__manual__") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filteredItems, sortMode]);

  const recipeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recipeIndex) {
      map.set(r.id, r.title);
    }
    return map;
  }, [recipeIndex]);

  const checkedCount = filteredItems.filter((i) => i.checked).length;
  const totalCount = filteredItems.length;
  const uncategorizedCount = list.items.filter((i) => i.category === "other").length;

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const name = newItem.trim();
    if (!name) return;
    (document.activeElement as HTMLElement | null)?.blur();
    onAddItem(name);
    setNewItem("");
  };

  const handleClassify = useCallback(async () => {
    setIsClassifying(true);
    try {
      await onClassifyUncategorized();
    } finally {
      setIsClassifying(false);
    }
  }, [onClassifyUncategorized]);

  const handleSetStore = (itemId: string) => {
    const trimmed = storeInput.trim();
    onUpdateItem(itemId, { store: trimmed || undefined });
    setEditingStoreId(null);
    setStoreInput("");
  };

  const handleListScan = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Show preview thumbnail during processing
      const previewUrl = URL.createObjectURL(file);
      setListScanPreview(previewUrl);
      setIsListScanning(true);
      setListScanResult(null);
      try {
        // Normalize orientation via canvas (createImageBitmap respects EXIF)
        // and downscale to max 1600px so we don't send huge photos to the AI
        const bitmap = await createImageBitmap(file);
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        const normalizedFile = new File([blob], "scan.jpg", { type: "image/jpeg" });

        const formData = new FormData();
        formData.append("photo", normalizedFile);
        const token = localStorage.getItem("whisk_token");
        const res = await fetch("/api/shopping/scan", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        const data = (await res.json()) as { items?: { name: string }[]; message?: string; error?: string };
        if (!res.ok) {
          setListScanResult({ count: 0, message: data.error ?? data.message ?? `Scan failed (${res.status})` });
          return;
        }
        const items = data.items ?? [];
        const validItems = items.filter((item) => item.name).map((item) => ({ name: item.name, selected: true }));
        if (validItems.length > 0) {
          setScanPendingItems(validItems);
          setListScanResult({ count: validItems.length });
        } else {
          setListScanResult({ count: 0, message: data.message ?? "No items found in the image. Try a clearer photo." });
        }
      } catch {
        setListScanResult({ count: 0, message: "Failed to scan. Check your connection and try again." });
      } finally {
        setIsListScanning(false);
        // Clear preview after a brief delay so user sees result alongside it
        setTimeout(() => {
          setListScanPreview((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }, 3000);
      }
    };
    input.click();
  };

  const renderItem = (item: ShoppingItem & { _mergedIds?: string[]; _mergedSources?: string[] }) => {
    const displayText = abbreviateName(item.name);
    const shortUnit = abbreviateUnit(item.unit);
    const fullLabel = [item.amount, shortUnit, displayText].filter(Boolean).join(" ");
    const mergedIds = item._mergedIds;

    const handleToggle = () => {
      if (mergedIds) {
        for (const id of mergedIds) onToggleItem(id);
      } else {
        onToggleItem(item.id);
      }
    };

    const handleRemove = () => {
      if (mergedIds) {
        for (const id of mergedIds) onRemoveItem(id);
      } else {
        onRemoveItem(item.id);
      }
    };

    return (
      <li
        key={item.id}
        className="flex items-center gap-2 py-1.5 group"
      >
        {/* Tappable row: checkbox + label — full row toggles checked state */}
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 flex-1 min-w-0 py-0.5 text-left"
        >
          <span
            className={classNames(
              "h-5 w-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
              item.checked
                ? "bg-orange-500 border-orange-500 text-white"
                : "border-stone-300 dark:border-stone-600"
            )}
          >
            {item.checked && <Check className="w-3 h-3" />}
          </span>
          <span
            className={classNames(
              "flex-1 text-sm line-clamp-1",
              item.checked
                ? "line-through text-stone-400 dark:text-stone-500"
                : "dark:text-stone-200"
            )}
            title={[item.amount, item.unit, item.name].filter(Boolean).join(" ")}
          >
            {fullLabel}
            {item._mergedSources && item._mergedSources.length > 1 ? (
              <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">
                ({item._mergedSources.map((id) => recipeNames.get(id) ?? "?").filter((v, i, a) => a.indexOf(v) === i).join(", ")})
              </span>
            ) : (item.sourceRecipeId || item.addedByUser) && (
              <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">
                {item.sourceRecipeId && recipeNames.get(item.sourceRecipeId)
                  ? `(${recipeNames.get(item.sourceRecipeId)})`
                  : item.addedByUser
                    ? `(${item.addedByUser})`
                    : null}
              </span>
            )}
          </span>
        </button>

        {/* Store tag */}
        {editingStoreId === item.id ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleSetStore(item.id); }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              type="text"
              value={storeInput}
              onChange={(e) => setStoreInput(e.target.value)}
              onBlur={() => handleSetStore(item.id)}
              placeholder="Store"
              list="store-suggestions"
              className="w-20 px-1.5 py-0.5 text-xs rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 dark:text-stone-200 focus:border-orange-500 focus:outline-none"
            />
          </form>
        ) : item.store ? (
          <button
            onClick={() => { setEditingStoreId(item.id); setStoreInput(item.store ?? ""); }}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 whitespace-nowrap"
            title={`Store: ${item.store}`}
          >
            {item.store}
          </button>
        ) : (
          <button
            onClick={() => { setEditingStoreId(item.id); setStoreInput(""); }}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-stone-400 dark:text-stone-500 px-1 transition-opacity"
            title="Add store"
          >
            <Tag className="w-3 h-3" />
          </button>
        )}

        {/* Delete */}
        <button
          onClick={handleRemove}
          className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-500 px-0.5 transition-opacity"
        >
          <XMark className="w-4 h-4" />
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Store suggestions datalist (shared) */}
      <datalist id="store-suggestions">
        {storeNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)] wk-header-decor relative">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <SeasonalBrandIcon />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">List</h1>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setFilterOpen((prev) => {
                  if (prev) setFilterQuery("");
                  return !prev;
                });
              }}
              className={classNames(
                "p-2 transition-colors",
                filterOpen
                  ? "text-orange-500"
                  : "text-stone-500 dark:text-stone-400 hover:text-orange-500"
              )}
              title="Filter list"
            >
              <Filter className="w-5 h-5" />
            </button>
            {visionEnabled && (
              <button
                onClick={handleListScan}
                disabled={isListScanning}
                className="p-2 text-stone-500 dark:text-stone-400 hover:text-orange-500 transition-colors"
                title="Scan a handwritten list"
              >
                {isListScanning ? (
                  <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" />
                )}
              </button>
            )}
          </div>
        </div>
        {/* Filter input */}
        {filterOpen && (
          <div className="px-4 py-2 border-t border-stone-100 dark:border-stone-800">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter items..."
                autoFocus
                className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-8 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              />
              {filterQuery && (
                <button onClick={() => setFilterQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
                  <XMark className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter bar — sort, clear checked, clear all, auto-classify */}
        {totalCount > 0 && (
          <div className={classNames("flex items-center gap-1.5 px-4 pb-2 pt-1", showSortMenu ? "overflow-visible" : "overflow-x-auto no-scrollbar")}>
            {/* Sort: group mode dropdown + quick toggle pills */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className={classNames(
                  "inline-flex items-center justify-center rounded-full border p-1 transition-colors",
                  sortMode === "by-store" || sortMode === "by-recipe"
                    ? "border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30"
                    : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
                )}
                title="Sort by group"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
              {showSortMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                  <div className="absolute left-0 top-8 z-50 w-44 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden">
                    {([
                      { value: "department" as SortMode, label: "By department" },
                      { value: "by-store" as SortMode, label: "By store" },
                      { value: "by-recipe" as SortMode, label: "By recipe" },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { setSortMode(opt.value); setShowSortMenu(false); }}
                        className={classNames(
                          "w-full px-3 py-2 text-left text-xs",
                          (sortMode === opt.value || (opt.value === "department" && (sortMode === "department" || sortMode === "unchecked-first")))
                            ? "text-orange-600 dark:text-orange-400 font-medium bg-orange-50 dark:bg-orange-950/30"
                            : "dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setSortMode(sortMode === "unchecked-first" ? "department" : "unchecked-first")}
              className={classNames(
                "inline-flex items-center justify-center rounded-full border p-1 transition-colors",
                sortMode === "unchecked-first"
                  ? "border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30"
                  : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
              )}
              title="Unchecked first"
            >
              <SquareCheck className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSortMode(sortMode === "alphabetical" ? "department" : "alphabetical")}
              className={classNames(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
                sortMode === "alphabetical"
                  ? "border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30"
                  : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
              )}
              title="Sort A-Z"
            >
              A-Z
            </button>
            {checkedCount > 0 && (
              <button
                onClick={onClearChecked}
                className="inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-600 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-400 whitespace-nowrap hover:border-orange-300 hover:text-orange-600 transition-colors"
              >
                <Check className="w-3 h-3" /> Clear checked ({checkedCount})
              </button>
            )}
            {uncategorizedCount > 0 && chatEnabled && (
              <button
                onClick={handleClassify}
                disabled={isClassifying}
                className="inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-600 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-400 whitespace-nowrap hover:border-orange-300 hover:text-orange-600 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3 text-orange-500" /> {isClassifying ? "..." : `Classify (${uncategorizedCount})`}
              </button>
            )}
            <button
              onClick={() => { if (confirm("Clear entire shopping list?")) onClearAll(); }}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-600 px-2.5 py-0.5 text-xs font-medium text-red-500 dark:text-red-400 whitespace-nowrap hover:border-red-300 transition-colors"
            >
              <Trash className="w-3 h-3" /> Clear all
            </button>
          </div>
        )}
      </div>

      {/* ═══ LIST CONTENT ═══ */}
      <>
          {/* Scan results / preview */}
          {(listScanPreview || (listScanResult && !isListScanning) || (scanPendingItems.length > 0 && !isListScanning)) && (
            <div className="px-4 pt-3">
              <Card>
                {listScanPreview && (
                  <div className="relative rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden mb-2">
                    <img
                      src={listScanPreview}
                      alt="Scanned list"
                      className={classNames(
                        "w-full max-h-32 object-cover transition-opacity",
                        !isListScanning && "opacity-60"
                      )}
                    />
                    <button
                      onClick={() => {
                        setListScanPreview((prev) => {
                          if (prev) URL.revokeObjectURL(prev);
                          return null;
                        });
                        if (!isListScanning) {
                          setListScanResult(null);
                          setScanPendingItems([]);
                          setScanSortAZ(false);
                        }
                      }}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/50 text-white p-1 hover:bg-black/70 transition-colors"
                      title="Close preview"
                    >
                      <XMark className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {isListScanning && (
                  <p className="text-xs text-orange-500 animate-pulse">
                    Reading your list...
                  </p>
                )}
                {listScanResult && !isListScanning && scanPendingItems.length === 0 && (
                  <div className={classNames(
                    "px-3 py-2 rounded-lg text-xs",
                    listScanResult.count > 0
                      ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                      : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                  )}>
                    {listScanResult.count > 0
                      ? `Added ${listScanResult.count} item${listScanResult.count !== 1 ? "s" : ""} to your list`
                      : listScanResult.message}
                  </div>
                )}
                {/* Pending scan items review */}
                {scanPendingItems.length > 0 && !isListScanning && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                        {scanPendingItems.filter((i) => i.selected).length} of {scanPendingItems.length} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setScanSortAZ((v) => !v)}
                          className={classNames(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors",
                            scanSortAZ ? "text-orange-600 dark:text-orange-400" : "text-stone-400 dark:text-stone-500"
                          )}
                        >
                          A-Z
                        </button>
                        <button
                          onClick={() => setScanPendingItems([])}
                          className="text-[10px] font-medium text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {(scanSortAZ ? [...scanPendingItems].sort((a, b) => a.name.localeCompare(b.name)) : scanPendingItems).map((item, idx) => {
                        const realIdx = scanSortAZ ? scanPendingItems.indexOf(item) : idx;
                        return (
                          <li key={idx} className="flex items-center gap-2">
                            <button
                              onClick={() => setScanPendingItems((prev) => prev.map((p, i) => i === realIdx ? { ...p, selected: !p.selected } : p))}
                              className={classNames(
                                "h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors",
                                item.selected ? "bg-orange-500 border-orange-500 text-white" : "border-stone-300 dark:border-stone-600"
                              )}
                            >
                              {item.selected && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <span className={classNames("text-sm", !item.selected && "text-stone-400 line-through")}>{item.name}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => {
                          const selected = scanPendingItems.filter((i) => i.selected);
                          for (const item of selected) onAddItem(item.name);
                          setListScanResult({ count: selected.length });
                          setScanPendingItems([]);
                          setScanSortAZ(false);
                        }}
                        disabled={scanPendingItems.every((i) => !i.selected)}
                        className="flex-1 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-medium disabled:opacity-50"
                      >
                        Add {scanPendingItems.filter((i) => i.selected).length} items
                      </button>
                      <button
                        onClick={() => { setScanPendingItems([]); setListScanResult(null); setScanSortAZ(false); }}
                        className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-600 text-xs font-medium text-stone-600 dark:text-stone-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Store filter pills — near the list */}
          {storeNames.length > 0 && (
            <div className="flex gap-1.5 px-4 pt-2 pb-1 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setStoreFilter(null)}
                className={classNames(
                  "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                  !storeFilter
                    ? "bg-orange-500 text-white border-orange-500"
                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                All
              </button>
              {storeNames.map((store) => (
                <button
                  key={store}
                  onClick={() => setStoreFilter(storeFilter === store ? null : store)}
                  className={classNames(
                    "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                    storeFilter === store
                      ? "bg-orange-500 text-white border-orange-500"
                      : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {store}
                </button>
              ))}
            </div>
          )}

          {/* Add from Plan bar — shown when there are planned meals with linked recipes */}
          {totalCount > 0 && plannedRecipeIds.length > 0 && onAddFromPlan && (
            <div className="mx-4 mt-2 flex items-center justify-between rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <ClipboardList className="w-3.5 h-3.5" />
                <span>{plannedRecipeIds.length} planned recipe{plannedRecipeIds.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-3">
                {planAddStatus ? (
                  <span className="text-xs text-stone-500 dark:text-stone-400">{planAddStatus}</span>
                ) : (
                  <>
                    <button
                      onClick={() => handleAddFromPlan(false)}
                      disabled={isPlanAdding}
                      className="text-xs font-medium text-orange-600 dark:text-orange-400 active:opacity-70 disabled:opacity-50"
                    >
                      {isPlanAdding ? "Adding..." : "Add Essentials from Plan"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
            {totalCount === 0 ? (
              <EmptyState
                icon={<ShoppingCart className="w-12 h-12" />}
                title={storeFilter ? `No items for ${storeFilter}` : "List is empty"}
                description={storeFilter ? "Clear the filter to see all items" : "Add items below or from a recipe"}
                action={!storeFilter && plannedRecipeIds.length > 0 && onAddFromPlan ? (
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={() => handleAddFromPlan(false)}
                      disabled={isPlanAdding}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium active:scale-95 transition-transform disabled:opacity-50"
                    >
                      <ClipboardList className="w-4 h-4" />
                      {isPlanAdding ? "Adding..." : `Add Essentials from Plan`}
                    </button>
                    <button
                      onClick={() => handleAddFromPlan(true)}
                      disabled={isPlanAdding}
                      className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                    >
                      Include pantry staples
                    </button>
                    {planAddStatus && (
                      <p className="text-xs text-stone-500 dark:text-stone-400">{planAddStatus}</p>
                    )}
                  </div>
                ) : undefined}
              />
            ) : sortMode === "by-store" && storeGrouped ? (
              <div className="space-y-4">
                {storeGrouped.map(([store, items]) => {
                  const sorted = [...items].sort((a, b) => {
                    if (a.checked !== b.checked) return a.checked ? 1 : -1;
                    return a.name.localeCompare(b.name);
                  });
                  const storeChecked = items.filter((i) => i.checked).length;
                  return (
                    <section key={store}>
                      <div className="flex items-center justify-between mb-1.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-orange-300/50 flex items-center gap-1.5">
                          {store}
                          <span className="font-normal text-stone-300 dark:text-stone-600">
                            ({items.length})
                          </span>
                        </h3>
                        {storeChecked > 0 && storeChecked < items.length && (
                          <span className="text-[10px] text-stone-400 dark:text-stone-500">
                            {storeChecked}/{items.length}
                          </span>
                        )}
                      </div>
                      <ul className="space-y-1">
                        {sorted.map(renderItem)}
                      </ul>
                    </section>
                  );
                })}
                <div className="border-t border-stone-200 dark:border-stone-800 pt-3 text-sm text-stone-400 dark:text-stone-500 text-center">
                  {totalCount} item{totalCount !== 1 ? "s" : ""}
                  {checkedCount > 0 && ` \u00B7 ${checkedCount} checked`}
                </div>
              </div>
            ) : sortMode === "by-recipe" && recipeGrouped ? (
              <div className="space-y-4">
                {recipeGrouped.map(([recipeId, items]) => {
                  const sorted = [...items].sort((a, b) => {
                    if (a.checked !== b.checked) return a.checked ? 1 : -1;
                    return a.name.localeCompare(b.name);
                  });
                  const groupChecked = items.filter((i) => i.checked).length;
                  const groupLabel = recipeId === "__manual__"
                    ? "Manual / Other"
                    : recipeNames.get(recipeId) ?? "Unknown Recipe";
                  return (
                    <section key={recipeId}>
                      <div className="flex items-center justify-between mb-1.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-orange-300/50 flex items-center gap-1.5">
                          {groupLabel}
                          <span className="font-normal text-stone-300 dark:text-stone-600">
                            ({items.length})
                          </span>
                        </h3>
                        {groupChecked > 0 && groupChecked < items.length && (
                          <span className="text-[10px] text-stone-400 dark:text-stone-500">
                            {groupChecked}/{items.length}
                          </span>
                        )}
                      </div>
                      <ul className="space-y-1">
                        {sorted.map(renderItem)}
                      </ul>
                    </section>
                  );
                })}
                <div className="border-t border-stone-200 dark:border-stone-800 pt-3 text-sm text-stone-400 dark:text-stone-500 text-center">
                  {totalCount} item{totalCount !== 1 ? "s" : ""}
                  {checkedCount > 0 && ` \u00B7 ${checkedCount} checked`}
                </div>
              </div>
            ) : sortMode === "alphabetical" && sortedFlat ? (
              <div>
                <ul className="space-y-1">
                  {sortedFlat.map(renderItem)}
                </ul>
                <div className="border-t border-stone-200 dark:border-stone-800 pt-3 mt-4 text-sm text-stone-400 dark:text-stone-500 text-center">
                  {totalCount} item{totalCount !== 1 ? "s" : ""}
                  {checkedCount > 0 && ` \u00B7 ${checkedCount} checked`}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {CATEGORY_ORDER.map((cat) => {
                  const items = grouped.get(cat) ?? [];
                  if (items.length === 0) return null;

                  const sorted = [...items].sort((a, b) => {
                    if (a.checked !== b.checked) return a.checked ? 1 : -1;
                    if (sortMode === "unchecked-first") return 0;
                    return a.name.localeCompare(b.name);
                  });

                  const catChecked = items.filter((i) => i.checked).length;

                  return (
                    <section key={cat}>
                      <div className="flex items-center justify-between mb-1.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-orange-300/50 flex items-center gap-1.5">
                          <span>{CATEGORY_EMOJI[cat]}</span>
                          {CATEGORY_LABELS[cat]}
                          <span className="font-normal text-stone-300 dark:text-stone-600">
                            ({items.length})
                          </span>
                        </h3>
                        <div className="flex items-center gap-2">
                          {catChecked > 0 && catChecked < items.length && (
                            <span className="text-[10px] text-stone-400 dark:text-stone-500">
                              {catChecked}/{items.length}
                            </span>
                          )}
                          <button
                            onClick={() => onClearCategory(cat)}
                            className="text-[10px] font-medium text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                            title={`Clear all ${CATEGORY_LABELS[cat]}`}
                          >
                            clear category
                          </button>
                        </div>
                      </div>
                      <ul className="space-y-1">
                        {sorted.map(renderItem)}
                      </ul>
                    </section>
                  );
                })}

                <div className="border-t border-stone-200 dark:border-stone-800 pt-3 text-sm text-stone-400 dark:text-stone-500 text-center">
                  {totalCount} item{totalCount !== 1 ? "s" : ""}
                  {checkedCount > 0 && ` \u00B7 ${checkedCount} checked`}
                  {storeFilter && ` \u00B7 filtered by ${storeFilter}`}
                </div>
              </div>
            )}
          </div>
        </>

      {/* Sticky add-item bar at bottom */}
      <div className={classNames(
        "sticky left-0 right-0 bg-white dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800 px-4 py-3",
        isKeyboardOpen ? "bottom-0 pb-1" : "bottom-[calc(3.5rem+var(--sab))] pb-3"
      )}>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            enterKeyHint="done"
            placeholder="+ Add item..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
          />
          <button
            type="submit"
            disabled={!newItem.trim()}
            className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
