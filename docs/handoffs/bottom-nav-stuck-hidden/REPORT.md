# Bottom nav stuck hidden

## What changed
- The bottom nav slides off screen while the on-screen keyboard is open. Detection used only `innerHeight - visualViewport.height > 150`, updated on `visualViewport` resize. On iOS that value can stay stale (resize skipped after the keyboard closes, app resumed from background, or zoom that lingers after an input blur), which left the nav translated off screen with only the top of the Ask button peeking out.
- `src/lib/keyboard.ts` (new): pure `isKeyboardOpen()` and `isTextEditable()`. The keyboard now counts as open only when a text field has focus, and the viewport height is multiplied by `visualViewport.scale` so zoom never reads as a keyboard.
- `src/hooks/useKeyboard.ts`: re-checks on focusin, focusout, visibilitychange and pageshow, plus a 350 ms settle re-check, and runs once on mount. Also fixes the same stuck state for Ask, List and the pending-import banner, which share the hook.

## Tested
- `bun test`: 260 pass, 0 fail (adds `tests/keyboard.test.ts`, 6 tests).
- `npx tsc --noEmit`: clean.
- `bun run build`: clean.
- Not tested on a real iPhone; the bug is iOS viewport behavior that headless Chromium does not reproduce.

## Left / follow-ups
- Confirm on the phone: open Discover search, type, dismiss the keyboard, background and resume the app; the nav should stay visible.
