import { useState, useMemo, type FormEvent } from "react";
import type { ShoppingList as ShoppingListType, ShoppingCategory, RecipeIndexEntry } from "../../types";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/categories";
import { classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { EllipsisVertical, Check, XMark, ShoppingCart } from "../ui/Icon";

interface ShoppingListProps {
  list: ShoppingListType;
  isLoading: boolean;
  onAddItem: (name: string) => void;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearChecked: () => void;
  onClearAll: () => void;
  recipeIndex?: RecipeIndexEntry[];
}

export function ShoppingList({
  list,
  isLoading,
  onAddItem,
  onToggleItem,
  onRemoveItem,
  onClearChecked,
  onClearAll,
  recipeIndex = [],
}: ShoppingListProps) {
  const [newItem, setNewItem] = useState("");
  const [showOverflow, setShowOverflow] = useState(false);

  const grouped = useMemo(() => {
    const groups = new Map<ShoppingCategory, typeof list.items>();
    for (const cat of CATEGORY_ORDER) {
      groups.set(cat, []);
    }
    for (const item of list.items) {
      const cat = item.category ?? "other";
      const arr = groups.get(cat) ?? [];
      arr.push(item);
      groups.set(cat, arr);
    }
    return groups;
  }, [list.items]);

  const recipeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recipeIndex) {
      map.set(r.id, r.title);
    }
    return map;
  }, [recipeIndex]);

  const checkedCount = list.items.filter((i) => i.checked).length;
  const totalCount = list.items.length;

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const name = newItem.trim();
    if (!name) return;
    onAddItem(name);
    setNewItem("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">
            Shopping List
          </h1>
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="p-2 text-stone-500 dark:text-stone-400"
            >
              <EllipsisVertical className="w-5 h-5" />
            </button>
            {showOverflow && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOverflow(false)}
                />
                <div className="absolute right-0 top-10 z-50 w-44 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
                  <button
                    onClick={() => {
                      onClearChecked();
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                  >
                    Clear checked ({checkedCount})
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Clear entire shopping list?")) {
                        onClearAll();
                      }
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-stone-700"
                  >
                    Clear all
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

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

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {totalCount === 0 ? (
          <EmptyState
            icon={<ShoppingCart className="w-12 h-12" />}
            title="List is empty"
            description="Add items above or from a recipe"
          />
        ) : (
          <div className="space-y-4">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped.get(cat) ?? [];
              if (items.length === 0) return null;

              // Sort: unchecked first, then checked
              const sorted = [...items].sort((a, b) =>
                a.checked === b.checked ? 0 : a.checked ? 1 : -1
              );

              return (
                <section key={cat}>
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-orange-300/50">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <button
                      onClick={() => items.forEach((item) => onRemoveItem(item.id))}
                      className="text-[10px] font-medium text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                    >
                      clear
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {sorted.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2.5 py-1.5 group"
                      >
                        <button
                          onClick={() => onToggleItem(item.id)}
                          className={classNames(
                            "h-5 w-5 rounded border flex-shrink-0 flex items-center justify-center",
                            item.checked
                              ? "bg-orange-500 border-orange-500 text-white"
                              : "border-stone-300 dark:border-stone-600"
                          )}
                        >
                          {item.checked && <Check className="w-3 h-3" />}
                        </button>
                        <span
                          className={classNames(
                            "flex-1 text-sm line-clamp-1",
                            item.checked
                              ? "line-through text-stone-400 dark:text-stone-500"
                              : "dark:text-stone-200"
                          )}
                          title={[item.amount, item.unit, item.name].filter(Boolean).join(" ")}
                        >
                          {[item.amount, item.unit, item.name]
                            .filter(Boolean)
                            .join(" ")}
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveItem(item.id);
                          }}
                          className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 px-1 shrink-0"
                        >
                          <XMark className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {/* Summary */}
            <div className="border-t border-stone-200 dark:border-stone-800 pt-3 text-sm text-stone-400 dark:text-stone-500 text-center">
              {totalCount} item{totalCount !== 1 ? "s" : ""}
              {checkedCount > 0 &&
                ` \u00B7 ${checkedCount} checked`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
