# Report: kit-outbound-data-rule (whisk)

Date: 2026-10-25. Branch `kit/outbound-data-rule`. Handoff W3, from wiki handoff 0004 (item 4, decision 2).

## Changed
- `AGENTS.md`: added the outbound-data Hard rule and the single-fetch Crawling sentence, verbatim from `agent-kit/AGENTS.md.template` (wiki PR 3). Nothing else in the file changed.
- `.github/dependabot.yml`: weekly bun and github-actions, minor and patch grouped, majors ignored, same shape as the health repo.

## Tested
- `bun install --frozen-lockfile` then `npx tsc --noEmit`: exit 0. Docs and config only; `bun test` not run.

## Left
- Nothing.
- Secret scanning is a repo setting, not a file. Ryan turns it on under Settings > Code security (Secret scanning and push protection).

## Blockers
None.
