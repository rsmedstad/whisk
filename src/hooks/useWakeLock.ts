import { useState, useCallback, useEffect, useRef } from "react";

export function useWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const request = useCallback(async () => {
    if (!("wakeLock" in navigator)) return false;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setIsActive(true);
      wakeLockRef.current.addEventListener("release", () => {
        setIsActive(false);
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const release = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsActive(false);
    }
  }, []);

  // Re-acquire on visibility change (iOS releases on tab switch)
  useEffect(() => {
    if (!isActive) return;

    const handleVisibility = async () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        await request();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [isActive, request]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wakeLockRef.current?.release();
    };
  }, []);

  return { isActive, request, release };
}
