# Contributing to Whisk

Thanks for your interest in contributing! Whisk is an open-source recipe manager and we welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `bun install`
4. Create a `.dev.vars` file with your environment variables (see README)
5. Start the dev server: `bun run dev`

## Before You Submit

- **Open an issue first** for significant changes (new features, architecture changes, etc.). This lets us discuss the approach before you invest time in code.
- **Bug fixes and small improvements** can go straight to a pull request.
- Run `bun run build` to ensure TypeScript checks pass and the production build succeeds.

## Code Conventions

- **TypeScript strict mode** with `noUncheckedIndexedAccess` — always null-check array indexing and Record lookups.
- **Named exports only** — no default exports.
- **All types in `src/types/index.ts`** — don't scatter type definitions.
- **Tailwind CSS 4 utilities only** — no CSS modules, styled-components, or inline styles.
- **Function components + hooks** — no class components.
- **Cloudflare Pages Functions** for API routes — file-based routing in `functions/api/`.

## What We're Not Looking For

- Adding CSS frameworks alongside Tailwind (Bootstrap, Material UI, etc.)
- State management libraries (Redux, Zustand, etc.) — hooks + localStorage is the pattern
- Server-side rendering — Whisk is a client-side SPA
- Database clients — all data goes through Cloudflare KV/R2 bindings

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `bun run build` passes
4. Submit a pull request with a clear description of the change and its motivation

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
