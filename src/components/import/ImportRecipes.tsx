import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { parseCsv, categoryToTags, isUrl } from "../../lib/csv";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import type { CsvRow, ImportResult } from "../../types";
import { ChevronLeft, Check, XMark } from "../ui/Icon";

interface ScrapedRecipe {
  title: string;
  description?: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  thumbnailUrl?: string;
  photos?: { url: string; isPrimary: boolean }[];
}

interface ImportRecipesProps {
  onImportComplete: () => void;
}

export function ImportRecipes({ onImportComplete }: ImportRecipesProps) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csvText, setCsvText] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const urlCount = rows.filter((r) => isUrl(r.recipeLink)).length;
  const textCount = rows.length - urlCount;

  const handleParse = useCallback((text: string) => {
    setCsvText(text);
    const parsed = parseCsv(text);
    setRows(parsed.filter((r) => r.dishName));
    setResults([]);
    setIsDone(false);
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          handleParse(reader.result);
        }
      };
      reader.readAsText(file);
    },
    [handleParse]
  );

  const handleImport = useCallback(async () => {
    if (rows.length === 0) return;
    setIsImporting(true);
    setIsDone(false);

    const importResults: ImportResult[] = rows.map((r) => ({
      title: r.dishName,
      status: "pending" as const,
    }));
    setResults([...importResults]);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      importResults[i] = { ...importResults[i]!, status: "importing" };
      setResults([...importResults]);

      try {
        const tags = categoryToTags(row.category);
        const notesParts: string[] = [];
        if (row.notes) notesParts.push(row.notes);
        if (row.ingredientNotes)
          notesParts.push(`Ingredients: ${row.ingredientNotes}`);

        if (isUrl(row.recipeLink)) {
          // Scrape URL and download image
          const scraped = await api.post<ScrapedRecipe>("/import/url", {
            url: row.recipeLink,
            downloadImage: true,
          });

          await api.post("/recipes", {
            title: scraped.title || row.dishName,
            description: scraped.description,
            ingredients: scraped.ingredients,
            steps: scraped.steps,
            prepTime: scraped.prepTime,
            cookTime: scraped.cookTime,
            servings: scraped.servings,
            thumbnailUrl: scraped.thumbnailUrl,
            photos: scraped.photos ?? [],
            tags,
            notes: notesParts.join("\n\n") || undefined,
            source: {
              type: "url",
              url: row.recipeLink,
              domain: new URL(row.recipeLink).hostname,
            },
            favorite: false,
          });
        } else {
          // Create stub recipe
          await api.post("/recipes", {
            title: row.dishName,
            ingredients: [],
            steps: row.recipeLink ? [{ text: row.recipeLink }] : [],
            tags,
            notes: notesParts.join("\n\n") || undefined,
            source: { type: "manual" },
            photos: [],
            favorite: false,
          });
        }

        importResults[i] = { ...importResults[i]!, status: "created" };
      } catch (err) {
        importResults[i] = {
          ...importResults[i]!,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }

      setResults([...importResults]);
    }

    setIsImporting(false);
    setIsDone(true);
    onImportComplete();
  }, [rows, onImportComplete]);

  const successCount = results.filter((r) => r.status === "created").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  const currentIndex = results.findIndex((r) => r.status === "importing");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-(--sat)">
        <div className="flex items-center gap-3 py-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold dark:text-stone-100">
            Import Recipes
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4">
        {/* Instructions */}
        {!isDone && rows.length === 0 && (
          <div className="text-sm text-stone-600 dark:text-stone-400 space-y-2">
            <p className="font-medium text-stone-800 dark:text-stone-200">
              Import from Google Sheets or CSV
            </p>
            <p>
              Export your Google Sheet as CSV, then paste the contents below or
              upload the file. Expected columns:
            </p>
            <div className="bg-stone-50 dark:bg-stone-800 rounded-lg p-3 text-xs font-mono">
              Category, Dish Name, Recipe/Link, Notes, Ingredients
            </div>
            <p>
              Recipes with URLs will be scraped for full details and images.
            </p>
          </div>
        )}

        {/* Input area */}
        {!isImporting && !isDone && (
          <div className="space-y-3">
            <textarea
              value={csvText}
              onChange={(e) => handleParse(e.target.value)}
              placeholder="Paste CSV content here..."
              className="w-full h-32 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-mono placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 resize-none"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                Upload CSV file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              {rows.length > 0 && (
                <span className="text-sm text-stone-500 dark:text-stone-400">
                  {rows.length} recipes found
                </span>
              )}
            </div>
          </div>
        )}

        {/* Preview */}
        {rows.length > 0 && !isImporting && !isDone && (
          <div className="space-y-3">
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
              <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                Ready to import {rows.length} recipes
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                {urlCount > 0 && (
                  <span>
                    {urlCount} with URLs (will scrape for details + images)
                  </span>
                )}
                {urlCount > 0 && textCount > 0 && <span> · </span>}
                {textCount > 0 && <span>{textCount} text-only</span>}
              </p>
              {urlCount > 0 && (
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                  URL imports take a few seconds each
                </p>
              )}
            </div>

            {/* Preview list */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm py-1 px-2 rounded"
                >
                  <span className="text-xs text-stone-400 w-5 text-right shrink-0">
                    {i + 1}
                  </span>
                  <span className="truncate dark:text-stone-200">
                    {row.dishName}
                  </span>
                  {isUrl(row.recipeLink) && (
                    <span className="text-xs text-orange-500 shrink-0">
                      URL
                    </span>
                  )}
                </div>
              ))}
            </div>

            <Button fullWidth onClick={handleImport}>
              Start Import
            </Button>
          </div>
        )}

        {/* Progress */}
        {(isImporting || isDone) && results.length > 0 && (
          <div className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600 dark:text-stone-400">
                  {isDone
                    ? `Done — ${successCount} imported${failCount > 0 ? `, ${failCount} failed` : ""}`
                    : `Importing ${currentIndex >= 0 ? currentIndex + 1 : successCount + failCount} of ${results.length}...`}
                </span>
                <span className="text-stone-500 dark:text-stone-400">
                  {Math.round(
                    ((successCount + failCount) / results.length) * 100
                  )}
                  %
                </span>
              </div>
              <div className="h-2 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${((successCount + failCount) / results.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Results list */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map((result, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm py-1 px-2 rounded"
                >
                  <span className="w-5 flex justify-center shrink-0">
                    {result.status === "created" && (
                      <Check className="w-4 h-4 text-green-500" />
                    )}
                    {result.status === "failed" && (
                      <XMark className="w-4 h-4 text-red-500" />
                    )}
                    {result.status === "importing" && (
                      <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                    )}
                    {result.status === "pending" && (
                      <span className="w-2 h-2 rounded-full bg-stone-300 dark:bg-stone-600" />
                    )}
                  </span>
                  <span
                    className={`truncate ${result.status === "failed" ? "text-red-500" : "dark:text-stone-200"}`}
                  >
                    {result.title}
                  </span>
                  {result.error && (
                    <span className="text-xs text-red-400 truncate shrink-0 max-w-32">
                      {result.error}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Done actions */}
            {isDone && (
              <div className="flex gap-3 pt-2">
                <Button fullWidth onClick={() => navigate("/")}>
                  View Recipes
                </Button>
                {failCount > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setIsDone(false);
                      setResults([]);
                      // Keep only failed rows for retry
                      const failedRows = rows.filter(
                        (_, i) => results[i]?.status === "failed"
                      );
                      setRows(failedRows);
                    }}
                  >
                    Retry Failed
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
