import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Pencil, Globe, BookOpen, Check } from "../ui/Icon";
import { api } from "../../lib/api";

export function FirstRunGuide() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    errors: number;
    skipped: number;
  } | null>(null);
  const [importDone, setImportDone] = useState(false);

  const handleBookImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const recipes = (data.recipes ?? []) as Record<string, unknown>[];
      if (!Array.isArray(recipes) || recipes.length === 0) {
        alert("No recipes found in this file.");
        return;
      }

      setImportProgress({ done: 0, total: recipes.length, errors: 0, skipped: 0 });
      let errors = 0;
      let skipped = 0;
      for (let i = 0; i < recipes.length; i++) {
        try {
          const resp = await api.post<{ id?: string; skipped?: boolean }>("/import/book?mode=skip", recipes[i]);
          if (resp.skipped) skipped++;
        } catch {
          errors++;
        }
        setImportProgress({ done: i + 1, total: recipes.length, errors, skipped });
      }
      setImportDone(true);
    } catch {
      alert("Could not read this file. Make sure it's a valid Whisk export (.json).");
      setImportProgress(null);
    }
  };

  // Show import progress
  if (importProgress) {
    const { done, total, errors, skipped } = importProgress;
    const imported = done - errors - skipped;
    return (
      <div className="flex flex-col items-center py-8 px-4">
        <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-100 mb-2">
          {importDone ? "Import Complete" : "Importing Recipes..."}
        </h2>
        <div className="w-full max-w-sm mt-6 space-y-4">
          {/* Progress bar */}
          <div className="w-full bg-stone-200 dark:bg-stone-700 rounded-full h-2">
            <div
              className="bg-orange-500 h-2 rounded-full transition-all"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-300 text-center">
            {done} of {total} recipes processed
          </p>
          <div className="flex justify-center gap-4 text-xs text-stone-500 dark:text-stone-400">
            <span className="text-green-600 dark:text-green-400">{imported} imported</span>
            {skipped > 0 && <span>{skipped} skipped</span>}
            {errors > 0 && <span className="text-red-500">{errors} failed</span>}
          </div>
          {importDone && (
            <button
              onClick={() => window.location.reload()}
              className="w-full mt-4 rounded-xl bg-orange-500 text-white font-semibold py-3 px-4"
            >
              <div className="flex items-center justify-center gap-2">
                <Check className="w-5 h-5" />
                View My Recipes
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-8 px-4">
      <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-100 mb-2">
        Welcome to Whisk
      </h2>
      <p className="text-stone-500 dark:text-stone-400 text-center mb-8 max-w-sm">
        Your personal recipe book is empty. Let's fill it up!
      </p>

      <div className="w-full max-w-sm space-y-3">
        {/* Primary: Import from CSV/Google Sheets */}
        <button
          onClick={() => navigate("/import")}
          className="w-full rounded-xl border-2 border-orange-200 bg-orange-50 p-4 text-left dark:border-orange-800 dark:bg-orange-950/50"
        >
          <div className="flex items-center gap-3">
            <Inbox className="w-6 h-6 text-orange-500 shrink-0" />
            <div>
              <p className="font-semibold text-stone-800 dark:text-stone-100">
                Import Recipes
              </p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                From Google Sheets, CSV, or recipe URLs
              </p>
            </div>
          </div>
        </button>

        {/* Secondary: Add manually */}
        <button
          onClick={() => navigate("/recipes/new")}
          className="w-full rounded-xl border border-stone-200 bg-white p-4 text-left dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex items-center gap-3">
            <Pencil className="w-6 h-6 text-stone-500 dark:text-stone-400 shrink-0" />
            <div>
              <p className="font-semibold text-stone-800 dark:text-stone-100">
                Add a Recipe
              </p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Type or paste a recipe manually
              </p>
            </div>
          </div>
        </button>

        {/* Tertiary: Import from URL */}
        <button
          onClick={() => navigate("/recipes/new")}
          className="w-full rounded-xl border border-stone-200 bg-white p-4 text-left dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex items-center gap-3">
            <Globe className="w-6 h-6 text-stone-500 dark:text-stone-400 shrink-0" />
            <div>
              <p className="font-semibold text-stone-800 dark:text-stone-100">
                Import from URL
              </p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Grab a recipe from any website
              </p>
            </div>
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-stone-200 dark:border-stone-700" />
          <span className="text-xs text-stone-400 dark:text-stone-500">or</span>
          <div className="flex-1 border-t border-stone-200 dark:border-stone-700" />
        </div>

        {/* Import Whisk Book — opens file picker directly */}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleBookImport(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border border-stone-200 bg-white p-4 text-left dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-stone-500 dark:text-stone-400 shrink-0" />
            <div>
              <p className="font-semibold text-stone-800 dark:text-stone-100">
                Import Whisk Book
              </p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Restore from a Whisk export (.json) file
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
