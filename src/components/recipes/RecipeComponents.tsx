import { useState } from "react";
import type { Ingredient, Step } from "../../types";
import { classNames, decodeEntities, parseTimerFromText, parseFraction } from "../../lib/utils";
import { categorizeIngredient, CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/categories";
import { estimateGrams } from "../../lib/units";
import { Check, Stopwatch } from "../ui/Icon";

// ── Ingredient Row ──

export function IngredientRow({ ingredient, hideGroup, showGrams, onCheck }: {
  ingredient: Ingredient;
  hideGroup?: boolean;
  showGrams?: boolean;
  onCheck?: () => void;
}) {
  const [checked, setChecked] = useState(false);

  const display = decodeEntities(
    [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ")
  );

  let gramDisplay: string | null = null;
  if (showGrams && ingredient.amount && ingredient.unit) {
    const parsed = parseFraction(ingredient.amount);
    if (parsed !== null) {
      const grams = estimateGrams(parsed, ingredient.unit, ingredient.name);
      if (grams !== null) {
        gramDisplay = `${grams}g`;
      }
    }
  }

  return (
    <li
      className={classNames(
        "flex items-center gap-2 text-sm cursor-pointer",
        checked && "line-through text-stone-400 dark:text-stone-500"
      )}
      onClick={() => { setChecked(!checked); if (!checked && onCheck) onCheck(); }}
    >
      <span
        className={classNames(
          "h-4 w-4 rounded border shrink-0 flex items-center justify-center",
          checked
            ? "bg-orange-500 border-orange-500 text-white"
            : "border-stone-300 dark:border-stone-600"
        )}
      >
        {checked && <Check className="w-3 h-3" />}
      </span>
      <span className="dark:text-stone-200">
        {!hideGroup && ingredient.group && (
          <span className="font-medium text-stone-500 dark:text-stone-400">
            {ingredient.group}:{" "}
          </span>
        )}
        {display}
        {gramDisplay && (
          <span className="ml-1 text-xs text-stone-400 dark:text-stone-500 font-normal">
            ({gramDisplay})
          </span>
        )}
      </span>
    </li>
  );
}

// ── Grouped Ingredients ──

export function GroupedIngredients({ ingredients, sort, resetKey, showGrams, onCheckedChange }: {
  ingredients: Ingredient[];
  sort: "recipe" | "category";
  resetKey: number;
  showGrams: boolean;
  onCheckedChange?: (hasChecked: boolean) => void;
}) {
  const hasExplicitGroups = ingredients.some((i) => i.group);
  const handleCheck = () => onCheckedChange?.(true);

  if (sort === "recipe") {
    if (hasExplicitGroups) {
      const groups = new Map<string, Ingredient[]>();
      for (const ing of ingredients) {
        const key = ing.group ?? "";
        const list = groups.get(key);
        if (list) list.push(ing);
        else groups.set(key, [ing]);
      }
      return (
        <div className="space-y-4">
          {[...groups.entries()].map(([group, ings]) => (
            <div key={group}>
              {group && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
                  {group}
                </h3>
              )}
              <ul className="space-y-2">
                {ings.map((ing, i) => (
                  <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} hideGroup showGrams={showGrams} onCheck={handleCheck} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    return (
      <ul className="space-y-2">
        {ingredients.map((ing, i) => (
          <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} showGrams={showGrams} onCheck={handleCheck} />
        ))}
      </ul>
    );
  }

  // Category sort
  const grouped = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const cat = categorizeIngredient(ing.name);
    const list = grouped.get(cat);
    if (list) list.push(ing);
    else grouped.set(cat, [ing]);
  }

  if (grouped.size <= 1) {
    return (
      <ul className="space-y-2">
        {ingredients.map((ing, i) => (
          <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} showGrams={showGrams} onCheck={handleCheck} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
        const ings = grouped.get(cat)!;
        return (
          <div key={cat}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
              {CATEGORY_LABELS[cat]}
            </h3>
            <ul className="space-y-2">
              {ings.map((ing, i) => (
                <IngredientRow key={`${resetKey}-${cat}-${i}`} ingredient={ing} showGrams={showGrams} onCheck={handleCheck} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Step Row ──

export function StepRow({ step, index, recipeId, onStartTimer }: {
  step: Step;
  index: number;
  recipeId?: string;
  onStartTimer?: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}) {
  const timerMin = step.timerMinutes ?? parseTimerFromText(step.text);
  return (
    <li className="flex gap-3">
      <span className="shrink-0 h-6 w-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center dark:bg-orange-900 dark:text-orange-300">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed dark:text-stone-200">
          {decodeEntities(step.text)}
        </p>
        {step.photoUrl && (
          <img
            src={step.photoUrl}
            alt={`Step ${index + 1}`}
            className="mt-2 rounded-lg max-h-48 object-cover"
            loading="lazy"
          />
        )}
        {timerMin && onStartTimer && recipeId && (
          <button
            onClick={() => onStartTimer(`Step ${index + 1}`, timerMin, recipeId, index)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400"
          >
            <Stopwatch className="w-3.5 h-3.5" /> {timerMin}:00
          </button>
        )}
      </div>
    </li>
  );
}

// ── Steps List ──

export function StepsList({ steps, recipeId, onStartTimer }: {
  steps: Step[];
  recipeId?: string;
  onStartTimer?: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}) {
  const hasGroups = steps.some((s) => s.group);

  if (!hasGroups) {
    return (
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <StepRow key={i} step={step} index={i} recipeId={recipeId} onStartTimer={onStartTimer} />
        ))}
      </ol>
    );
  }

  const sections: { name: string; steps: { step: Step; originalIndex: number }[] }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const groupName = step.group ?? "";
    const last = sections[sections.length - 1];
    if (last && last.name === groupName) {
      last.steps.push({ step, originalIndex: i });
    } else {
      sections.push({ name: groupName, steps: [{ step, originalIndex: i }] });
    }
  }

  return (
    <div className="space-y-6">
      {sections.map((section, si) => (
        <div key={si}>
          {section.name && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2">
              {section.name}
            </h3>
          )}
          <ol className="space-y-4">
            {section.steps.map(({ step, originalIndex }) => (
              <StepRow key={originalIndex} step={step} index={originalIndex} recipeId={recipeId} onStartTimer={onStartTimer} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
