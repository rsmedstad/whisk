import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { nanoid } from "nanoid";
import type { Recipe, Ingredient, Step } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TextArea } from "../ui/TextArea";
import { TagChip } from "../ui/TagChip";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { parseTimerFromText } from "../../lib/utils";

interface RecipeFormProps {
  allTags: string[];
  onAddTag: (name: string) => Promise<void>;
}

const EMPTY_INGREDIENT: Ingredient = { name: "", amount: "", unit: "" };
const EMPTY_STEP: Step = { text: "" };

export function RecipeForm({ allTags, onAddTag }: RecipeFormProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe, createRecipe, updateRecipe } = useRecipes();
  const isEditing = !!id && id !== "new";

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { ...EMPTY_INGREDIENT },
  ]);
  const [steps, setSteps] = useState<Step[]>([{ ...EMPTY_STEP }]);
  const [prepTime, setPrepTime] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [servings, setServings] = useState("");
  const [yieldStr, setYieldStr] = useState("");
  const [difficulty, setDifficulty] = useState<Recipe["difficulty"]>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [cuisine, setCuisine] = useState("");
  const [notes, setNotes] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [newTag, setNewTag] = useState("");

  // Load existing recipe for editing
  useEffect(() => {
    if (!isEditing || !id) return;
    getRecipe(id)
      .then((r) => {
        setTitle(r.title);
        setDescription(r.description ?? "");
        setIngredients(
          r.ingredients.length ? r.ingredients : [{ ...EMPTY_INGREDIENT }]
        );
        setSteps(r.steps.length ? r.steps : [{ ...EMPTY_STEP }]);
        setPrepTime(r.prepTime?.toString() ?? "");
        setCookTime(r.cookTime?.toString() ?? "");
        setServings(r.servings?.toString() ?? "");
        setYieldStr(r.yield ?? "");
        setDifficulty(r.difficulty);
        setTags(r.tags);
        setCuisine(r.cuisine ?? "");
        setNotes(r.notes ?? "");
        setVideoUrl(r.videoUrl ?? "");
      })
      .catch(() => navigate("/"))
      .finally(() => setIsLoading(false));
  }, [isEditing, id, getRecipe, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      const recipeData = {
        title: title.trim(),
        description: description.trim() || undefined,
        ingredients: ingredients.filter((i) => i.name.trim()),
        steps: steps
          .filter((s) => s.text.trim())
          .map((s) => ({
            ...s,
            timerMinutes: s.timerMinutes ?? parseTimerFromText(s.text) ?? undefined,
          })),
        favorite: false,
        photos: [],
        tags,
        cuisine: cuisine.trim() || undefined,
        prepTime: prepTime ? parseInt(prepTime) : undefined,
        cookTime: cookTime ? parseInt(cookTime) : undefined,
        servings: servings ? parseInt(servings) : undefined,
        yield: yieldStr.trim() || undefined,
        difficulty,
        notes: notes.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        source: importUrl
          ? {
              type: "url" as const,
              url: importUrl,
              domain: new URL(importUrl).hostname,
            }
          : { type: "manual" as const },
      };

      if (isEditing && id) {
        await updateRecipe(id, recipeData);
        navigate(`/recipes/${id}`);
      } else {
        const created = await createRecipe(recipeData);
        navigate(`/recipes/${created.id}`);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const updateIngredient = (
    index: number,
    field: keyof Ingredient,
    value: string
  ) => {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    );
  };

  const addIngredient = () =>
    setIngredients((prev) => [...prev, { ...EMPTY_INGREDIENT }]);

  const removeIngredient = (index: number) =>
    setIngredients((prev) => prev.filter((_, i) => i !== index));

  const updateStep = (index: number, text: string) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, text } : s))
    );
  };

  const addStep = () => setSteps((prev) => [...prev, { ...EMPTY_STEP }]);

  const removeStep = (index: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== index));

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAddNewTag = async () => {
    const name = newTag.trim().toLowerCase();
    if (!name || allTags.includes(name)) {
      if (name && !tags.includes(name)) toggleTag(name);
      setNewTag("");
      return;
    }
    await onAddTag(name);
    toggleTag(name);
    setNewTag("");
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    try {
      const res = await fetch(`/api/import/url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({ url: importUrl }),
      });
      if (!res.ok) throw new Error("Import failed");
      const data = (await res.json()) as Record<string, unknown>;
      if (data.title) setTitle(data.title as string);
      if (data.description) setDescription(data.description as string);
      if (Array.isArray(data.ingredients) && data.ingredients.length) setIngredients(data.ingredients as Ingredient[]);
      if (Array.isArray(data.steps) && data.steps.length) setSteps(data.steps as Step[]);
      if (data.prepTime) setPrepTime(String(data.prepTime));
      if (data.cookTime) setCookTime(String(data.cookTime));
      if (data.servings) setServings(String(data.servings));
    } catch {
      alert("Could not import from that URL. Try adding manually.");
    }
  };

  if (isLoading) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-30 flex items-center justify-between bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <button
          onClick={() => navigate(-1)}
          className="text-stone-600 dark:text-stone-400 text-sm font-medium"
        >
          &#8592; Cancel
        </button>
        <h1 className="font-semibold dark:text-stone-100">
          {isEditing ? "Edit Recipe" : "New Recipe"}
        </h1>
        <Button size="sm" onClick={handleSubmit} disabled={isSaving || !title.trim()}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-6">
        {/* Title & Description */}
        <div className="space-y-3">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Recipe name"
            required
            autoFocus
          />
          <TextArea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary"
            rows={2}
          />
        </div>

        {/* Ingredients */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Ingredients
          </h2>
          <div className="space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Amt"
                  value={ing.amount ?? ""}
                  onChange={(e) => updateIngredient(i, "amount", e.target.value)}
                />
                <input
                  className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Unit"
                  value={ing.unit ?? ""}
                  onChange={(e) => updateIngredient(i, "unit", e.target.value)}
                />
                <input
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Ingredient name"
                  value={ing.name}
                  onChange={(e) => updateIngredient(i, "name", e.target.value)}
                />
                {ingredients.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeIngredient(i)}
                    className="p-2 text-stone-400 hover:text-red-500"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={addIngredient}
          >
            + Add Ingredient
          </Button>
        </section>

        {/* Steps */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Steps
          </h2>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="mt-2 text-sm font-medium text-stone-400 w-6 text-right">
                  {i + 1}.
                </span>
                <textarea
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm resize-none dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Describe this step..."
                  value={step.text}
                  onChange={(e) => updateStep(i, e.target.value)}
                  rows={2}
                />
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    className="p-2 text-stone-400 hover:text-red-500"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={addStep}
          >
            + Add Step
          </Button>
        </section>

        {/* Details */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Details
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Prep Time (min)"
              type="number"
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value)}
              placeholder="15"
            />
            <Input
              label="Cook Time (min)"
              type="number"
              value={cookTime}
              onChange={(e) => setCookTime(e.target.value)}
              placeholder="45"
            />
            <Input
              label="Servings"
              type="number"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="4"
            />
            <Input
              label="Yield"
              value={yieldStr}
              onChange={(e) => setYieldStr(e.target.value)}
              placeholder="2 loaves"
            />
          </div>

          <div className="mt-3">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Difficulty
            </label>
            <div className="flex gap-2">
              {(["easy", "medium", "hard"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(difficulty === d ? undefined : d)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${
                    difficulty === d
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tags */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Tags
          </h2>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {allTags.slice(0, 20).map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                size="sm"
                selected={tags.includes(tag)}
                onToggle={() => toggleTag(tag)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              placeholder="Add custom tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddNewTag();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleAddNewTag}
            >
              Add
            </Button>
          </div>
        </section>

        {/* Cuisine */}
        <Input
          label="Cuisine"
          value={cuisine}
          onChange={(e) => setCuisine(e.target.value)}
          placeholder="Italian, Mexican, etc."
        />

        {/* Notes */}
        <TextArea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Personal tips, tweaks, substitution history..."
          rows={3}
        />

        {/* Video URL */}
        <Input
          label="Video URL (optional)"
          type="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://youtube.com/..."
        />

        {/* Import from URL */}
        {!isEditing && (
          <section>
            <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
              Import from URL
            </h2>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                placeholder="https://allrecipes.com/..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleImportUrl}
              >
                Import
              </Button>
            </div>
          </section>
        )}
      </form>
    </div>
  );
}
