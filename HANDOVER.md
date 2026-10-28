# Shared AI development handover — Vurderingstjekket

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
