// Pure helpers for on-screen keyboard detection (no React, no DOM access).

export const KEYBOARD_THRESHOLD = 150;

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image",
  "radio", "range", "reset", "submit",
]);

interface EditableLike {
  tagName?: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isContentEditable?: boolean;
}

/** True when the element is one that summons the on-screen keyboard. */
export function isTextEditable(el: EditableLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (el.readOnly || el.disabled) return false;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
  return false;
}

export interface KeyboardSnapshot {
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
  editableFocused: boolean;
}

/**
 * The keyboard counts as open only when a text field has focus and the visual
 * viewport is shorter than the layout viewport. The height is multiplied by
 * the zoom scale so pinch zoom (or iOS auto-zoom that lingers after blur)
 * never reads as a keyboard. Requiring focus keeps the nav from getting stuck
 * hidden when iOS skips the resize event after the keyboard closes.
 */
export function isKeyboardOpen(s: KeyboardSnapshot): boolean {
  if (!s.editableFocused) return false;
  const scale = s.viewportScale > 0 ? s.viewportScale : 1;
  return s.innerHeight - s.viewportHeight * scale > KEYBOARD_THRESHOLD;
}
