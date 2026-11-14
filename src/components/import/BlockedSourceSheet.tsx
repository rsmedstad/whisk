import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Ingredient, PendingImport, Recipe, Step } from "../../types";
import { api } from "../../lib/api";
import {
  blockedSheetFrameLimitCopy,
  blockedSheetPasteCopy,
  clearPendingImport,
  blockedSheetNextStepCopy,
  openSourcePage,
  setPendingImport,
  sourceLabelFromPending,
} from "../../lib/pending-import";
import { detectSavePlatform, isBookmarkletInstalled } from "../../lib/platform";
import { Button } from "../ui/Button";
import { WhiskLogo, XMark } from "../ui/Icon";

interface BlockedSourceSheetProps {
  item: PendingImport;
  onClose: () => void;
  onCreateRecipe?: (recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">) => Promise<Recipe>;
}

interface TextRecipe {
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function BlockedSourceSheet({ item, onClose, onCreateRecipe }: BlockedSourceSheetProps) {
  const navigate = useNavigate();
  const [platform, setPlatform] = useState(() =>
    typeof navigator === "undefined" ? "desktop" : detectSavePlatform(),
  );
  const [hasBookmarklet, setHasBookmarklet] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectSavePlatform());
    setHasBookmarklet(isBookmarkletInstalled());
    setImageFailed(false);
  }, [item.url]);

  const sourceLabel = sourceLabelFromPending(item);
  const showImage = Boolean(item.imageUrl) && !imageFailed;

  const openSource = () => {
    setPendingImport({
      ...item,
      timestamp: Date.now(),
      sourceLabel,
    });
    openSourcePage(item.url, platform);
  };

  const importPasted = async () => {
    if (!onCreateRecipe || importing) return;
    setImporting(true);
    setPasteError(null);
    try {
      const parsed = await api.post<TextRecipe>("/import/text", { text: pasted }, { timeoutMs: 45_000 });
      if (!parsed?.title) throw new Error("Couldn't find a recipe in that text.");
      const created = await onCreateRecipe({
        title: parsed.title,
        description: parsed.description,
        ingredients: parsed.ingredients ?? [],
        steps: parsed.steps ?? [],
        favorite: false,
        photos: [],
        tags: [],
        prepTime: parsed.prepTime,
        cookTime: parsed.cookTime,
        servings: parsed.servings,
        source: { type: "url", url: item.url, domain: hostOf(item.url) },
      });
      clearPendingImport(item.url);
      onClose();
      navigate(`/recipes/${created.id}`);
    } catch (err) {
      setPasteError(err instanceof Error && err.message ? err.message : "Could not import that text.");
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-4 pb-[calc(var(--sab)+1rem)] sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blocked-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {showImage && (
          <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800">
            <img
              src={item.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          </div>
        )}
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <WhiskLogo className="w-6 h-6 text-orange-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">
                  {sourceLabel}
                </p>
                <h2
                  id="blocked-sheet-title"
                  className="text-lg font-bold dark:text-stone-100 leading-snug"
                >
                  {item.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 -mr-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              aria-label="Close"
            >
              <XMark className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
            <p>{blockedSheetFrameLimitCopy(sourceLabel)}</p>
            <p className="font-medium text-stone-800 dark:text-stone-100">
              {blockedSheetNextStepCopy(sourceLabel, platform)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(platform === "ios" && !hasBookmarklet ? "/shortcut" : "/settings?tab=data");
            }}
            className="text-xs font-medium text-orange-600 dark:text-orange-400 underline"
          >
            Set up one-tap Save to Whisk
          </button>

          {onCreateRecipe && (
            <div className="space-y-2">
              {!pasteOpen ? (
                <button
                  type="button"
                  onClick={() => setPasteOpen(true)}
                  className="text-xs font-medium text-orange-600 dark:text-orange-400 underline"
                >
                  Paste recipe text instead
                </button>
              ) : (
                <>
                  <p className="text-xs text-stone-500 dark:text-stone-400">{blockedSheetPasteCopy()}</p>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={6}
                    maxLength={12000}
                    placeholder="Paste the ingredients and steps here"
                    className="w-full rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 p-2 text-sm dark:text-stone-100"
                  />
                  {pasteError && <p className="text-xs text-red-600 dark:text-red-400">{pasteError}</p>}
                  <Button fullWidth variant="secondary" disabled={importing || pasted.trim().length < 40} onClick={importPasted}>
                    {importing ? "Importing…" : "Import"}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <Button fullWidth onClick={openSource}>
              Open on {sourceLabel}
            </Button>
            <Button variant="ghost" fullWidth onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
