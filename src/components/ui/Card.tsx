import type { HTMLAttributes } from "react";
import { classNames } from "../../lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({
  padded = true,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={classNames(
        "wk-card rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white shadow-[var(--wk-shadow-card)]",
        "dark:border-stone-800 dark:bg-stone-900 dark:ring-1 dark:ring-orange-500/6",
        padded && "p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
