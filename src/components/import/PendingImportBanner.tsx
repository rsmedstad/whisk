import { XMark } from "../ui/Icon";
import type { PendingImport } from "../../types";

interface PendingImportBannerProps {
  pending: PendingImport;
  onFinish: () => void;
  onDismiss: () => void;
}

export function PendingImportBanner({ pending, onFinish, onDismiss }: PendingImportBannerProps) {
  return (
    <div
      className="sticky top-0 z-40 border-b border-orange-200 bg-orange-50 px-3 py-2 dark:border-orange-900 dark:bg-orange-950/50"
      role="status"
    >
      <div className="flex items-center gap-2 max-w-6xl mx-auto">
        <button
          type="button"
          onClick={onFinish}
          className="flex-1 min-w-0 text-left text-sm text-stone-800 dark:text-stone-100"
        >
          Finish importing <span className="font-semibold">{pending.title}</span>?
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="shrink-0 text-xs font-medium text-orange-700 dark:text-orange-300 underline"
        >
          Finish
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 -mr-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
          aria-label="Dismiss"
        >
          <XMark className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
