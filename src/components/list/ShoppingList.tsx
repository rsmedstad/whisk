import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ShoppingList as ShoppingListType, ShoppingCategory, ShoppingItem, RecipeIndexEntry, Receipt, SpendingSummary } from "../../types";
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_EMOJI } from "../../lib/categories";
import { abbreviateName, abbreviateUnit } from "../../lib/abbreviate";
import { classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { EllipsisVertical, Check, XMark, ShoppingCart, ArrowUpDown, Tag, Sparkles, Trash, WhiskLogo, Camera } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { DealsScanner } from "../plan/DealsScanner";

type SortMode = "department" | "alphabetical" | "unchecked-first" | "by-store";

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
}: ShoppingListProps) {
  const navigate = useNavigate();
  const [newItem, setNewItem] = useState("");
  const [showOverflow, setShowOverflow] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("department");
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [storeInput, setStoreInput] = useState("");
  const [isClassifying, setIsClassifying] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [scanMode, setScanMode] = useState<"list" | "receipt">("list");
  const [showSpendingDetail, setShowSpendingDetail] = useState(false);

  // Get unique store names from items
  const storeNames = useMemo(() => {
    const stores = new Set<string>();
    for (const item of list.items) {
      if (item.store) stores.add(item.store);
    }
    return Array.from(stores).sort();
  }, [list.items]);

  // Filter items by store
  const filteredItems = useMemo(() => {
    if (!storeFilter) return list.items;
    return list.items.filter((i) => i.store === storeFilter);
  }, [list.items, storeFilter]);

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
      // unchecked first, then alphabetical
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
    // Sort stores alphabetically, with "Unassigned" last
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
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

  const renderItem = (item: ShoppingItem) => {
    const displayText = abbreviateName(item.name);
    const shortUnit = abbreviateUnit(item.unit);
    const fullLabel = [item.amount, shortUnit, displayText].filter(Boolean).join(" ");

    return (
      <li
        key={item.id}
        className="flex items-center gap-2 py-1.5 group"
      >
        {/* Checkbox */}
        <button
          onClick={() => onToggleItem(item.id)}
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
          {(item.sourceRecipeId || item.addedByUser) && (
            <span className="ml-1 text-xs text-stone-400 dark:text-stone-500">
              {item.sourceRecipeId && recipeNames.get(item.sourceRecipeId)
                ? `(${recipeNames.get(item.sourceRecipeId)})`
                : item.addedByUser
                  ? `(${item.addedByUser})`
                  : null}
            </span>
          )}
        </span>

        {/* Deal badge */}
        {item.dealMatch && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">
            ${item.dealMatch.salePrice.toFixed(2)} @ {item.dealMatch.storeName}
          </span>
        )}

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
          onClick={() => onRemoveItem(item.id)}
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
                      { value: "department", label: "By department" },
                      { value: "by-store", label: "By store" },
                      { value: "alphabetical", label: "A-Z" },
                      { value: "unchecked-first", label: "Unchecked first" },
                    ] as const).map((opt) => (
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
        </div>

        {/* Store filter pills */}
        {storeNames.length > 0 && (
          <div className="flex gap-1.5 pb-2 overflow-x-auto no-scrollbar">
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

        {/* Clear action pills */}
        {totalCount > 0 && (
          <div className="flex gap-1.5 pb-2">
            {checkedCount > 0 && (
              <button
                onClick={onClearChecked}
                className="inline-flex items-center rounded-full border border-stone-300 px-2.5 py-0.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-800 transition-colors"
              >
                Clear selected ({checkedCount})
              </button>
            )}
            <button
              onClick={() => { if (confirm("Clear entire shopping list?")) onClearAll(); }}
              className="inline-flex items-center rounded-full border border-stone-300 px-2.5 py-0.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-stone-600 dark:hover:bg-stone-800 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Quick add */}
        <form onSubmit={handleAdd} className="flex gap-2 pb-3">
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
      </div>

      {/* Deals Scanner */}
      <DealsScanner visionEnabled={visionEnabled} chatEnabled={chatEnabled} />

      {/* Spending summary */}
      {currentWeekSpending && currentWeekSpending.total > 0 && (
        <div className="px-4 py-2 border-b border-stone-200 dark:border-stone-800">
          <button
            onClick={() => setShowSpendingDetail(!showSpendingDetail)}
            className="w-full flex items-center justify-between"
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
            <span className="text-xs text-stone-400 dark:text-stone-500">
              {showSpendingDetail ? "Hide" : "Details"}
            </span>
          </button>
          {showSpendingDetail && (
            <div className="mt-2 space-y-1.5">
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

      {/* Receipt scan result preview */}
      {lastScannedReceipt && (
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950/20 border-b border-green-200 dark:border-green-800">
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

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {totalCount === 0 ? (
          <EmptyState
            icon={<ShoppingCart className="w-12 h-12" />}
            title={storeFilter ? `No items for ${storeFilter}` : "List is empty"}
            description={storeFilter ? "Clear the filter to see all items" : "Add items above or from a recipe"}
          />
        ) : sortMode === "by-store" && storeGrouped ? (
          /* Store-grouped list */
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
        ) : sortMode === "alphabetical" && sortedFlat ? (
          /* Alphabetical flat list */
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
          /* Department grouped list */
          <div className="space-y-4">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped.get(cat) ?? [];
              if (items.length === 0) return null;

              // Sort within category
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

            {/* Summary */}
            <div className="border-t border-stone-200 dark:border-stone-800 pt-3 text-sm text-stone-400 dark:text-stone-500 text-center">
              {totalCount} item{totalCount !== 1 ? "s" : ""}
              {checkedCount > 0 && ` \u00B7 ${checkedCount} checked`}
              {storeFilter && ` \u00B7 filtered by ${storeFilter}`}
            </div>
          </div>
        )}
      </div>

      {/* Camera FAB with scan mode toggle */}
      {visionEnabled && (
        <div className="no-print fixed bottom-20 right-4 z-30 flex flex-col items-end gap-2" style={{ marginBottom: "var(--sab)" }}>
          {/* Mode toggle pills */}
          <div className="flex rounded-full bg-stone-800/90 dark:bg-stone-700/90 p-0.5 shadow-lg">
            <button
              onClick={() => setScanMode("list")}
              className={classNames(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                scanMode === "list"
                  ? "bg-orange-500 text-white"
                  : "text-stone-300 hover:text-white"
              )}
            >
              List
            </button>
            <button
              onClick={() => setScanMode("receipt")}
              className={classNames(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                scanMode === "receipt"
                  ? "bg-orange-500 text-white"
                  : "text-stone-300 hover:text-white"
              )}
            >
              Receipt
            </button>
          </div>
          {/* FAB */}
          <button
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.capture = "environment";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                if (scanMode === "receipt" && onScanReceipt) {
                  await onScanReceipt(file);
                } else {
                  // Shopping list scan — use existing /api/shopping/scan
                  const formData = new FormData();
                  formData.append("photo", file);
                  const token = localStorage.getItem("whisk_token");
                  try {
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
                    // Silently fail — user can retry
                  }
                }
              };
              input.click();
            }}
            disabled={isScanning}
            className={classNames(
              "w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center transition-colors",
              isScanning ? "bg-stone-400" : "bg-orange-500 hover:bg-orange-600"
            )}
            title={scanMode === "receipt" ? "Scan receipt" : "Scan shopping list"}
          >
            {isScanning ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="w-6 h-6" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
