import { useState, useEffect } from "react";
import { isKeyboardOpen, isTextEditable } from "../lib/keyboard";

export function useKeyboard() {
  const [isKeyboardOpenState, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      setIsKeyboardOpen(
        isKeyboardOpen({
          innerHeight: window.innerHeight,
          viewportHeight: viewport.height,
          viewportScale: viewport.scale,
          editableFocused: isTextEditable(document.activeElement as HTMLElement | null),
        })
      );
    };

    // iOS reports the final viewport size a beat after focus changes, so
    // check again once the keyboard animation settles.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const updateSoon = () => {
      update();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(update, 350);
    };

    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", updateSoon);
    document.addEventListener("focusout", updateSoon);
    document.addEventListener("visibilitychange", updateSoon);
    window.addEventListener("pageshow", updateSoon);
    update();

    return () => {
      clearTimeout(settleTimer);
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", updateSoon);
      document.removeEventListener("focusout", updateSoon);
      document.removeEventListener("visibilitychange", updateSoon);
      window.removeEventListener("pageshow", updateSoon);
    };
  }, []);

  return { isKeyboardOpen: isKeyboardOpenState };
}
