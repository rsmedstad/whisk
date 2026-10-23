import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PendingImport } from "../../types";
import {
  blockedSheetFrameLimitCopy,
  blockedSheetNextStepCopy,
  openSourcePage,
  setPendingImport,
  sourceLabelFromPending,
} from "../../lib/pending-import";
import { detectSavePlatform, isBookmarkletInstalled } from "../../lib/platform";
import { Button } from "../ui/Button";
import { WhiskLogo, XMark } from "../ui/Icon";

interface BlockedSourceSheetProps {
  item: PendingImport;
  onClose: () => void;
}

export function BlockedSourceSheet({ item, onClose }: BlockedSourceSheetProps) {
  const navigate = useNavigate();
  const [platform, setPlatform] = useState(() =>
    typeof navigator === "undefined" ? "desktop" : detectSavePlatform(),
  );
  const [hasBookmarklet, setHasBookmarklet] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setPlatform(detectSavePlatform());
    setHasBookmarklet(isBookmarkletInstalled());
    setImageFailed(false);
  }, [item.url]);

  const sourceLabel = sourceLabelFromPending(item);
  const showImage = Boolean(item.imageUrl) && !imageFailed;

  const openSource = () => {
    setPendingImport({
      ...item,
      timestamp: Date.now(),
      sourceLabel,
    });
    openSourcePage(item.url, platform);
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-4 pb-[calc(var(--sab)+1rem)] sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="blocked-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {showImage && (
          <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800">
            <img
              src={item.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          </div>
        )}
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <WhiskLogo className="w-6 h-6 text-orange-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">
                  {sourceLabel}
                </p>
                <h2
                  id="blocked-sheet-title"
                  className="text-lg font-bold dark:text-stone-100 leading-snug"
                >
                  {item.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 -mr-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              aria-label="Close"
            >
              <XMark className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
            <p>{blockedSheetFrameLimitCopy(sourceLabel)}</p>
            <p className="font-medium text-stone-800 dark:text-stone-100">
              {blockedSheetNextStepCopy(sourceLabel, platform)}
            </p>
          </div>

          {platform !== "android" && !hasBookmarklet && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/settings?tab=data");
              }}
              className="text-xs font-medium text-orange-600 dark:text-orange-400 underline"
            >
              Install the Save to Whisk bookmarklet
            </button>
          )}
          {platform === "ios" && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/shortcut");
              }}
              className="block text-xs font-medium text-orange-600 dark:text-orange-400 underline"
            >
              Or build the iOS Shortcut
            </button>
          )}
          {platform === "android" && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/settings?tab=data");
              }}
              className="text-xs font-medium text-orange-600 dark:text-orange-400 underline"
            >
              How to install Save to Whisk
            </button>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <Button fullWidth onClick={openSource}>
              Open on {sourceLabel}
            </Button>
            <Button variant="ghost" fullWidth onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
