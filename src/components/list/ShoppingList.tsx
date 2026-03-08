import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ShoppingList as ShoppingListType, ShoppingCategory, ShoppingItem, RecipeIndexEntry } from "../../types";
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_EMOJI } from "../../lib/categories";
import { abbreviateName, abbreviateUnit } from "../../lib/abbreviate";
import { classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { EllipsisVertical, Check, XMark, ShoppingCart, ArrowUpDown, Tag, Sparkles, Trash, WhiskLogo } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { DealsScanner } from "../plan/DealsScanner";

type SortMode = "department" | "alphabetical" | "unchecked-first";

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

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {totalCount === 0 ? (
          <EmptyState
            icon={<ShoppingCart className="w-12 h-12" />}
            title={storeFilter ? `No items for ${storeFilter}` : "List is empty"}
            description={storeFilter ? "Clear the filter to see all items" : "Add items above or from a recipe"}
          />
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
    </div>
  );
}
