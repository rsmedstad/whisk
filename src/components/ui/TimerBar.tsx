import { useState } from "react";
import type { CookingTimer } from "../../types";
import { formatTimerDisplay } from "../../lib/utils";
import { classNames } from "../../lib/utils";
import { Stopwatch, ChevronUp, ChevronDown } from "./Icon";

interface TimerBarProps {
  timers: CookingTimer[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDismissCompleted: () => void;
}

export function TimerBar({
  timers,
  onPause,
  onResume,
  onCancel,
  onDismissCompleted,
}: TimerBarProps) {
  const [expanded, setExpanded] = useState(false);

  const active = timers.filter((t) => t.isRunning);
  const completed = timers.filter((t) => t.completedAt);
  const paused = timers.filter((t) => !t.isRunning && !t.completedAt && t.remainingSeconds > 0);

  if (timers.length === 0) return null;

  // Find the timer with least time remaining for display
  const displayTimer = active[0] ?? paused[0] ?? completed[0];

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={classNames(
          "w-full flex items-center justify-between px-4 py-2 text-sm font-medium",
          completed.length > 0
            ? "bg-green-500 text-white"
            : "bg-orange-500 text-white"
        )}
      >
        <span className="flex items-center gap-2">
          <Stopwatch className="w-4 h-4" />
          {active.length > 0
            ? `${active.length} timer${active.length > 1 ? "s" : ""} running`
            : completed.length > 0
              ? "Timer done!"
              : `${paused.length} paused`}
        </span>
        <span className="flex items-center gap-2">
          {displayTimer && (
            <span className="font-mono">
              {displayTimer.completedAt
                ? "Done!"
                : formatTimerDisplay(displayTimer.remainingSeconds)}
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-700 shadow-lg max-h-64 overflow-y-auto">
          <div className="p-4 space-y-3">
            {timers.map((timer) => (
              <div
                key={timer.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={classNames(
                        "h-2 w-2 rounded-full",
                        timer.completedAt
                          ? "bg-green-500"
                          : timer.isRunning
                            ? "bg-red-500 animate-pulse"
                            : "bg-stone-400"
                      )}
                    />
                    <span className="text-sm font-medium truncate dark:text-stone-100">
                      {timer.label}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-sm tabular-nums dark:text-stone-300">
                  {timer.completedAt
                    ? "Done!"
                    : formatTimerDisplay(timer.remainingSeconds)}
                </span>
                <div className="flex gap-1">
                  {!timer.completedAt && (
                    <>
                      <button
                        onClick={() =>
                          timer.isRunning
                            ? onPause(timer.id)
                            : onResume(timer.id)
                        }
                        className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-800 dark:text-stone-300"
                      >
                        {timer.isRunning ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => onCancel(timer.id)}
                        className="px-2 py-1 text-xs rounded bg-stone-100 text-red-600 dark:bg-stone-800"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {completed.length > 0 && (
              <button
                onClick={onDismissCompleted}
                className="w-full text-center text-sm text-orange-600 dark:text-orange-400 py-1"
              >
                Dismiss completed
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
