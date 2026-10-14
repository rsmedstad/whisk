import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { peekImportLdPayload, clearImportLdPayload } from "../../lib/import-ld-bridge";
import { clearPendingImport } from "../../lib/pending-import";
import { findRecipeIdBySourceUrl } from "../../lib/source-url";
import type { ImportLdPayload } from "../../lib/bookmarklet";
import type { Ingredient, Recipe, RecipeIndexEntry, RecipePhoto, Step } from "../../types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { ChevronLeft } from "../ui/Icon";

interface ScrapedRecipe {
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  thumbnailUrl?: string;
  photos?: RecipePhoto[];
  videoUrl?: string;
  tags?: string[];
  sourceRating?: number;
  sourceRatingCount?: number;
}

interface ImportJsonLdProps {
  onCreateRecipe: (recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">) => Promise<Recipe>;
  existingRecipes?: RecipeIndexEntry[];
  isDemoRestricted?: boolean;
}

let saveLock: Promise<string> | null = null;

function sourceDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function ImportJsonLd({
  onCreateRecipe,
  existingRecipes = [],
  isDemoRestricted = false,
}: ImportJsonLdProps) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<ImportLdPayload | null>(null);
  const [status, setStatus] = useState<"waiting" | "saving" | "error">("waiting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const take = (): boolean => {
      const existing = peekImportLdPayload();
      if (!existing) return false;
      setPayload(existing);
      return true;
    };
    if (take()) return;
    const onMsg = () => { take(); };
    window.addEventListener("message", onMsg);
    const poll = window.setInterval(() => { take(); }, 200);
    const timer = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!take()) {
        setStatus("error");
        setError("No recipe data arrived. Go back to the recipe page and tap Save to Whisk again.");
      }
    }, 8000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      window.removeEventListener("message", onMsg);
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    setStatus("saving");
    const run = async (): Promise<string> => {
      const index = existingRecipes.length > 0
        ? existingRecipes
        : await api.get<RecipeIndexEntry[]>("/recipes").catch(() => [] as RecipeIndexEntry[]);
      const existingId = findRecipeIdBySourceUrl(index, payload.url);
      if (existingId) {
        clearImportLdPayload();
        clearPendingImport(payload.url);
        return existingId;
      }
      const scraped = await api.post<ScrapedRecipe>(
        "/import/url",
        {
          url: payload.url,
          jsonLd: payload.jsonLd,
          downloadImage: !isDemoRestricted,
        },
        { timeoutMs: 45_000 },
      );
      if (!scraped?.title) throw new Error("Whisk could not turn that page into a recipe.");
      const created = await onCreateRecipe({
        title: scraped.title,
        description: scraped.description,
        ingredients: scraped.ingredients ?? [],
        steps: scraped.steps ?? [],
        favorite: false,
        photos: scraped.photos ?? [],
        thumbnailUrl: scraped.thumbnailUrl,
        videoUrl: scraped.videoUrl,
        tags: scraped.tags ?? [],
        prepTime: scraped.prepTime,
        cookTime: scraped.cookTime,
        servings: scraped.servings,
        sourceRating: scraped.sourceRating,
        sourceRatingCount: scraped.sourceRatingCount,
        source: {
          type: "url",
          url: payload.url,
          domain: sourceDomain(payload.url),
        },
      });
      clearImportLdPayload();
      clearPendingImport(payload.url);
      return created.id;
    };
    if (!saveLock) saveLock = run();
    saveLock
      .then((id) => navigate(`/recipes/${id}`, { replace: true }))
      .catch((err: unknown) => {
        saveLock = null;
        setStatus("error");
        setError(err instanceof Error && err.message
          ? err.message
          : "Could not save this recipe.");
      });
  }, [payload, onCreateRecipe, existingRecipes, isDemoRestricted, navigate]);

  return (
    <div className="min-h-screen px-4 pt-[calc(var(--sat)+1rem)] pb-24">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1 text-sm font-medium text-stone-600 dark:text-stone-400 mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Recipes
      </button>
      <Card>
        {status === "waiting" && (
          <div className="py-8 text-center space-y-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-stone-600 dark:text-stone-300">Waiting for recipe data…</p>
          </div>
        )}
        {status === "saving" && (
          <div className="py-8 text-center space-y-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-stone-600 dark:text-stone-300">Saving to Whisk…</p>
          </div>
        )}
        {status === "error" && (
          <div className="py-6 space-y-4 text-center">
            <p className="text-sm text-stone-600 dark:text-stone-300">{error}</p>
            <div className="flex flex-col gap-2">
              {payload && (
                <Button
                  fullWidth
                  onClick={() => {
                    setError(null);
                    setStatus("saving");
                    setPayload({ ...payload });
                  }}
                >
                  Try again
                </Button>
              )}
              <Button variant="secondary" fullWidth onClick={() => navigate("/settings?tab=data")}>
                Bookmarklet help
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
