# Shared AI development handover — Vurderingstjekket

## Security hardening ready for local review — 2026-10-28
- Agent: Codex. Branch: `codex/security-hardening`, based on `c80eb5e`.
- Read AGENTS.md, CLAUDE.md, this handover, and all three `.claude/agents/` definitions. Fetched origin; origin/main matched local main. Working tree was clean before starting.
- User authorized implementation and offline tests, with no credential changes, production API calls, deployment, merge, pricing change, or push. Stop before pushing and request user review. No PR has been published.
- Scope: prevent submitted checkout fields from controlling report/payment state; restrict report reading and email delivery to the purchasing browser after verified payment.
- Changed files: `server.js`, `package.json`, `test/security.test.js`, `HANDOVER.md`. No dependencies installed or added. Both frontend copies, valuation/appeal wording, pricing, credentials, and deployment configuration are unchanged.
- Implementation: allowlist checkout property inputs and validate numeric/string types; keep status, report text, access credentials, payment verification and expected amount server-controlled. Store only a hash of a random access token. Set an HttpOnly, SameSite=Lax cookie scoped to `/api`, Secure in production/HTTPS, with a 24-hour lifetime also enforced server-side. Report and mail routes require the cookie plus verified payment (or an explicitly admin-authorized internal test session). Sensitive responses use no-store.
- Webhook: preserve raw-body signature verification; additionally require paid status, matching Checkout ID, DKK currency and the server-created expected amount. Ignore duplicate completion for an already verified in-memory order. Pricing remains unchanged.
- Tests added BEFORE server fixes: five regression tests failed against the original handlers, showing internal-field injection, unpaid report access, access without browser ownership, acceptance of unsuitable payment events, and duplicate fulfillment. After fixes and expanded coverage, all eight tests pass.
- Validation: `npm.cmd test` (8/8 pass), `node --check server.js`, `node --check test/security.test.js`, `git diff --check`. This repo previously had no automated test script; this change adds one. PowerShell blocks npm.ps1, so use `npm.cmd test` on this machine.
- Test safety/limits: dependency-free Node test runner executes real server route handlers in an isolated VM, with Express registration/response objects, Stripe, generation, mail, filesystem and network mocked. No listeners, real provider calls, customer storage access or disk writes occur in tests. These are route-handler regression tests, not real Express/Stripe SDK integration or browser-cookie tests. Signature cryptography is mocked, not independently verified. Tests run on local Node 24; minimum supported Node 18 was not available for execution.
- Compatibility: checkout and authorized test generation set access cookies automatically; frontends continue same-origin requests without edits. Report IDs alone no longer grant access. Other browsers/devices, cookies disabled/deleted, cookie expiry, and pre-existing sessions without access tokens are denied. Pending payment report polling receives 403 until payment is verified, which the existing UI continues polling. No cross-device/recovery mechanism is included; user review must accept this behavior before deployment.
- Residual risks: orders remain process-local and disappear on restart/replica changes; webhook still acknowledges before durable work; duplicate suppression is only in-memory; generation errors need manual follow-up rather than webhook replay; delayed-payment success events are not implemented. Admin URL-key authentication and exposed credential defaults remain; an exposed admin key can still authorize internal test generation. Rate limiting, email quotas/recipient verification, durable queue/storage, broader HTML escaping, and broader input validation remain separate tasks. Cookies expire after 24 hours, but session storage itself still has no eviction. No live configuration was verified.
- Manual owner actions: treat valid committed BBR/admin credentials as exposed; rotate/revoke them in provider/admin configuration through a separately approved task, review relevant access/activity and Git history, verify replacement environment configuration securely, and remove hardcoded defaults in a reviewed follow-up. Assess the address-provider token's intended public status/restrictions before deciding whether it needs replacement. Do not paste credential values into chat, logs, commits, or this handover. History cleanup alone is not revocation.
- Next for Claude Code: review this branch and diff; run the offline tests above; do not overwrite or switch branches without checking status. Add real Express/browser tests only in an approved isolated environment with synthetic credentials and mocked providers. Obtain user review before any push; no deployment/merge is authorized. Address durable order recovery and credential remediation separately before production rollout.

The older inspection below is retained as historical context; its statement that there is no test script is superseded by this entry.

## Current status (read-only inspection, 2026-10-28)
- Repository: `zulfiqarkamal/vurderingstjekket` (`main`).
- Observed files: `server.js`, `package.json`, `railway.toml`, `index.html`, `public/index.html`.
- Backend: Node.js + Express; Stripe integration; property, address and BBR/data lookup; email integration.
- Frontend: HTML/JavaScript. Railway configuration: Nixpacks, `npm start`.
- No test script or existing `AGENTS.md`/`CLAUDE.md` observed.
- **Priority security issue:** public `server.js` appears to include hardcoded credential-like defaults and an administrator password fallback. Treat any valid values as exposed; rotate them and review access and Git history. Do not reproduce secrets here.
- **No implementation or deployment performed.** Live Railway/n8n configuration not verified.

## Next approved tasks (proposed, not yet authorized)
1. Security remediation on a feature branch: rotate exposed credentials, remove default passwords/secrets, update configuration documentation and verify production secrets securely.
2. Establish a minimal test and lint/check pipeline for key backend routes without live paid API calls.
3. Confirm which frontend file is active (`public/index.html` vs top-level `index.html`) and retire duplicates only after verifying deployment.
4. Map any relevant n8n workflows to this app. Do not infer a linkage from names alone.
5. Add reusable specialist agent definitions as separate reviewed changes.

## Latest work entry
- Date: 2026-10-28
- Agent: ChatGPT (read-only analysis)
- Branch: none; `main` inspected through GitHub connector.
- Changes: none to repository.
- Validation: inspected repository tree, package manifest, Railway config, and source excerpts; no tests executed.
- Next action: review the proposed instruction files and perform urgent credential remediation.

## Template for future entries
- Date / agent:
- Repository / branch / commit:
- Objective and acceptance criteria:
- Files changed:
- Commands/tests and results:
- Security or deployment implications:
- Pull request URL / approval status:
- Next actions / blockers:
