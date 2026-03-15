interface DemoBannerProps {
  /** Short label for what feature is restricted, e.g. "Adding recipes" */
  feature?: string;
  className?: string;
}

export function DemoBanner({ feature, className = "" }: DemoBannerProps) {
  return (
    <div
      className={`rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-stone-600 dark:border-orange-900 dark:bg-orange-950/40 dark:text-stone-400 ${className}`}
    >
      <p className="font-medium text-stone-700 dark:text-stone-300">
        {feature ? `${feature} is` : "This feature is"} not available in the demo
      </p>
      <p className="mt-0.5">
        <a
          href="https://github.com/rsmedstad/whisk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-600 underline hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
        >
          Set up your own Whisk
        </a>
        {" "}to unlock all features.
      </p>
    </div>
  );
}
