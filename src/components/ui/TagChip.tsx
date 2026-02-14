import { classNames } from "../../lib/utils";

interface TagChipProps {
  label: string;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function TagChip({
  label,
  selected,
  onToggle,
  onRemove,
  size = "md",
}: TagChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={classNames(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap transition-colors",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
        selected
          ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-700"
          : "border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300"
      )}
    >
      {label}
      {onRemove && (
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
        >
          &times;
        </span>
      )}
    </button>
  );
}
