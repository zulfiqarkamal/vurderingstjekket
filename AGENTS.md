# Vurderingstjekket — Shared development rules (Codex)

## Project and source of truth
- Repository: `zulfiqarkamal/vurderingstjekket`; default branch: `main`.
- Application: Node.js >=18, Express 4, Stripe 14; plain HTML/CSS/JavaScript frontend.
- Run command: `npm start` (`node server.js`). Development: `npm run dev`.
- Railway deployment is configured via `railway.toml` with Nixpacks and `npm start`.
- Read `HANDOVER.md` before planning or implementing changes.
- `main` is production-sensitive. NEVER commit or push directly to `main`.

## Mandatory safe workflow
1. Pull/fetch recent commits, inspect the actual repository and read `HANDOVER.md`. Do not assume chat memory is current.
2. For exploratory requests, remain read-only and report findings with file paths. Never run destructive commands, execute billing flows, or trigger live APIs.
3. For approved development, create a new task branch prefixed `codex/`, e.g. `codex/feature-name`.
4. Make the smallest targeted edits. Do not change payment, property valuation, tax/appeal wording, deployment, or authentication without explicit task authorization.
5. Inspect diffs, run available validation (`npm install` only with approval if downloads are needed; `node --check server.js`, static checks as appropriate). No automated test suite is currently defined: state this explicitly rather than claiming tests passed.
6. Update `HANDOVER.md` with purpose, branch, changed files, validation, outstanding risks and next actions. Do not include secrets or customer data.
7. Commit to the task branch and propose a pull request for human review; never merge or deploy without explicit approval.

## Security and privacy
- PUBLIC repository: `server.js` contains credential-like fallback strings and an admin credential fallback in the inspected revision. Treat as urgent. Do not quote or reuse them. Ask owner to rotate credentials if valid, audit history, and replace hardcoded secrets with environment variables as a reviewed task.
- Do not expose `process.env` values, API keys, personal data, Stripe payloads, customer addresses or stored customer sessions in logs, reports or prompts.
- Never invoke payment capture, live Stripe webhooks, outbound email, or production data mutations during testing unless specifically authorized and a safe test environment is confirmed.
- No unattended production deployments.

## Architecture observations (verify against latest code)
- `server.js`: HTTP routes, property evaluation, address/BBR/data integrations, Stripe checkout/webhook, email.
- `public/index.html`: served frontend with API calls.
- `index.html`: another frontend copy; determine if stale before touching it.
- `package.json`: dependencies and scripts.
- `railway.toml`: Railway deployment.

## Handoff with Claude Code
- Claude uses `CLAUDE.md`; both systems use this file and `HANDOVER.md` as common contracts.
- Commit the handover on the SAME branch as the feature.
- Never assume a Claude.ai web Project contains the same contents as this Git repository.
- If another AI has uncommitted work, stop and ask for a clean handover before overwriting it.
