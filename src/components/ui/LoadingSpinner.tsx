import { classNames } from "../../lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-10 w-10",
  };

  return (
    <div className={classNames("flex items-center justify-center", className)}>
      <div
        className={classNames(
          "animate-spin rounded-full border-2 border-stone-200 border-t-orange-500 dark:border-stone-700 dark:border-t-orange-400",
          sizeClasses[size]
        )}
      />
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <LoadingSpinner size="lg" />
    </div>
  );
}
