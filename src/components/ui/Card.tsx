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
        "rounded-xl border border-stone-200 bg-white shadow-sm",
        "dark:border-stone-700 dark:bg-stone-900",
        padded && "p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
