import { useState, useEffect, useCallback, useRef } from "react";
import { nanoid } from "nanoid";
import type { CookingTimer } from "../types";

export function useTimers() {
  const [timers, setTimers] = useState<CookingTimer[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Tick every second
  useEffect(() => {
    const hasRunning = timers.some((t) => t.isRunning);
    if (!hasRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setTimers((prev) =>
        prev.map((timer) => {
          if (!timer.isRunning || timer.remainingSeconds <= 0) return timer;
          const remaining = timer.remainingSeconds - 1;
          if (remaining <= 0) {
            // Timer completed
            notifyTimerComplete(timer.label);
            return {
              ...timer,
              remainingSeconds: 0,
              isRunning: false,
              completedAt: Date.now(),
            };
          }
          return { ...timer, remainingSeconds: remaining };
        })
      );
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timers]);

  const startTimer = useCallback(
    (
      label: string,
      minutes: number,
      recipeId?: string,
      stepIndex?: number
    ) => {
      const timer: CookingTimer = {
        id: nanoid(10),
        label,
        totalSeconds: minutes * 60,
        remainingSeconds: minutes * 60,
        isRunning: true,
        recipeId,
        stepIndex,
      };
      setTimers((prev) => [...prev, timer]);
      return timer.id;
    },
    []
  );

  const pauseTimer = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRunning: false } : t))
    );
  }, []);

  const resumeTimer = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) =>
        t.id === id && t.remainingSeconds > 0
          ? { ...t, isRunning: true }
          : t
      )
    );
  }, []);

  const cancelTimer = useCallback((id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissCompleted = useCallback(() => {
    setTimers((prev) => prev.filter((t) => !t.completedAt));
  }, []);

  const activeTimers = timers.filter((t) => t.isRunning);
  const completedTimers = timers.filter((t) => t.completedAt);
  const hasActiveTimers = activeTimers.length > 0 || completedTimers.length > 0;

  return {
    timers,
    activeTimers,
    completedTimers,
    hasActiveTimers,
    startTimer,
    pauseTimer,
    resumeTimer,
    cancelTimer,
    dismissCompleted,
  };
}

function notifyTimerComplete(label: string) {
  // Vibrate
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  // Notification
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Timer Complete!", { body: `${label} is done.`, icon: "/icons/icon-192.png" });
  }

  // Audio beep
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available
  }
}
