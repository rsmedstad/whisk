import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { parseCsv, categoryToTags, isUrl, detectDelimiter } from "../../lib/csv";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import type { CsvRow, ImportResult } from "../../types";
import { ChevronLeft, Check, XMark, Sparkles } from "../ui/Icon";

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

interface ParsedEntry {
  title: string;
  url?: string;
  notes?: string;
  category?: string;
}

interface ImportRecipesProps {
  onImportComplete: () => void;
}

type ImportMode = "input" | "preview" | "importing" | "done";

export function ImportRecipes({ onImportComplete }: ImportRecipesProps) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [inputText, setInputText] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [mode, setMode] = useState<ImportMode>("input");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [usedAI, setUsedAI] = useState(false);

  const urlCount = rows.filter((r) => isUrl(r.recipeLink)).length;
  const textCount = rows.length - urlCount;

  /** Try structured CSV/TSV parsing first. Returns true if it found good data. */
  const tryStructuredParse = useCallback((text: string): boolean => {
    const parsed = parseCsv(text);
    const validRows = parsed.filter((r) => r.dishName);

    if (validRows.length >= 1) {
      // Check quality: at least some rows should have more than just a dish name
      const hasStructure = validRows.some(
        (r) => r.category || r.recipeLink || r.notes || r.ingredientNotes
      );
      // If it looks like a structured spreadsheet export with headers
      const delimiter = detectDelimiter(text);
      const firstLine = text.split("\n")[0] ?? "";
      const fields = delimiter === "\t" ? firstLine.split("\t") : firstLine.split(",");
      const looksStructured = fields.length >= 2 && hasStructure;

      if (looksStructured || validRows.length >= 2) {
        setRows(validRows);
        setUsedAI(false);
        setMode("preview");
        return true;
      }
    }
    return false;
  }, []);

  /** Fall back to AI parsing for unstructured text. */
  const aiParse = useCallback(async (text: string) => {
    setIsParsing(true);
    setParseError("");
    try {
      const result = await api.post<{ entries: ParsedEntry[]; error?: string }>(
        "/import/parse",
        { text }
      );

      if (result.error) {
        setParseError(result.error);
        setIsParsing(false);
        return;
      }

      if (!result.entries || result.entries.length === 0) {
        setParseError("No recipes found in the text. Try a different format or paste recipe names one per line.");
        setIsParsing(false);
        return;
      }

      // Convert AI parsed entries to CsvRow format for unified import flow
      const csvRows: CsvRow[] = result.entries.map((e) => ({
        category: e.category ?? "",
        dishName: e.title,
        recipeLink: e.url ?? "",
        notes: e.notes ?? "",
        ingredientNotes: "",
      }));

      setRows(csvRows);
      setUsedAI(true);
      setMode("preview");
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Failed to parse with AI"
      );
    }
    setIsParsing(false);
  }, []);

  /** Main parse handler: try structured first, then AI. */
  const handleParse = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    // Try structured CSV/TSV parsing first
    if (tryStructuredParse(text)) return;

    // Fall back to AI parsing
    await aiParse(text);
  }, [inputText, tryStructuredParse, aiParse]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Detect Whisk JSON export and redirect to Import Book in Settings
      if (file.name.endsWith(".json")) {
        setParseError("This looks like a Whisk export file (.json). To import it, go to Settings > Data > Import Book.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setInputText(reader.result);
        }
      };
      reader.readAsText(file);
    },
    []
  );

  const handleImport = useCallback(async () => {
    if (rows.length === 0) return;
    setMode("importing");

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
            lastCrawledAt: new Date().toISOString(),
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

    setMode("done");
    onImportComplete();
  }, [rows, onImportComplete]);

  const handleBack = useCallback(() => {
    setMode("input");
    setRows([]);
    setResults([]);
    setParseError("");
    setUsedAI(false);
  }, []);

  const successCount = results.filter((r) => r.status === "created").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  const currentIndex = results.findIndex((r) => r.status === "importing");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-(--sat)">
        <div className="flex items-center gap-3 py-3">
          <button
            onClick={() => (mode === "preview" ? handleBack() : navigate(-1))}
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
        {/* ── Input mode ── */}
        {mode === "input" && (
          <>
            {/* Instructions */}
            <div className="text-sm text-stone-600 dark:text-stone-400 space-y-2">
              <p className="font-medium text-stone-800 dark:text-stone-200">
                Import your recipes from any format
              </p>
              <p>
                Paste content from Google Sheets, Excel, a text document, notes
                app, or any list of recipes. Whisk will automatically detect the
                format. To import a Whisk export (.json), use Settings &gt; Data &gt; Import Book.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {["Google Sheets", "Excel / CSV", "Plain text", "Notes"].map(
                  (label) => (
                    <span
                      key={label}
                      className="px-2 py-0.5 rounded-full text-xs border border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
                    >
                      {label}
                    </span>
                  )
                )}
              </div>
            </div>

            {/* Text input */}
            <div className="space-y-3">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Paste your recipe list here...\n\nExamples:\n• A spreadsheet with columns: Category, Name, URL, Notes\n• A plain text list of recipe names\n• Recipe names with links, one per line`}
                className="w-full h-40 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-mono placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 resize-none"
              />
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  Upload file
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  .csv, .tsv, .txt
                </span>
              </div>
            </div>

            {/* Parse error */}
            {parseError && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-700 dark:text-red-300">
                  {parseError}
                </p>
              </div>
            )}

            {/* Parse button */}
            {inputText.trim().length > 0 && (
              <Button fullWidth onClick={handleParse} disabled={isParsing}>
                {isParsing ? (
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    Analyzing with AI...
                  </span>
                ) : (
                  "Find Recipes"
                )}
              </Button>
            )}
          </>
        )}

        {/* ── Preview mode ── */}
        {mode === "preview" && (
          <div className="space-y-3">
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                  Found {rows.length} recipes
                </p>
                {usedAI && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    <Sparkles className="w-3 h-3" />
                    AI
                  </span>
                )}
              </div>
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
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm py-1.5 px-2 rounded"
                >
                  <span className="text-xs text-stone-400 w-5 text-right shrink-0">
                    {i + 1}
                  </span>
                  <span className="truncate dark:text-stone-200">
                    {row.dishName}
                  </span>
                  <div className="flex gap-1 shrink-0 ml-auto">
                    {row.category && (
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        {row.category}
                      </span>
                    )}
                    {isUrl(row.recipeLink) && (
                      <span className="text-xs text-orange-500">URL</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleBack}
              >
                Back
              </Button>
              <Button className="flex-1" onClick={handleImport}>
                Import {rows.length} Recipes
              </Button>
            </div>
          </div>
        )}

        {/* ── Import progress / Done ── */}
        {(mode === "importing" || mode === "done") && results.length > 0 && (
          <div className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-stone-600 dark:text-stone-400">
                  {mode === "done"
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
            {mode === "done" && (
              <div className="flex gap-3 pt-2">
                <Button fullWidth onClick={() => navigate("/")}>
                  View Recipes
                </Button>
                {failCount > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMode("input");
                      setResults([]);
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
