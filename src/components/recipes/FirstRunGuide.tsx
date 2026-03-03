import { useNavigate } from "react-router-dom";
import { Inbox, Pencil, Globe } from "../ui/Icon";

export function FirstRunGuide() {
  const navigate = useNavigate();

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
      </div>
    </div>
  );
}
