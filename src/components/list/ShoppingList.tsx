import { useState, useMemo, useCallback, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ShoppingList as ShoppingListType, ShoppingCategory, ShoppingItem, RecipeIndexEntry, Receipt, SpendingSummary, Deal, Store } from "../../types";
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_EMOJI } from "../../lib/categories";
import { abbreviateName, abbreviateUnit } from "../../lib/abbreviate";
import { classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { EllipsisVertical, Check, XMark, ShoppingCart, ArrowUpDown, Tag, Sparkles, Trash, Camera, ChevronDown } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

type SortMode = "department" | "alphabetical" | "unchecked-first" | "by-store" | "by-recipe";
type SubTab = "list" | "sales" | "receipts";

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
  // Receipt / spending props
  currentWeekSpending?: SpendingSummary | null;
  spendingTrend?: { amount: number; direction: "up" | "down" | "flat" } | null;
  onScanReceipt?: (photo: File) => Promise<Receipt | null>;
  isScanning?: boolean;
  scanError?: string | null;
  lastScannedReceipt?: Receipt | null;
  onClearScanError?: () => void;
  onClearLastScanned?: () => void;
  // Deal props
  dealMatches?: Map<string, Deal[]>;
  bestStore?: { storeId: string; storeName: string; matchCount: number; estimatedSavings: number } | null;
  deals?: Deal[];
  stores?: Store[];
  isRefreshingDeals?: boolean;
  onRefreshDeals?: () => void;
  receipts?: { id: string; date: string; store?: string; total?: number }[];
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
  currentWeekSpending,
  spendingTrend,
  onScanReceipt,
  isScanning = false,
  scanError,
  lastScannedReceipt,
  onClearScanError,
  onClearLastScanned,
  dealMatches,
  bestStore,
  deals = [],
  stores = [],
  isRefreshingDeals = false,
  onRefreshDeals,
  receipts = [],
}: ShoppingListProps) {
  const navigate = useNavigate();
  const [subTab, setSubTab] = useState<SubTab>("list");
  const [newItem, setNewItem] = useState("");
  const [showOverflow, setShowOverflow] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("department");
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeInput, setStoreInput] = useState("");
  const [isClassifying, setIsClassifying] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showSpendingDetail, setShowSpendingDetail] = useState(false);
  // List scan
  const [showListScan, setShowListScan] = useState(false);
  const [isListScanning, setIsListScanning] = useState(false);
  // Sales tab
  const [dealCategoryFilter, setDealCategoryFilter] = useState<string | null>(null);
  const [dealStoreFilter, setDealStoreFilter] = useState<string | null>(null);
  // Sales scanner
  const [showSalesScanner, setShowSalesScanner] = useState(false);
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);
  const flyerInputRef = useRef<HTMLInputElement>(null);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [dealUrl, setDealUrl] = useState("");
  const [isScanningDeals, setIsScanningDeals] = useState(false);
  const [scannedDeals, setScannedDeals] = useState<{ item: string; price: string; originalPrice?: string | null; unit?: string | null; category: string; notes?: string | null }[]>([]);
  const [scannedDealsMeta, setScannedDealsMeta] = useState<{ storeName?: string | null; validDates?: string | null } | null>(null);
  const [scannedDealsMessage, setScannedDealsMessage] = useState<string | null>(null);
  const [scannedPageCount, setScannedPageCount] = useState(0);

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

  // Filter items by store
  const filteredItems = useMemo(() => {
    if (!storeFilter) return combinedItems;
    return combinedItems.filter((i) => i.store === storeFilter);
  }, [combinedItems, storeFilter]);

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

  // Deals filtering
  const dealCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const d of deals) {
      if (d.category) cats.add(d.category);
    }
    return Array.from(cats).sort();
  }, [deals]);

  const dealStoreNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of deals) {
      names.add(d.storeName);
    }
    return Array.from(names).sort();
  }, [deals]);

  // Deals grouped by store for store cards
  const dealsByStore = useMemo(() => {
    const groups = new Map<string, Deal[]>();
    for (const d of deals) {
      const arr = groups.get(d.storeName) ?? [];
      arr.push(d);
      groups.set(d.storeName, arr);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [deals]);

  const filteredDeals = useMemo(() => {
    let result = deals;
    if (dealCategoryFilter) {
      result = result.filter((d) => d.category === dealCategoryFilter);
    }
    if (dealStoreFilter) {
      result = result.filter((d) => d.storeName === dealStoreFilter);
    }
    return result;
  }, [deals, dealCategoryFilter, dealStoreFilter]);

  // Items on the shopping list that have deal matches, grouped by item
  const listDealMatches = useMemo(() => {
    if (!dealMatches || dealMatches.size === 0) return [];
    const unchecked = list.items.filter((i) => !i.checked);
    const results: { item: ShoppingItem; deals: Deal[] }[] = [];
    for (const item of unchecked) {
      const matched = dealMatches.get(item.id);
      if (matched && matched.length > 0) {
        results.push({ item, deals: matched });
      }
    }
    return results;
  }, [list.items, dealMatches]);

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
    input.capture = "environment";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setIsListScanning(true);
      try {
        const formData = new FormData();
        formData.append("photo", file);
        const token = localStorage.getItem("whisk_token");
        const res = await fetch("/api/shopping/scan", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (res.ok) {
          const data = (await res.json()) as { items?: { name: string }[] };
          if (data.items) {
            for (const item of data.items) {
              if (item.name) onAddItem(item.name);
            }
          }
        }
      } catch {
        // Silently fail
      } finally {
        setIsListScanning(false);
      }
    };
    input.click();
  };

  const handleReceiptScan = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !onScanReceipt) return;
      await onScanReceipt(file);
    };
    input.click();
  };

  // Sales scanner handlers
  const handleFlyerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerPreview(URL.createObjectURL(file));
    setDealUrl("");
  };

  const handleScanDeals = async () => {
    const hasPhoto = flyerInputRef.current?.files?.[0];
    const hasUrl = dealUrl.trim();
    if (!hasPhoto && !hasUrl) return;

    setIsScanningDeals(true);
    try {
      const formData = new FormData();
      if (hasPhoto) {
        formData.append("photo", flyerInputRef.current!.files![0]!);
      } else {
        formData.append("url", hasUrl);
      }

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/discover/scan-deals", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Scan failed");
      const data = (await res.json()) as { deals: typeof scannedDeals; storeName?: string | null; validDates?: string | null; message?: string };

      setScannedDeals((prev) => [...prev, ...data.deals]);
      if (data.storeName || data.validDates) {
        setScannedDealsMeta((prev) => prev ?? { storeName: data.storeName, validDates: data.validDates });
      }
      if (data.deals.length === 0 && data.message) {
        setScannedDealsMessage(data.message);
      } else {
        setScannedDealsMessage(null);
      }
      setScannedPageCount((n) => n + 1);

      setFlyerPreview(null);
      setDealUrl("");
      if (flyerInputRef.current) flyerInputRef.current.value = "";
    } catch {
      setScannedDealsMessage("Failed to scan. Try a clearer image or different URL.");
    } finally {
      setIsScanningDeals(false);
    }
  };

  const handleResetScannedDeals = () => {
    setScannedDeals([]);
    setScannedDealsMeta(null);
    setScannedDealsMessage(null);
    setScannedPageCount(0);
    setFlyerPreview(null);
    setDealUrl("");
    if (flyerInputRef.current) flyerInputRef.current.value = "";
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
        {/* Checkbox */}
        <button
          onClick={handleToggle}
          className={classNames(
            "h-5 w-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
            item.checked
              ? "bg-orange-500 border-orange-500 text-white"
              : "border-stone-300 dark:border-stone-600"
          )}
        >
          {item.checked && <Check className="w-3 h-3" />}
        </button>

        {/* Item text */}
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

        {/* Deal badge — from dealMatches prop or inline dealMatch */}
        {(() => {
          const matches = dealMatches?.get(item.id);
          const best = matches?.[0];
          if (best) {
            return (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">
                ${best.price.toFixed(2)} @ {best.storeName}
              </span>
            );
          }
          if (item.dealMatch) {
            return (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">
                ${item.dealMatch.salePrice.toFixed(2)} @ {item.dealMatch.storeName}
              </span>
            );
          }
          return null;
        })()}

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

  const hasScannedDealInput = flyerPreview || dealUrl.trim();

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
          {subTab === "list" && (
            <div className="flex items-center gap-1">
              {/* Sort button */}
              <div className="relative">
                <button
                  onClick={() => setShowSortMenu(!showSortMenu)}
                  className={classNames(
                    "p-2 rounded-lg transition-colors",
                    sortMode !== "department"
                      ? "text-orange-500"
                      : "text-stone-500 dark:text-stone-400"
                  )}
                  title="Sort"
                >
                  <ArrowUpDown className="w-5 h-5" />
                </button>
                {showSortMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                    <div className="absolute right-0 top-10 z-50 w-48 wk-dropdown rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden">
                      {([
                        { value: "department" as SortMode, label: "By department" },
                        { value: "by-store" as SortMode, label: "By store" },
                        { value: "by-recipe" as SortMode, label: "By recipe" },
                        { value: "alphabetical" as SortMode, label: "A-Z" },
                        { value: "unchecked-first" as SortMode, label: "Unchecked first" },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setSortMode(opt.value); setShowSortMenu(false); }}
                          className={classNames(
                            "w-full px-4 py-2.5 text-left text-sm",
                            sortMode === opt.value
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

              {/* Overflow menu */}
              <div className="relative">
                <button
                  onClick={() => setShowOverflow(!showOverflow)}
                  className="p-2 text-stone-500 dark:text-stone-400"
                >
                  <EllipsisVertical className="w-5 h-5" />
                </button>
                {showOverflow && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                    <div className="absolute right-0 top-10 z-50 w-52 wk-dropdown rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden">
                      {checkedCount > 0 && (
                        <button
                          onClick={() => { onClearChecked(); setShowOverflow(false); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700 flex items-center gap-2"
                        >
                          <Check className="w-4 h-4 text-stone-400" />
                          Clear checked ({checkedCount})
                        </button>
                      )}
                      {uncategorizedCount > 0 && (
                        <button
                          onClick={() => { handleClassify(); setShowOverflow(false); }}
                          disabled={isClassifying}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700 flex items-center gap-2"
                        >
                          <Sparkles className="w-4 h-4 text-orange-500" />
                          {isClassifying ? "Classifying..." : `Auto-classify (${uncategorizedCount})`}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm("Clear entire shopping list?")) {
                            onClearAll();
                          }
                          setShowOverflow(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-stone-700 flex items-center gap-2"
                      >
                        <Trash className="w-4 h-4" />
                        Clear all
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sub-tabs — inspired by recipe detail ingredients/steps tabs */}
        <div className="flex border-b border-stone-200 dark:border-stone-700 -mx-4 px-4">
          {([
            { key: "list" as const, label: "List", count: totalCount },
            { key: "sales" as const, label: "Sales", count: deals.length },
            { key: "receipts" as const, label: "Receipts", count: receipts.length },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSubTab(tab.key)}
              className={classNames(
                "flex-1 py-2.5 text-sm font-semibold text-center transition-colors relative",
                subTab === tab.key
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-stone-500 dark:text-stone-400"
              )}
            >
              {tab.label}{tab.count > 0 ? ` (${tab.count})` : ""}
              {subTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ LIST TAB ═══ */}
      {subTab === "list" && (
        <>
          {/* Deals callout banner — surfaces sales info on main list tab */}
          {listDealMatches.length > 0 && (
            <div className="px-4 pt-3">
              <button
                onClick={() => setSubTab("sales")}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 transition-colors hover:bg-green-100 dark:hover:bg-green-900/30"
              >
                <Tag className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-green-800 dark:text-green-300">
                    {listDealMatches.length} item{listDealMatches.length !== 1 ? "s" : ""} on sale
                    {bestStore && bestStore.matchCount >= 2 && (
                      <span className="font-normal text-green-700 dark:text-green-400">
                        {" "}— best at {bestStore.storeName}
                        {bestStore.estimatedSavings > 0 && ` (~$${bestStore.estimatedSavings.toFixed(2)} savings)`}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-green-600 dark:text-green-500 mt-0.5">
                    {listDealMatches.slice(0, 3).map(m => m.item.name).join(", ")}
                    {listDealMatches.length > 3 && ` +${listDealMatches.length - 3} more`}
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-green-500 -rotate-90 shrink-0" />
              </button>
            </div>
          )}

          {/* Scan list camera — collapsible at top */}
          {visionEnabled && (
            <div className="px-4 pt-3">
              <button
                onClick={() => setShowListScan(!showListScan)}
                className="flex items-center gap-2 w-full"
              >
                <Camera className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                <span className="text-sm font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
                  Scan a List
                </span>
                <ChevronDown
                  className={classNames(
                    "w-4 h-4 text-stone-400 ml-auto transition-transform",
                    showListScan && "rotate-180"
                  )}
                />
              </button>
              {showListScan && (
                <div className="mt-2 mb-1">
                  <Card>
                    <div className="flex items-center gap-3 p-1">
                      <div className="flex-1">
                        <p className="text-sm font-medium dark:text-stone-200">
                          Snap a handwritten list
                        </p>
                        <p className="text-xs text-stone-400 dark:text-stone-500">
                          Take a photo of your grocery list to add items automatically
                        </p>
                      </div>
                      <button
                        onClick={handleListScan}
                        disabled={isListScanning}
                        className={classNames(
                          "shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                          isListScanning ? "bg-stone-200 dark:bg-stone-700" : "bg-orange-500 hover:bg-orange-600 text-white"
                        )}
                      >
                        {isListScanning ? (
                          <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Camera className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Quick add */}
          <form onSubmit={handleAdd} className="flex gap-2 px-4 pt-3 pb-2">
            <input
              type="text"
              placeholder="+ Add item..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
            />
            <button
              type="submit"
              disabled={!newItem.trim()}
              className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
            >
              Add
            </button>
          </form>

          {/* Best store recommendation */}
          {bestStore && bestStore.matchCount >= 2 && (
            <div className="px-4 py-2 bg-green-50 dark:bg-green-950/20 border-b border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    Best store: {bestStore.storeName}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">
                    {bestStore.matchCount} item{bestStore.matchCount !== 1 ? "s" : ""} on sale
                    {bestStore.estimatedSavings > 0 && ` · Save ~$${bestStore.estimatedSavings.toFixed(2)}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Scan error banner */}
          {scanError && (
            <div className="px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 flex items-center justify-between">
              <p className="text-xs text-red-600 dark:text-red-400">{scanError}</p>
              {onClearScanError && (
                <button onClick={onClearScanError} className="text-red-400 hover:text-red-600">
                  <XMark className="w-4 h-4" />
                </button>
              )}
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

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
            {totalCount === 0 ? (
              <EmptyState
                icon={<ShoppingCart className="w-12 h-12" />}
                title={storeFilter ? `No items for ${storeFilter}` : "List is empty"}
                description={storeFilter ? "Clear the filter to see all items" : "Add items above or from a recipe"}
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
      )}

      {/* ═══ SALES TAB ═══ */}
      {subTab === "sales" && (
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Deals matching your list */}
          {listDealMatches.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-semibold text-stone-600 dark:text-stone-300 uppercase tracking-wide">
                  Deals on your list
                </span>
                <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
                  {listDealMatches.length} item{listDealMatches.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-1.5">
                {listDealMatches.map(({ item, deals: matched }) => (
                  <Card key={item.id}>
                    <div className="p-1">
                      <p className="text-sm font-medium dark:text-stone-200">
                        {item.name}
                      </p>
                      <div className="mt-1 space-y-0.5">
                        {matched.slice(0, 3).map((deal, i) => (
                          <div key={deal.id} className="flex items-center justify-between text-xs">
                            <span className={classNames(
                              "text-stone-500 dark:text-stone-400",
                              i === 0 && "font-medium text-green-700 dark:text-green-400"
                            )}>
                              {deal.storeName}
                              {i === 0 && matched.length > 1 && (
                                <span className="ml-1 text-[10px] text-green-600 dark:text-green-400 font-normal">
                                  Best price
                                </span>
                              )}
                            </span>
                            <div className="text-right">
                              <span className={classNames(
                                "font-bold",
                                i === 0 ? "text-green-600 dark:text-green-400" : "text-stone-600 dark:text-stone-300"
                              )}>
                                ${deal.price.toFixed(2)}
                              </span>
                              {deal.unit && (
                                <span className="text-[10px] text-stone-400 ml-1">{deal.unit}</span>
                              )}
                            </div>
                          </div>
                        ))}
                        {matched[0]?.notes && (
                          <p className="text-[10px] text-stone-400 dark:text-stone-500">
                            {matched[0].notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Best store banner */}
          {bestStore && bestStore.matchCount >= 2 && (
            <div className="px-4 mt-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <Tag className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-xs text-green-800 dark:text-green-300">
                  <span className="font-semibold">{bestStore.storeName}</span> has the most deals matching your list ({bestStore.matchCount} items)
                  {bestStore.estimatedSavings > 0 && (
                    <span> &middot; ~${bestStore.estimatedSavings.toFixed(2)} in savings</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Refreshing indicator */}
          {isRefreshingDeals && (
            <div className="px-4 mt-2 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-stone-300 border-t-orange-500 rounded-full animate-spin" />
              <span className="text-xs text-stone-400 dark:text-stone-500">Updating deals...</span>
            </div>
          )}

          {/* Scan ad — collapsible */}
          <div className="px-4 pt-3">
            <button
              onClick={() => setShowSalesScanner(!showSalesScanner)}
              className="flex items-center gap-2 w-full"
            >
              <Camera className="w-4 h-4 text-stone-400 dark:text-stone-500" />
              <span className="text-sm font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
                Scan a Store Ad
              </span>
              <ChevronDown
                className={classNames(
                  "w-4 h-4 text-stone-400 ml-auto transition-transform",
                  showSalesScanner && "rotate-180"
                )}
              />
            </button>
            {showSalesScanner && (
              <div className="mt-2 mb-1">
                <Card>
                  <div className="p-1">
                    {!visionEnabled && !chatEnabled ? (
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        Add an AI provider in Settings to scan deals
                      </p>
                    ) : (
                      <>
                        <div className="flex gap-2 mb-2">
                          <div className="relative flex-1">
                            <input
                              type="url"
                              value={dealUrl}
                              onChange={(e) => {
                                setDealUrl(e.target.value);
                                if (e.target.value.trim()) setFlyerPreview(null);
                              }}
                              placeholder="Paste store ad URL..."
                              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
                            />
                          </div>
                          <button
                            onClick={() => flyerInputRef.current?.click()}
                            className={classNames(
                              "shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                              "bg-orange-500 hover:bg-orange-600 text-white"
                            )}
                            title="Upload screenshot or photo of ad"
                          >
                            <Camera className="w-5 h-5" />
                          </button>
                        </div>
                        <input
                          ref={flyerInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleFlyerSelect}
                          className="hidden"
                        />

                        {flyerPreview && (
                          <div className="rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-2">
                            <img src={flyerPreview} alt="Flyer preview" className="w-full max-h-48 object-cover" />
                          </div>
                        )}

                        {hasScannedDealInput && (
                          <Button
                            fullWidth
                            onClick={handleScanDeals}
                            disabled={isScanningDeals}
                          >
                            {isScanningDeals
                              ? "Scanning deals..."
                              : scannedPageCount > 0
                                ? `Scan Page ${scannedPageCount + 1}`
                                : "Extract Deals"}
                          </Button>
                        )}
                      </>
                    )}

                    {/* Scanned deals result */}
                    {(scannedDeals.length > 0 || scannedDealsMessage) && (
                      <div className="mt-3 space-y-2">
                        {scannedDealsMeta?.storeName && (
                          <p className="text-sm font-semibold dark:text-stone-200">
                            {scannedDealsMeta.storeName}
                            {scannedDealsMeta.validDates && (
                              <span className="ml-2 text-xs font-normal text-stone-400">
                                {scannedDealsMeta.validDates}
                              </span>
                            )}
                          </p>
                        )}
                        {scannedPageCount > 1 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500">
                            {scannedDeals.length} deals from {scannedPageCount} pages
                          </p>
                        )}
                        {scannedDealsMessage && scannedDeals.length === 0 && (
                          <p className="text-sm text-stone-500 dark:text-stone-400">{scannedDealsMessage}</p>
                        )}
                        {scannedDeals.length > 0 && (
                          <div className="grid grid-cols-1 gap-1.5">
                            {scannedDeals.map((deal, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-stone-50 dark:bg-stone-900"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium dark:text-stone-200 truncate">
                                    {deal.item}
                                  </p>
                                  {deal.notes && (
                                    <p className="text-[10px] text-stone-400 truncate">{deal.notes}</p>
                                  )}
                                </div>
                                <div className="text-right ml-2 shrink-0">
                                  <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                                    {deal.price}
                                  </p>
                                  {deal.originalPrice && (
                                    <p className="text-[10px] line-through text-stone-400">{deal.originalPrice}</p>
                                  )}
                                  {deal.unit && (
                                    <p className="text-[10px] text-stone-400">{deal.unit}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {scannedDeals.length > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            fullWidth
                            onClick={handleResetScannedDeals}
                          >
                            Start Over
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>

          {/* Store cards — one per scanned store */}
          {dealsByStore.length > 0 && (
            <div className="px-4 mt-4 space-y-2">
              {dealsByStore.map(([storeName, storeDeals]) => {
                const isExpanded = dealStoreFilter === storeName;
                const cheapest = storeDeals.reduce((min, d) => d.price < min ? d.price : min, Infinity);
                return (
                  <Card key={storeName}>
                    <button
                      onClick={() => setDealStoreFilter(isExpanded ? null : storeName)}
                      className="w-full flex items-center justify-between p-1"
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <div className="text-left">
                          <p className="text-sm font-semibold dark:text-stone-200">{storeName}</p>
                          <p className="text-xs text-stone-400 dark:text-stone-500">
                            {storeDeals.length} deal{storeDeals.length !== 1 ? "s" : ""}
                            {cheapest < Infinity && ` · From $${cheapest.toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                      <ChevronDown
                        className={classNames(
                          "w-4 h-4 text-stone-400 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 pt-2 border-t border-stone-200 dark:border-stone-700">
                        {/* Category filters for this store */}
                        {dealCategories.length > 1 && (
                          <div className="flex gap-1.5 mb-2 overflow-x-auto no-scrollbar">
                            <button
                              onClick={() => setDealCategoryFilter(null)}
                              className={classNames(
                                "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                                !dealCategoryFilter
                                  ? "bg-green-500 text-white border-green-500"
                                  : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                              )}
                            >
                              All
                            </button>
                            {dealCategories.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => setDealCategoryFilter(dealCategoryFilter === cat ? null : cat)}
                                className={classNames(
                                  "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                                  dealCategoryFilter === cat
                                    ? "bg-green-500 text-white border-green-500"
                                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                                )}
                              >
                                {CATEGORY_LABELS[cat as ShoppingCategory] ?? cat}
                              </button>
                            ))}
                          </div>
                        )}
                        {storeDeals
                          .filter((d) => !dealCategoryFilter || d.category === dealCategoryFilter)
                          .map((deal) => (
                          <div
                            key={deal.id}
                            className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-stone-50 dark:bg-stone-900"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium dark:text-stone-200 truncate">
                                {deal.item}
                              </p>
                              <p className="text-[10px] text-stone-400 dark:text-stone-500">
                                {deal.notes && `${deal.notes} · `}
                                {deal.validTo && `Expires ${deal.validTo}`}
                              </p>
                            </div>
                            <div className="text-right ml-2 shrink-0">
                              <p className="text-sm font-bold text-green-600 dark:text-green-400">
                                ${deal.price.toFixed(2)}
                              </p>
                              {deal.originalPrice != null && (
                                <p className="text-[10px] line-through text-stone-400">
                                  ${deal.originalPrice.toFixed(2)}
                                </p>
                              )}
                              {deal.unit && (
                                <p className="text-[10px] text-stone-400">{deal.unit}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {deals.length === 0 && scannedDeals.length === 0 && (
            <div className="px-4 mt-8">
              <EmptyState
                icon={<Tag className="w-12 h-12" />}
                title="No deals yet"
                description="Enable Weekly Deals in Settings to auto-fetch, or scan a store ad above"
              />
            </div>
          )}
        </div>
      )}

      {/* ═══ RECEIPTS TAB ═══ */}
      {subTab === "receipts" && (
        <div className="flex-1 overflow-y-auto pb-24">
          {/* Scan receipt — collapsible, matching Sales tab style */}
          <div className="px-4 pt-3">
            <button
              onClick={() => setShowReceiptScanner(!showReceiptScanner)}
              className="flex items-center gap-2 w-full"
            >
              <Camera className="w-4 h-4 text-stone-400 dark:text-stone-500" />
              <span className="text-sm font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
                Scan a Receipt
              </span>
              <ChevronDown
                className={classNames(
                  "w-4 h-4 text-stone-400 ml-auto transition-transform",
                  showReceiptScanner && "rotate-180"
                )}
              />
            </button>
            {showReceiptScanner && (
              <div className="mt-2 mb-1">
                <Card>
                  <div className="flex items-center gap-3 p-1">
                    <div className="flex-1">
                      <p className="text-sm font-medium dark:text-stone-200">
                        Photo a receipt to track spending
                      </p>
                    </div>
                    <button
                      onClick={handleReceiptScan}
                      disabled={isScanning || !visionEnabled}
                      className={classNames(
                        "shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        isScanning
                          ? "bg-stone-200 dark:bg-stone-700"
                          : !visionEnabled
                            ? "bg-stone-200 dark:bg-stone-700 text-stone-400"
                            : "bg-orange-500 hover:bg-orange-600 text-white"
                      )}
                      title={!visionEnabled ? "Enable a vision AI provider in Settings" : "Scan receipt"}
                    >
                      {isScanning ? (
                        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Camera className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </Card>
              </div>
            )}
          </div>

          {/* Scan error */}
          {scanError && (
            <div className="mx-4 mt-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 flex items-center justify-between">
              <p className="text-xs text-red-600 dark:text-red-400">{scanError}</p>
              {onClearScanError && (
                <button onClick={onClearScanError} className="text-red-400 hover:text-red-600">
                  <XMark className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Last scanned receipt — success banner */}
          {lastScannedReceipt && (
            <div className="mx-4 mt-2 px-3 py-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  Receipt Scanned{lastScannedReceipt.store ? ` — ${lastScannedReceipt.store}` : ""}
                </p>
                {onClearLastScanned && (
                  <button onClick={onClearLastScanned} className="text-green-400 hover:text-green-600">
                    <XMark className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-xs text-green-600 dark:text-green-500">
                {lastScannedReceipt.items.length} item{lastScannedReceipt.items.length !== 1 ? "s" : ""}
                {lastScannedReceipt.total ? ` · Total: $${lastScannedReceipt.total.toFixed(2)}` : ""}
              </p>
              <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
                {lastScannedReceipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs dark:text-stone-300">
                    <span className="truncate flex-1">{item.name}</span>
                    <span className="ml-2 text-stone-500">${item.price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spending summary card */}
          {currentWeekSpending && currentWeekSpending.total > 0 && (
            <div className="mx-4 mt-3">
              <Card>
                <button
                  onClick={() => setShowSpendingDetail(!showSpendingDetail)}
                  className="w-full flex items-center justify-between p-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold dark:text-stone-200">
                      This week: ${currentWeekSpending.total.toFixed(2)}
                    </span>
                    {spendingTrend && spendingTrend.direction !== "flat" && (
                      <span className={classNames(
                        "text-xs font-medium",
                        spendingTrend.direction === "down" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"
                      )}>
                        {spendingTrend.direction === "up" ? "\u2191" : "\u2193"} ${spendingTrend.amount.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={classNames(
                      "w-4 h-4 text-stone-400 transition-transform",
                      showSpendingDetail && "rotate-180"
                    )}
                  />
                </button>
                {showSpendingDetail && (
                  <div className="mt-2 space-y-1.5 px-1 pb-1 border-t border-stone-200 dark:border-stone-700 pt-2">
                    {Object.entries(currentWeekSpending.byStore).length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase text-stone-400 dark:text-stone-500 mb-1">By Store</p>
                        {Object.entries(currentWeekSpending.byStore).map(([store, amount]) => (
                          <div key={store} className="flex justify-between text-xs dark:text-stone-300">
                            <span>{store}</span>
                            <span>${amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-stone-400 dark:text-stone-500">
                      {currentWeekSpending.itemCount} receipt{currentWeekSpending.itemCount !== 1 ? "s" : ""} this week
                      {spendingTrend && spendingTrend.direction !== "flat" && (
                        <> &middot; {spendingTrend.direction === "up" ? "up" : "down"} ${spendingTrend.amount.toFixed(2)} vs last week</>
                      )}
                    </p>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* Receipt history — card-based */}
          {receipts.length > 0 && (
            <div className="px-4 mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-1">
                Receipt History
              </h3>
              {receipts.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-center justify-between p-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold dark:text-stone-200 truncate">
                        {r.store ?? "Unknown Store"}
                      </p>
                      <p className="text-xs text-stone-400 dark:text-stone-500">
                        {new Date(r.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    {r.total != null && (
                      <p className="text-sm font-bold dark:text-stone-200 ml-2">
                        ${r.total.toFixed(2)}
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {receipts.length === 0 && !lastScannedReceipt && (!currentWeekSpending || currentWeekSpending.total === 0) && (
            <div className="px-4 mt-8">
              <EmptyState
                icon={<ShoppingCart className="w-12 h-12" />}
                title="No receipts yet"
                description="Scan a receipt to start tracking your spending"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
