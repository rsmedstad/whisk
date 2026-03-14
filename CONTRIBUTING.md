# Contributing to Whisk

Thanks for your interest! Whisk is a personal project that I've open-sourced for others to self-host and learn from. While I'm not actively seeking feature contributions, bug reports and issues are always welcome.

## Reporting Issues

If you find a bug or have a suggestion, please [open an issue](https://github.com/rsmedstad/whisk/issues). Include steps to reproduce if applicable.

## Code Changes

If you'd like to submit a code change:

1. **Open an issue first** to discuss the approach — this avoids wasted effort on changes that may not align with the project's direction.
2. Fork the repository and create a feature branch from `main`.
3. Follow the code conventions below.
4. Run `bun run build` to ensure TypeScript checks pass.
5. Submit a pull request with a clear description.

## Code Conventions

- **TypeScript strict mode** with `noUncheckedIndexedAccess` — always null-check array indexing and Record lookups.
- **Named exports only** — no default exports.
- **All types in `src/types/index.ts`** — don't scatter type definitions.
- **Tailwind CSS 4 utilities only** — no CSS modules, styled-components, or inline styles.
- **Function components + hooks** — no class components.
- **Cloudflare Pages Functions** for API routes — file-based routing in `functions/api/`.

## Out of Scope

- Adding CSS frameworks alongside Tailwind (Bootstrap, Material UI, etc.)
- State management libraries (Redux, Zustand, etc.) — hooks + localStorage is the pattern
- Server-side rendering — Whisk is a client-side SPA
- Database clients — all data goes through Cloudflare KV/R2 bindings

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
