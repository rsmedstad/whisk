import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Recipe, RecipePhoto, Ingredient, Step } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { getLocal, CACHE_KEYS } from "../../lib/cache";
import { compressImage } from "../../lib/compress";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TextArea } from "../ui/TextArea";
import { TagChip } from "../ui/TagChip";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { parseTimerFromText } from "../../lib/utils";
import { ChevronLeft, XMark, Plus, Camera, Sparkles, Link } from "../ui/Icon";

interface RecipeFormProps {
  allTags: string[];
  onAddTag: (name: string) => Promise<void>;
  chatEnabled?: boolean;
}

const EMPTY_INGREDIENT: Ingredient = { name: "", amount: "", unit: "" };
const EMPTY_STEP: Step = { text: "" };
const CUISINE_TAGS = new Set(["italian", "mexican", "chinese", "thai", "indian", "japanese", "korean", "mediterranean", "american", "french"]);

export function RecipeForm({ allTags, onAddTag, chatEnabled }: RecipeFormProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getRecipe, createRecipe, updateRecipe } = useRecipes();
  const isEditing = !!id && id !== "new";
  const importTriggered = useRef(false);

  // Cache-first: load recipe from localStorage synchronously for instant paint
  const cachedRecipe = isEditing && id ? getLocal<Recipe>(CACHE_KEYS.RECIPE(id)) : null;

  const [isLoading, setIsLoading] = useState(isEditing && !cachedRecipe);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showManualForm, setShowManualForm] = useState(isEditing || !!searchParams.get("url"));

  // Form state — pre-populate from cache if editing
  const [title, setTitle] = useState(cachedRecipe?.title ?? "");
  const [description, setDescription] = useState(cachedRecipe?.description ?? "");
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    cachedRecipe?.ingredients?.length ? cachedRecipe.ingredients : [{ ...EMPTY_INGREDIENT }]
  );
  const [steps, setSteps] = useState<Step[]>(
    cachedRecipe?.steps?.length ? cachedRecipe.steps : [{ ...EMPTY_STEP }]
  );
  const [prepTime, setPrepTime] = useState(cachedRecipe?.prepTime?.toString() ?? "");
  const [cookTime, setCookTime] = useState(cachedRecipe?.cookTime?.toString() ?? "");
  const [servings, setServings] = useState(cachedRecipe?.servings?.toString() ?? "");
  const [yieldStr, setYieldStr] = useState(cachedRecipe?.yield ?? "");
  const [difficulty, setDifficulty] = useState<Recipe["difficulty"]>(cachedRecipe?.difficulty);
  const [tags, setTags] = useState<string[]>(cachedRecipe?.tags ?? []);
  const [cuisine, setCuisine] = useState(cachedRecipe?.cuisine ?? "");
  const [notes, setNotes] = useState(cachedRecipe?.notes ?? "");
  const [videoUrl, setVideoUrl] = useState(cachedRecipe?.videoUrl ?? "");
  const [importUrl, setImportUrl] = useState("");
  const [importStep, setImportStep] = useState("");
  const [sourceText, setSourceText] = useState(cachedRecipe?.source?.type === "manual" ? "" : "");
  const [newTag, setNewTag] = useState("");
  const [photos, setPhotos] = useState<RecipePhoto[]>(cachedRecipe?.photos ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAutoTags = async (t: string, desc: string, ings: Ingredient[]) => {
    if (!chatEnabled) return;
    try {
      const res = await fetch("/api/ai/auto-tag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({
          title: t,
          description: desc,
          ingredients: ings.filter((i) => (i.name ?? "").trim()).map((i) => i.name),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tags?: string[]; difficulty?: Recipe["difficulty"] };
      if (Array.isArray(data.tags)) {
        setTags((prev) => [...new Set([...prev, ...data.tags!])]);
      }
      if (data.difficulty && !difficulty) {
        setDifficulty(data.difficulty);
      }
    } catch {
      // Silent fail
    }
  };

  // Fire-and-forget: auto-tag a newly created recipe in the background
  const autoTagAfterSave = (recipeId: string, existingTags: string[], existingDifficulty: Recipe["difficulty"], t: string, desc: string, ings: Ingredient[]) => {
    if (!chatEnabled) return;
    // Only auto-tag if no non-speed tags exist
    const SPEED_TAGS = ["quick", "under 30 min", "under 15 min"];
    const hasMeaningfulTags = existingTags.some((tag) => !SPEED_TAGS.includes(tag));
    if (hasMeaningfulTags && existingDifficulty) return;
    (async () => {
      try {
        const res = await fetch("/api/ai/auto-tag", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
          },
          body: JSON.stringify({
            title: t,
            description: desc,
            ingredients: ings.filter((i) => (i.name ?? "").trim()).map((i) => i.name),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { tags?: string[]; difficulty?: Recipe["difficulty"] };
        const updates: Partial<Recipe> = {};
        if (Array.isArray(data.tags) && data.tags.length > 0 && !hasMeaningfulTags) {
          updates.tags = [...new Set([...existingTags, ...data.tags])];
        }
        if (data.difficulty && !existingDifficulty) {
          updates.difficulty = data.difficulty;
        }
        if (Object.keys(updates).length > 0) {
          await updateRecipe(recipeId, updates);
        }
      } catch {
        // Silent fail — recipe was saved, tags are just a bonus
      }
    })();
  };

  // Background refresh for edit mode — update fields if server has newer data
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
        setPhotos(r.photos ?? []);
      })
      .catch(() => { if (!cachedRecipe) navigate("/"); })
      .finally(() => setIsLoading(false));
  }, [isEditing, id, getRecipe, navigate]);

  // Auto-import from ?url= query param (e.g. from Suggest page)
  useEffect(() => {
    let urlParam = searchParams.get("url")?.trim();
    if (!urlParam || isEditing || importTriggered.current) return;
    // Auto-add https:// if no protocol
    if (!/^https?:\/\//i.test(urlParam)) urlParam = `https://${urlParam}`;
    importTriggered.current = true;
    setImportUrl(urlParam);
    // Trigger import automatically
    (async () => {
      try {
        const res = await fetch(`/api/import/url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
          },
          body: JSON.stringify({ url: urlParam, downloadImage: true }),
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
        if (Array.isArray(data.photos) && data.photos.length) {
          setPhotos(data.photos as RecipePhoto[]);
        }
        // Apply server-side tags from JSON-LD extraction
        if (Array.isArray(data.tags) && data.tags.length) {
          setTags((prev) => [...new Set([...prev, ...(data.tags as string[])])]);
        }
        // Also request AI auto-tags for richer tagging
        if (data.title) {
          fetchAutoTags(
            data.title as string,
            (data.description as string) ?? "",
            Array.isArray(data.ingredients) ? (data.ingredients as Ingredient[]) : [],
          );
        }
      } catch {
        // Silent fail — user can still manually import or fill in
      }
    })();
  }, [searchParams, isEditing]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      const recipeData = {
        title: title.trim(),
        description: description.trim() || undefined,
        ingredients: ingredients.filter((i) => (i.name ?? "").trim()),
        steps: steps
          .filter((s) => (s.text ?? "").trim())
          .map((s) => ({
            ...s,
            timerMinutes: s.timerMinutes ?? parseTimerFromText(s.text) ?? undefined,
          })),
        favorite: false,
        photos,
        thumbnailUrl: photos.find((p) => p.isPrimary)?.url ?? photos[0]?.url,
        tags,
        cuisine: cuisine.trim() || tags.find((t) => CUISINE_TAGS.has(t)) || undefined,
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
          : sourceText.trim()
            ? sourceText.trim().startsWith("http")
              ? { type: "url" as const, url: sourceText.trim(), domain: new URL(sourceText.trim()).hostname }
              : { type: "manual" as const, attribution: sourceText.trim() }
            : { type: "manual" as const },
        ...(importUrl ? { lastCrawledAt: new Date().toISOString() } : {}),
      };

      if (isEditing && id) {
        await updateRecipe(id, recipeData);
        navigate(`/recipes/${id}`, { replace: true });
      } else {
        const created = await createRecipe(recipeData);
        // Auto-tag in background after save (non-blocking)
        if (chatEnabled && title.trim()) {
          autoTagAfterSave(created.id, recipeData.tags ?? [], recipeData.difficulty, title.trim(), description.trim(), recipeData.ingredients);
        }
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

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        // Compress before upload
        const compressed = await compressImage(file, "hero");
        const form = new FormData();
        form.append("file", compressed, `photo-${Date.now()}.webp`);

        const res = await fetch("/api/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
          },
          body: form,
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { url: string };
        setPhotos((prev) => [
          ...prev,
          { url: data.url, isPrimary: prev.length === 0 },
        ]);
      }
    } catch {
      alert("Failed to upload photo");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // If we removed the primary, make the first one primary
      if (next.length > 0 && !next.some((p) => p.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return next;
    });
  };

  const setPrimaryPhoto = (index: number) => {
    setPhotos((prev) =>
      prev.map((p, i) => ({ ...p, isPrimary: i === index }))
    );
  };

  const movePhoto = (index: number, direction: -1 | 1) => {
    setPhotos((prev) => {
      const next = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const temp = next[targetIndex]!;
      next[targetIndex] = next[index]!;
      next[index] = temp;
      return next;
    });
  };

  const handleImportUrl = async () => {
    let url = importUrl.trim();
    if (!url) return;
    // Auto-add https:// if no protocol
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setImportUrl(url);
    setIsImporting(true);

    // Detect Instagram for progress messaging
    const isInstagram = /instagram\.com|instagr\.am/i.test(url);
    setImportStep(isInstagram ? "Fetching Instagram post..." : "Fetching recipe page...");

    // Simulate progress steps while waiting for the single API call
    const stepTimer = setTimeout(() => {
      setImportStep(isInstagram ? "Extracting caption and images..." : "Extracting recipe data...");
    }, isInstagram ? 8000 : 3000);
    const stepTimer2 = setTimeout(() => {
      setImportStep(isInstagram ? "Parsing recipe with AI..." : "Processing ingredients and steps...");
    }, isInstagram ? 20000 : 8000);
    const stepTimer3 = setTimeout(() => {
      setImportStep("Almost done...");
    }, isInstagram ? 40000 : 15000);

    try {
      const res = await fetch(`/api/import/url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({ url, downloadImage: true }),
      });
      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      if (!res.ok) {
        const errData = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errData?.error ?? "Import failed");
      }
      setImportStep("Populating recipe fields...");
      const data = (await res.json()) as Record<string, unknown>;
      if (data.title) setTitle(data.title as string);
      if (data.description) setDescription(data.description as string);
      if (Array.isArray(data.ingredients) && data.ingredients.length) setIngredients(data.ingredients as Ingredient[]);
      if (Array.isArray(data.steps) && data.steps.length) setSteps(data.steps as Step[]);
      if (data.prepTime) setPrepTime(String(data.prepTime));
      if (data.cookTime) setCookTime(String(data.cookTime));
      if (data.servings) setServings(String(data.servings));
      if (Array.isArray(data.photos) && data.photos.length) {
        setPhotos(data.photos as RecipePhoto[]);
      }
      // Apply server-side tags from JSON-LD extraction
      if (Array.isArray(data.tags) && data.tags.length) {
        setTags((prev) => [...new Set([...prev, ...(data.tags as string[])])]);
      }
      // Also request AI auto-tags for richer tagging
      if (data.title) {
        fetchAutoTags(
          data.title as string,
          (data.description as string) ?? "",
          Array.isArray(data.ingredients) ? (data.ingredients as Ingredient[]) : [],
        );
      }
      // Show the form with populated data
      setShowManualForm(true);
    } catch (err) {
      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      // Import failed — switch to manual form with URL pre-filled as source
      setSourceText(importUrl);
      setShowManualForm(true);
      const msg = err instanceof Error ? err.message : "Import failed";
      alert(isInstagram
        ? `Could not import from Instagram: ${msg}`
        : `Could not import automatically: ${msg}. You can paste the recipe details manually.`);
    } finally {
      setIsImporting(false);
      setImportStep("");
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
          className="flex items-center gap-1 text-stone-600 dark:text-stone-400 text-sm font-medium"
        >
          <ChevronLeft className="w-4 h-4" /> Cancel
        </button>
        <h1 className="font-semibold dark:text-stone-100">
          {isEditing ? "Edit Recipe" : "New Recipe"}
        </h1>
        {showManualForm ? (
          <Button size="sm" onClick={handleSubmit} disabled={isSaving || !title.trim()}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        ) : (
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            aria-label="Close"
          >
            <XMark className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* ── URL Import (primary for new recipes) ── */}
      {!isEditing && !showManualForm && (
        <div className="px-4 py-6 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-orange-50 dark:bg-orange-950/50 mb-2">
              <Link className="w-7 h-7 text-orange-500" />
            </div>
            <h2 className="text-lg font-semibold dark:text-stone-100">Add from URL</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Paste a recipe link to import it with tags and analysis applied automatically
            </p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleImportUrl(); } }}
                placeholder="https://allrecipes.com/... or Instagram link"
                autoFocus
                enterKeyHint="go"
                className="w-full rounded-xl border border-stone-300 bg-white pl-10 pr-4 py-3 text-base placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
            </div>
            <Button
              fullWidth
              onClick={handleImportUrl}
              disabled={isImporting || !importUrl.trim()}
            >
              {isImporting ? (importStep || "Importing recipe...") : "Import Recipe"}
            </Button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center gap-4">
            <div className="flex-1 border-t border-stone-200 dark:border-stone-700" />
            <span className="text-xs text-stone-400 dark:text-stone-500 font-medium">or</span>
            <div className="flex-1 border-t border-stone-200 dark:border-stone-700" />
          </div>

          <Button
            variant="secondary"
            fullWidth
            onClick={() => setShowManualForm(true)}
          >
            Add Manually
          </Button>
        </div>
      )}

      {/* ── Manual Form ── */}
      {showManualForm && (
      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-6">
        {/* URL import bar (compact, when in manual mode for new recipes) */}
        {!isEditing && !importUrl && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="Import from URL..."
                enterKeyHint="go"
                className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleImportUrl}
              disabled={isImporting}
            >
              {isImporting ? "..." : "Import"}
            </Button>
          </div>
        )}

        {/* Title & Description */}
        <div className="space-y-3">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Recipe name"
            required
          />
          <TextArea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary"
            rows={2}
          />
        </div>

        {/* Photos */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Photos
          </h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handlePhotoUpload(e.target.files)}
          />
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {photos.map((photo, i) => (
              <div
                key={photo.url}
                className="relative shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-stone-200 dark:border-stone-700"
              >
                <img
                  src={photo.url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                {photo.isPrimary && (
                  <span className="absolute top-1 left-1 rounded bg-orange-500 px-1 py-0.5 text-[10px] font-bold text-white leading-none">
                    Cover
                  </span>
                )}
                <div className="absolute inset-0 flex items-end justify-center gap-1 bg-linear-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity">
                  {!photo.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setPrimaryPhoto(i)}
                      className="mb-1 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium"
                    >
                      Cover
                    </button>
                  )}
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => movePhoto(i, -1)}
                      className="mb-1 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium"
                    >
                      &larr;
                    </button>
                  )}
                  {i < photos.length - 1 && (
                    <button
                      type="button"
                      onClick={() => movePhoto(i, 1)}
                      className="mb-1 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium"
                    >
                      &rarr;
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
                >
                  <XMark className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="shrink-0 w-24 h-24 rounded-lg border-2 border-dashed border-stone-300 dark:border-stone-600 flex flex-col items-center justify-center gap-1 text-stone-400 hover:border-orange-400 hover:text-orange-500 transition-colors"
            >
              {isUploading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <Camera className="w-5 h-5" />
                  <span className="text-[10px] font-medium">Add Photo</span>
                </>
              )}
            </button>
          </div>
          {photos.length > 1 && (
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
              Tap a photo to set as cover. Drag or use arrows to reorder.
            </p>
          )}
        </section>

        {/* Ingredients */}
        <section>
          <h2 className="text-sm font-semibold mb-2 dark:text-stone-100">
            Ingredients
          </h2>
          <div className="space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Amt"
                  value={ing.amount ?? ""}
                  onChange={(e) => updateIngredient(i, "amount", e.target.value)}
                />
                <input
                  className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="Unit"
                  value={ing.unit ?? ""}
                  onChange={(e) => updateIngredient(i, "unit", e.target.value)}
                />
                <input
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-2 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
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
                    <XMark className="w-4 h-4" />
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
                    <XMark className="w-4 h-4" />
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
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold dark:text-stone-100">
              Tags
            </h2>
            {chatEnabled && (
              <button
                type="button"
                disabled={isAutoTagging || !title.trim()}
                onClick={async () => {
                  setIsAutoTagging(true);
                  await fetchAutoTags(title, description, ingredients);
                  setIsAutoTagging(false);
                }}
                className="wk-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900 disabled:opacity-50 transition-colors"
              >
                {isAutoTagging ? (
                  <span className="inline-block w-3 h-3 border border-orange-300 border-t-orange-600 rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                Auto-tag
              </button>
            )}
          </div>
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
              className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
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

        {/* Source */}
        {!isEditing && !importUrl && (
          <Input
            label="Source (optional)"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="URL, cookbook name, grandma's recipe..."
          />
        )}
        {importUrl && (
          <div className="text-xs text-stone-400 dark:text-stone-500">
            Imported from: <span className="text-stone-600 dark:text-stone-300">{importUrl}</span>
          </div>
        )}
      </form>
      )}
    </div>
  );
}
