import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { TextArea } from "../ui/TextArea";
import { Card } from "../ui/Card";
import { Camera, Sparkles } from "../ui/Icon";

interface IdentifyPhotoProps {
  visionEnabled?: boolean;
}

export function IdentifyPhoto({ visionEnabled = false }: IdentifyPhotoProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [result, setResult] = useState<{
    title: string;
    confidence: string;
    ingredients: string[];
    description?: string;
    cuisine?: string;
    tags?: string[];
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setResult(null);
  };

  const handleIdentify = async () => {
    if (!fileInputRef.current?.files?.[0]) return;

    setIsIdentifying(true);
    try {
      const formData = new FormData();
      formData.append("photo", fileInputRef.current.files[0]);
      if (context.trim()) formData.append("context", context.trim());

      const res = await fetch("/api/identify/photo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: formData,
      });

      if (!res.ok) throw new Error("Identification failed");
      const data = (await res.json()) as { title: string; confidence: string; ingredients: string[]; description?: string; cuisine?: string; tags?: string[] };
      setResult(data);
    } catch {
      setResult({
        title: "Could not identify",
        confidence: "Low",
        ingredients: [],
      });
    } finally {
      setIsIdentifying(false);
    }
  };

  const handleSaveAsRecipe = () => {
    if (!result) return;
    // Navigate to recipe form with pre-filled data including tags
    const params = new URLSearchParams({
      title: result.title,
      ingredients: result.ingredients.join(","),
    });
    if (result.description) params.set("description", result.description);
    if (result.cuisine) params.set("cuisine", result.cuisine);
    if (result.tags?.length) params.set("tags", result.tags.join(","));
    params.set("from", "identify");
    navigate(`/recipes/new?${params.toString()}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <h1 className="text-xl font-bold dark:text-stone-100">Identify</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4">
        {/* AI status banner */}
        {!visionEnabled && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Photo recognition not configured
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Ask your book admin to add a vision API key (XAI_API_KEY) to enable this feature.
              You can still take photos and save them manually.
            </p>
          </div>
        )}

        {/* Photo capture */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="aspect-video rounded-xl border-2 border-dashed border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 flex flex-col items-center justify-center cursor-pointer overflow-hidden"
        >
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-center">
              <Camera className="w-10 h-10 text-stone-400 dark:text-stone-500 mx-auto" />
              <p className="mt-2 text-sm font-medium text-stone-500 dark:text-stone-400">
                Take Photo
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                or tap to pick from gallery
              </p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <TextArea
          label="Add context (optional)"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={'"This is my mom\'s pot roast recipe, about 6 servings"'}
          rows={2}
        />

        <Button
          fullWidth
          onClick={handleIdentify}
          disabled={!preview || isIdentifying}
        >
          {isIdentifying ? "Identifying..." : "Identify This"}
        </Button>

        {/* Result */}
        {result && (
          <Card>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Sparkles className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    This looks like:
                  </p>
                  <h3 className="text-lg font-bold dark:text-stone-100">
                    {result.title}
                  </h3>
                  <p className="text-xs text-stone-400">
                    Confidence: {result.confidence}
                  </p>
                </div>
              </div>

              {result.ingredients.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-stone-600 dark:text-stone-300 mb-1">
                    Detected ingredients:
                  </p>
                  <ul className="space-y-0.5">
                    {result.ingredients.map((ing, i) => (
                      <li
                        key={i}
                        className="text-sm text-stone-600 dark:text-stone-400 flex gap-1.5 items-center"
                      >
                        <span className="w-1 h-1 rounded-full bg-stone-400 shrink-0" /> {ing}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSaveAsRecipe} size="sm">
                  Save as Recipe
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setResult(null);
                    setPreview(null);
                  }}
                >
                  Try Again
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
