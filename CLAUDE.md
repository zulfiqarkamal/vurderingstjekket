# Vurderingstjekket — Claude Code project instructions

This repository is shared between Claude Code and OpenAI Codex. Read `AGENTS.md` and `HANDOVER.md` at the beginning of every session. Follow the common safety, privacy, branching, validation and deployment rules in `AGENTS.md`.

## Before doing anything
- Inspect branch and working tree: `git status --short --branch`.
- Fetch latest changes and inspect existing open work; do not overwrite uncommitted or divergent changes.
- Read `HANDOVER.md` for latest completed work and pending tasks. Verify against Git history.
- Begin with read-only inspection until user approves edits.

## When implementation is approved
- Use a dedicated `claude/<short-task-name>` branch based on current `main`, or continue an explicitly named branch after reviewing its state.
- Prefer narrow changes with clear acceptance criteria.
- Validate with relevant safe commands; report missing test coverage.
- Append a concise entry to `HANDOVER.md`, including changed files and tests/results, then propose a PR. Do not commit directly to `main`, auto-merge, activate n8n workflows or deploy Railway without explicit approval.

## Claude subagents
Agent definitions may live under `.claude/agents/`. They are optional helpers, not authority to modify production. Each should work within task permissions and return evidence to the parent session.

## Security priority
Credential-like defaults appear in the current PUBLIC source. Do not repeat them or use them. Recommend rotating valid credentials and fixing secret management before expanding agent write access.
