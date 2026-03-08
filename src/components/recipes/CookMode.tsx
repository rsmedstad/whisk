import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { getLocal, CACHE_KEYS } from "../../lib/cache";
import { useWakeLock } from "../../hooks/useWakeLock";
import { classNames, parseTimerFromText, decodeEntities } from "../../lib/utils";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { Stopwatch, Check } from "../ui/Icon";

interface CookModeProps {
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}

export function CookMode({ onStartTimer }: CookModeProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe } = useRecipes();
  const wakeLock = useWakeLock();
  const cachedRecipe = id ? getLocal<Recipe>(CACHE_KEYS.RECIPE(id)) : null;
  const [recipe, setRecipe] = useState<Recipe | null>(cachedRecipe);
  const [isLoading, setIsLoading] = useState(!cachedRecipe);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Background refresh
  useEffect(() => {
    if (!id) return;
    getRecipe(id)
      .then(setRecipe)
      .catch(() => { if (!cachedRecipe) navigate("/"); })
      .finally(() => setIsLoading(false));
  }, [id, getRecipe, navigate]);

  useEffect(() => {
    wakeLock.request();
    return () => {
      wakeLock.release();
    };
  }, []);

  const toggleStep = (index: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (isLoading || !recipe) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  if (recipe.steps.length === 0) {
    return (
      <div className="min-h-screen bg-white dark:bg-stone-950 flex flex-col items-center justify-center px-6">
        <p className="text-stone-500 dark:text-stone-400 mb-4">
          This recipe doesn&apos;t have any steps yet.
        </p>
        <button
          onClick={() => navigate(`/recipes/${recipe.id}`, { replace: true })}
          className="text-sm font-medium text-orange-500"
        >
          Back to recipe
        </button>
      </div>
    );
  }

  const totalSteps = recipe.steps.length;
  const completedCount = completedSteps.size;

  return (
    <div className="min-h-screen bg-white dark:bg-stone-950 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[calc(var(--sat)+0.75rem)]">
        <div className="flex items-center justify-between py-3">
          <div>
            <span className="text-sm font-semibold text-orange-500">
              Cook Mode
            </span>
            <p className="text-xs text-stone-400 dark:text-stone-500 line-clamp-1">
              {recipe.title}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-400 dark:text-stone-500">
              {completedCount}/{totalSteps}
            </span>
            <button
              onClick={() => navigate(`/recipes/${recipe.id}`, { replace: true })}
              className="text-sm font-medium text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-3 py-1 rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Ingredients quick ref */}
      {recipe.ingredients.length > 0 && (
        <details className="border-b border-stone-200 dark:border-stone-800">
          <summary className="px-4 py-3 text-sm font-semibold text-stone-600 dark:text-stone-300 cursor-pointer select-none">
            Ingredients ({recipe.ingredients.length})
          </summary>
          <ul className="px-4 pb-3 space-y-1">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="text-sm text-stone-600 dark:text-stone-400">
                {[ing.amount, ing.unit, ing.name].filter(Boolean).join(" ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* All steps — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(var(--sab)+2rem)] space-y-3">
        {recipe.steps.map((step, i) => {
          const timerMin = step.timerMinutes ?? parseTimerFromText(step.text);
          const done = completedSteps.has(i);

          return (
            <button
              key={i}
              onClick={() => toggleStep(i)}
              className={classNames(
                "w-full text-left rounded-xl border p-4 transition-colors",
                done
                  ? "border-orange-200 bg-orange-50/50 dark:border-orange-900/50 dark:bg-orange-950/20"
                  : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={classNames(
                    "mt-0.5 h-6 w-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                    done
                      ? "bg-orange-500 border-orange-500 text-white"
                      : "border-stone-300 dark:border-stone-600"
                  )}
                >
                  {done && <Check className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-stone-400 dark:text-stone-500 mb-1">
                    Step {i + 1}
                  </p>

                  {step.photoUrl && (
                    <img
                      src={step.photoUrl}
                      alt={`Step ${i + 1}`}
                      className="max-h-40 rounded-lg mb-2 object-cover"
                    />
                  )}

                  <p
                    className={classNames(
                      "text-base leading-relaxed",
                      done
                        ? "text-stone-400 dark:text-stone-500"
                        : "text-stone-800 dark:text-stone-200"
                    )}
                  >
                    {decodeEntities(step.text)}
                  </p>

                  {timerMin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartTimer(`Step ${i + 1}`, timerMin, recipe.id, i);
                      }}
                      className="wk-pill mt-2 inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-xs font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      <Stopwatch className="w-3.5 h-3.5" /> {timerMin}:00 Timer
                    </button>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
