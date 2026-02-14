import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useSpeech } from "../../hooks/useSpeech";
import { classNames, parseTimerFromText } from "../../lib/utils";
import { LoadingSpinner } from "../ui/LoadingSpinner";

interface CookModeProps {
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}

export function CookMode({ onStartTimer }: CookModeProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe } = useRecipes();
  const wakeLock = useWakeLock();
  const speech = useSpeech();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load recipe and activate wake lock
  useEffect(() => {
    if (!id) return;
    getRecipe(id)
      .then(setRecipe)
      .catch(() => navigate("/"))
      .finally(() => setIsLoading(false));
  }, [id, getRecipe, navigate]);

  useEffect(() => {
    wakeLock.request();
    return () => {
      wakeLock.release();
    };
  }, []);

  // Read aloud when step changes
  useEffect(() => {
    if (recipe && speech.isEnabled) {
      speech.speak(recipe.steps[currentStep]?.text ?? "");
    }
  }, [currentStep, speech.isEnabled]);

  if (isLoading || !recipe) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  const step = recipe.steps[currentStep];
  const totalSteps = recipe.steps.length;
  const timerMin = step
    ? step.timerMinutes ?? parseTimerFromText(step.text)
    : null;

  const goNext = () => {
    if (currentStep < totalSteps - 1) setCurrentStep((s) => s + 1);
  };
  const goPrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-stone-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800 pt-[calc(var(--sat)+0.75rem)]">
        <span className="text-sm font-semibold text-orange-500">
          Cook Mode
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={speech.toggle}
            className={classNames(
              "text-lg",
              speech.isEnabled
                ? "text-orange-500"
                : "text-stone-400 dark:text-stone-500"
            )}
            title={speech.isEnabled ? "Disable read aloud" : "Enable read aloud"}
          >
            &#128266;
          </button>
          <button
            onClick={() => navigate(`/recipes/${recipe.id}`)}
            className="text-sm font-medium text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-3 py-1 rounded-lg"
          >
            Done
          </button>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <p className="text-sm text-stone-400 dark:text-stone-500 mb-4">
          Step {currentStep + 1} of {totalSteps}
        </p>

        {step?.photoUrl && (
          <img
            src={step.photoUrl}
            alt={`Step ${currentStep + 1}`}
            className="max-h-48 rounded-xl mb-6 object-cover"
          />
        )}

        <p className="text-xl leading-relaxed text-center font-medium dark:text-stone-100 max-w-lg">
          {step?.text}
        </p>

        {timerMin && (
          <button
            onClick={() =>
              onStartTimer(
                `Step ${currentStep + 1}`,
                timerMin,
                recipe.id,
                currentStep
              )
            }
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-orange-100 px-5 py-2.5 text-sm font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300"
          >
            &#9201; Start {timerMin}:00 Timer
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="px-6 pb-8 pb-[calc(var(--sab)+2rem)]">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={goPrev}
            disabled={currentStep === 0}
            className={classNames(
              "flex-1 py-3 rounded-xl text-sm font-semibold border",
              currentStep === 0
                ? "border-stone-200 text-stone-300 dark:border-stone-700 dark:text-stone-600"
                : "border-stone-300 text-stone-700 active:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:active:bg-stone-800"
            )}
          >
            &#9664; Prev
          </button>
          <button
            onClick={goNext}
            disabled={currentStep === totalSteps - 1}
            className={classNames(
              "flex-1 py-3 rounded-xl text-sm font-semibold",
              currentStep === totalSteps - 1
                ? "bg-stone-200 text-stone-400 dark:bg-stone-700 dark:text-stone-500"
                : "bg-orange-500 text-white active:bg-orange-600"
            )}
          >
            Next &#9654;
          </button>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mt-4">
          {recipe.steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentStep(i)}
              className={classNames(
                "h-2 w-2 rounded-full transition-colors",
                i === currentStep
                  ? "bg-orange-500"
                  : i < currentStep
                    ? "bg-orange-300 dark:bg-orange-700"
                    : "bg-stone-300 dark:bg-stone-600"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
