import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe, Ingredient } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import {
  formatTime,
  scaleIngredient,
  classNames,
  parseTimerFromText,
} from "../../lib/utils";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { TagChip } from "../ui/TagChip";

interface RecipeDetailProps {
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
  onAddToShoppingList: (ingredients: Ingredient[], recipeId: string) => void;
}

export function RecipeDetail({ onStartTimer, onAddToShoppingList }: RecipeDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe, toggleFavorite, deleteRecipe } = useRecipes();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scaledServings, setScaledServings] = useState<number | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    getRecipe(id)
      .then((r) => {
        setRecipe(r);
        setScaledServings(r.servings ?? null);
      })
      .catch(() => navigate("/"))
      .finally(() => setIsLoading(false));
  }, [id, getRecipe, navigate]);

  const handleDelete = useCallback(async () => {
    if (!recipe || !confirm("Delete this recipe?")) return;
    await deleteRecipe(recipe.id);
    navigate("/");
  }, [recipe, deleteRecipe, navigate]);

  const handleFavorite = useCallback(async () => {
    if (!recipe) return;
    await toggleFavorite(recipe.id);
    setRecipe((r) => (r ? { ...r, favorite: !r.favorite } : r));
  }, [recipe, toggleFavorite]);

  if (isLoading || !recipe) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  const originalServings = recipe.servings ?? 1;
  const servings = scaledServings ?? originalServings;
  const ingredients = recipe.ingredients.map((ing) =>
    scaleIngredient(ing, originalServings, servings)
  );

  const photos = recipe.photos.length > 0 ? recipe.photos : [];
  const heroPhoto = photos[photoIndex];

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <button
          onClick={() => navigate(-1)}
          className="text-stone-600 dark:text-stone-400 font-medium text-sm"
        >
          &#8592; Back
        </button>
        <div className="flex items-center gap-3">
          <button onClick={handleFavorite} className="text-xl">
            {recipe.favorite ? (
              <span className="text-red-500">&#9829;</span>
            ) : (
              <span className="text-stone-400">&#9825;</span>
            )}
          </button>
          <button
            onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
            className="text-stone-500 dark:text-stone-400"
          >
            &#9998;
          </button>
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="text-stone-500 dark:text-stone-400 px-1"
            >
              &#8942;
            </button>
            {showOverflow && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOverflow(false)}
                />
                <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
                  <button
                    onClick={() => {
                      navigate(`/recipes/${recipe.id}/cook`);
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                  >
                    Start Cooking
                  </button>
                  <button
                    onClick={() => {
                      onAddToShoppingList(recipe.ingredients, recipe.id);
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                  >
                    Add to Shopping List
                  </button>
                  <button
                    onClick={() => {
                      handleDelete();
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-stone-700"
                  >
                    Delete Recipe
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hero photo gallery */}
      {photos.length > 0 && (
        <div className="relative">
          <div className="aspect-video bg-stone-100 dark:bg-stone-800">
            {heroPhoto && (
              <img
                src={heroPhoto.url}
                alt={heroPhoto.caption ?? recipe.title}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          {photos.length > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIndex(i)}
                  className={classNames(
                    "h-2 w-2 rounded-full",
                    i === photoIndex ? "bg-white" : "bg-white/50"
                  )}
                />
              ))}
            </div>
          )}
          {recipe.videoUrl && (
            <a
              href={recipe.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white"
            >
              &#9654; Video
            </a>
          )}
        </div>
      )}

      <div className="px-4 py-4 space-y-6">
        {/* Title & meta */}
        <div>
          <h1 className="text-2xl font-bold dark:text-stone-100">
            {recipe.title}
          </h1>
          {recipe.description && (
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {recipe.description}
            </p>
          )}
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-stone-500 dark:text-stone-400">
            {(recipe.prepTime || recipe.cookTime) && (
              <span>
                &#x1F552;{" "}
                {formatTime((recipe.prepTime ?? 0) + (recipe.cookTime ?? 0))}
              </span>
            )}
            {recipe.servings && (
              <span>&#x1F37D; {recipe.servings} servings</span>
            )}
            {recipe.yield && <span>{recipe.yield}</span>}
            {recipe.difficulty && (
              <span className="capitalize">{recipe.difficulty}</span>
            )}
          </div>
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {recipe.tags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  size="sm"
                  onToggle={() => navigate(`/?tag=${tag}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Start Cooking button */}
        <Button
          fullWidth
          onClick={() => navigate(`/recipes/${recipe.id}/cook`)}
        >
          &#x1F373; Start Cooking
        </Button>

        {/* Ingredients */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold dark:text-stone-100">
              Ingredients
            </h2>
          </div>

          {recipe.servings && (
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-stone-500 dark:text-stone-400">
                Servings:
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setScaledServings(Math.max(1, servings - 1))
                  }
                  className="h-8 w-8 rounded-full border border-stone-300 text-sm dark:border-stone-600 dark:text-stone-300"
                >
                  -
                </button>
                <span className="w-8 text-center font-medium dark:text-stone-100">
                  {servings}
                </span>
                <button
                  onClick={() => setScaledServings(servings + 1)}
                  className="h-8 w-8 rounded-full border border-stone-300 text-sm dark:border-stone-600 dark:text-stone-300"
                >
                  +
                </button>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {ingredients.map((ing, i) => (
              <IngredientRow key={i} ingredient={ing} />
            ))}
          </ul>

          <Button
            variant="secondary"
            fullWidth
            className="mt-3"
            onClick={() =>
              onAddToShoppingList(recipe.ingredients, recipe.id)
            }
          >
            Add to Shopping List
          </Button>
        </section>

        {/* Steps */}
        <section>
          <h2 className="text-lg font-semibold mb-3 dark:text-stone-100">
            Steps
          </h2>
          <ol className="space-y-4">
            {recipe.steps.map((step, i) => {
              const timerMin =
                step.timerMinutes ?? parseTimerFromText(step.text);
              return (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 h-6 w-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center dark:bg-orange-900 dark:text-orange-300">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-relaxed dark:text-stone-200">
                      {step.text}
                    </p>
                    {step.photoUrl && (
                      <img
                        src={step.photoUrl}
                        alt={`Step ${i + 1}`}
                        className="mt-2 rounded-lg max-h-48 object-cover"
                        loading="lazy"
                      />
                    )}
                    {timerMin && (
                      <button
                        onClick={() =>
                          onStartTimer(
                            `Step ${i + 1}`,
                            timerMin,
                            recipe.id,
                            i
                          )
                        }
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                      >
                        &#9201; {timerMin}:00
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Notes */}
        {recipe.notes && (
          <section>
            <h2 className="text-lg font-semibold mb-2 dark:text-stone-100">
              Notes
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
              {recipe.notes}
            </p>
          </section>
        )}

        {/* Source */}
        {recipe.source?.url && (
          <div className="text-sm text-stone-400 dark:text-stone-500">
            Source:{" "}
            <a
              href={recipe.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:underline"
            >
              {recipe.source.domain ?? recipe.source.url}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function IngredientRow({ ingredient }: { ingredient: Ingredient }) {
  const [checked, setChecked] = useState(false);

  const display = [ingredient.amount, ingredient.unit, ingredient.name]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={classNames(
        "flex items-center gap-2 text-sm cursor-pointer",
        checked && "line-through text-stone-400 dark:text-stone-500"
      )}
      onClick={() => setChecked(!checked)}
    >
      <span
        className={classNames(
          "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center text-xs",
          checked
            ? "bg-orange-500 border-orange-500 text-white"
            : "border-stone-300 dark:border-stone-600"
        )}
      >
        {checked && "\u2713"}
      </span>
      <span className="dark:text-stone-200">
        {ingredient.group && (
          <span className="font-medium text-stone-500 dark:text-stone-400">
            {ingredient.group}:{" "}
          </span>
        )}
        {display}
      </span>
    </li>
  );
}
