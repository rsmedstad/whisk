import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-stone-300 dark:text-stone-600 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-stone-700 dark:text-stone-300">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400 max-w-xs">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
