# Seasonal palettes follow System/Light/Dark

## What changed
- Theme setting split in two. **Mode** (System, Light, Dark) controls the `.dark` class. **Colors** (Classic, Seasonal) controls the `data-accent` palette. Any palette now works in any mode.
- `useTheme`: new `palette` state stored in `whisk_palette`. A stored `whisk_theme=seasonal` migrates to mode `system` + palette `seasonal`. `DARK_ACCENTS` (Halloween forced dark) is removed. `resolved` now updates when the OS scheme changes (it used to go stale).
- Settings > Display: "Appearance" card with a Mode row and a Colors row; the accent picker shows when Colors is Seasonal. Onboarding has the same mode row plus a Seasonal colors toggle.
- `app.css`:
  - Halloween has a light surface (`--color-white: #fff6ec`); the purple-black surface applies only in dark mode.
  - Removed the dead `html.dark[data-accent="christmas"]` block, which mapped stone-50..200 to near-black and would have made dark-mode text unreadable.
  - New "Dark mode tuning" section: per-palette lifts of stone-300/400/500 (secondary text) for dark mode, plus accent lifts for Winter and Christmas.
  - orange-500 nudged slightly darker for Valentine, St. Patrick's, Halloween, Thanksgiving and Fall so white button text clears WCAG AA 4.5:1 on the tinted white.

## Tested
- `npx tsc --noEmit`: clean.
- `bun test`: 254 pass, 0 fail.
- `bun run build`: ok.
- Contrast script over all 12 palettes x light/dark (body text, muted text, accent text, accent chips, white-on-accent buttons): all pass.
- Playwright against `vite preview`: Settings page screenshots for Classic light, Winter light/dark, Halloween light/dark, Christmas dark, Thanksgiving dark. Checked legacy `seasonal` migration, and that System mode follows an OS scheme change live.
- `wrangler pages dev` could not start here (remote bindings need a Cloudflare token), so API flows were not exercised; the change is client-only.

## Left / follow-ups
- Login is not passed theme/palette props from `App.tsx` (unchanged from before), so the onboarding toggles are inert until wired.
- Only the Settings page was screenshotted; recipe list/detail in seasonal dark mode is worth a glance on device.
- `index.html` `theme-color` meta is still the classic green for all palettes.
