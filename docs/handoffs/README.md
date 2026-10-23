# Handoffs

A handoff is one self-contained job for a coding agent. Any agent can write one and any agent can run one.

## Writing one
Copy TEMPLATE.md to `docs/handoffs/<NNNN-short-name>.md`. Fill every field. Pick the cheapest tier that can do it (see AGENTS.md).

## Running one
- PC on: `claude --model <haiku|sonnet|opus>` in the repo, then: "Run docs/handoffs/<file>.md to its finish line."
- PC off: Claude Code on the web or phone app (or any cloud agent) on the GitHub repo, same instruction.
- Agent briefing itself (no planner available): "Read docs/handoffs/README.md, write a handoff for <task>, then run it." Do the writing on the heavy tier only if the task is heavy; otherwise standard.

## Reporting
The agent writes `docs/handoffs/<NNNN-short-name>/REPORT.md` and opens a PR with the summary. Ryan or Chief reads that one file. Nobody polls progress.
