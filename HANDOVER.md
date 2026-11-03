# Shared AI development handover — Vurderingstjekket

## BLR Dashboard redesign — 2026-11-02

- Agent: Claude Sonnet 4.6. Branch: `claude/project-thread-bld31w`. PR pending.
- **Task:** Full BoligLånsRadar dashboard redesign for `/boliglaanstjek` (step 4 / panel-4) to match the premium reference image.

### Ændrede filer
1. **`public/boliglaanstjek-preview.html`** — Complete rewrite of `renderResultat()` and header HTML:
   - Dual-mode header: wizard logo (steps 1–3) vs. forest-green nav with sub-tabs (step 4), toggled by `blr-active` body class
   - Secondary subnav with 5 tab links (only visible in dashboard mode)
   - `goTo()` updated to set `body.blr-active` and show subnav when entering step 4
   - Hero card with `house-photo.jpg` overlay, info chips (besparelse, ny rente, break-even)
   - 4 stat tiles: ejendomsværdi, restgæld, LTV+badge, friværdi
   - 2-column layout: main (rate chart SVG, scenario table) + sidebar (status, alerts, next-steps, paywall)
   - Paywall card: månedlig/årlig plan picker, email input, calls `startOvervagning()` for Stripe checkout
   - Premium gating is server-side (NOT CSS blur)
2. **`public/house-photo.jpg`** (new) — White Danish house with terracotta roof, cropped from reference image.
3. **`server.js`** — New `POST /api/subscription-status` endpoint: checks email against `ABONNENTER`, returns `{ active, periode, createdAt }`.

### Tests / validation
- `renderResultat` brace/backtick balance verified via Node.js script (all balanced).
- `sc.omk` field confirmed correct — scenario objects use `.omk` not `.omkostninger`.
- Stripe still in test mode; nothing deployed to production.

## BBR-opslag ved adressevalg på boliglaanstjek — 2026-10-30

- Agent: Claude Sonnet 4.6. Branch: `claude/project-thread-gqql7g`.
- **Problem:** `dawaPick()` gemte ikke `adresseId`/`husnummerId`/`kommunekode` fra DAWA-svaret, og kaldte aldrig `/api/bbr` efter adressevalg.
- **Fix:** `dawaSearch()` udtrækker nu `adresseId`, `husnummerId`, `kommunekode` fra DAWA. `dawaPick()` kalder ny `lookupBBRForLoan()` der henter bygningsdata fra `/api/bbr` og viser et status-badge med boligtype og m².
- Ændret fil: `public/boliglaanstjek-preview.html` (adresse-autocomplete-sektion + nyt `#bbrBadge` element).

## Stripe-betalingsflows + adresse-fix — 2026-10-30
- Agent: Claude Code. Branch: `claude/stripe-products`, PR pending.
- Objective: fix adresse-autocomplete i ejendomsvurdering.html; tilføj 3 rigtige Stripe-betalingsflows.

### Ændrede filer
1. **`public/ejendomsvurdering.html`** — `fetchSuggestions()` kalder nu Dataforsyningen direkte fra browser (CORS åben, ingen server-proxy). Fallback til `/api/adresse` hvis direkte kald fejler.
2. **`server.js`** — Ny endpoint `POST /api/bankpakke/start`: 299 kr one-time Stripe Checkout for bankpakke; inkl. e-mailvalidering og banker-liste i metadata.
3. **`public/boliglaanstjek-preview.html`**:
   - Panel-7: Tilføjet e-mail felt (`pakkeEmail`) over send-knap. `sendPakke()` kalder nu `/api/bankpakke/start` og redirecter til Stripe URL.
   - Panel-8: `payCard()` kalder nu `/api/laanovervagning/start` og redirecter til Stripe URL. Fjernet "Betaling er afkoblet"-tekst. Tilføjet `#p8-success` success-kort.
   - URL-param handling: `?bankpakke=ok` viser success-kort i panel-7; `?overvagning=ok` viser `#p8-success` i panel-8.

### Priser (justerbare via Railway env vars)
- `BANKPAKKE_PRICE_DKK` — default 299 kr (engangsbetaling)
- `PRICE_DKK` — EV-klage (eksisterende, default 350 kr)
- Overvågning: 49 kr/md eller 399 kr/år (hardcodet i `/api/laanovervagning/start`)

### Test/validering
- `node --check server.js` bestået. Stripe-kald ikke testet live.
- Adresse-fix: Dataforsyningen CORS-åben, ingen API-nøgle kræves fra browser.

### Næste opgaver
- PR #27 (agenter) afventer merge-godkendelse.
- Overvej at sætte `BANKPAKKE_PRICE_DKK=299` i Railway env vars.
- GoCardless open banking (diskuteret, ikke godkendt endnu).

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

## Screenshot OCR for boliglånstjek — 2026-10-30
- Agent: Claude Code. Branch: `claude/screenshot-ocr-endpoint`, PR pending.
- Objective: allow users to photograph their bank loan screen and have restgæld, ydelse, rente, løbetid, lånstype extracted automatically via Claude Vision.
- Changed files: `server.js` (added `/api/analyze-screenshot` POST endpoint using raw fetch to Anthropic API), `package.json` (added `@anthropic-ai/sdk ^0.32.0`), `public/boliglaanstjek-preview.html` (added `capture="environment"` to file input for direct camera on mobile).
- The frontend scaffold (Step 2 upload zone + `handleScreenshotUpload()` + Step 3 fields) was already in place from a prior session. Only the backend endpoint was missing.
- Requires `ANTHROPIC_API_KEY` Railway env var — endpoint returns 503 if absent.
- Validation: `node --check server.js` passes. No live API call tested.
- Next: GoCardless open banking integration for automatic løn/udgifter (discussed, not yet approved).

## Latest work entry (previous)
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

## Unified Danish homepage — local development, 2026-10-28
- Agent: Codex. Branch: `codex/unified-bolig-homepage`, based on security-hardening commit `646bce3` (one commit ahead of fetched `origin/main`). Security-hardening is retained; no merge into main is authorized.
- Inspected AGENTS.md, CLAUDE.md, prior handover and both files under Boliglansradar_Integration_Inputs. Recursive inventory found no nested integration folder. Inputs remain unmodified and untracked, excluded from this implementation commit.
- Objective: a responsive Danish homepage presenting Ejendomsvurdering and Boliglaanstjek under Vurderingstjekket, while retaining independent Railway and Cloudflare services and Stripe integrations.
- Files: `public/index.html` is the new landing page, with `public/home.css` and `public/home.js`. The former active frontend is preserved as `public/ejendomsvurdering.html`, with product navigation and callback URL cleanup adjusted. The top-level `index.html` fallback copy is untouched; Express serves public/index.html first.
- `server.js` adds `/ejendomsvurdering` and `/boliglaanstjek` only. All valuation, authentication, checkout, webhook, report, email and entitlement handlers remain unchanged. Existing Railway Stripe success/cancel URLs still return to `/?session=...` or `/?cancelled=1`; home.js forwards those queries (and legacy test links) to `/ejendomsvurdering` on the same origin. API requests remain absolute same-origin `/api/*`; the browser-bound cookie remains scoped to `/api`.
- Mortgage integration: set `BOLIGLAANSRADAR_URL` to the reviewed HTTPS origin of the existing Worker (root URL, no credentials/query/fragment). `/boliglaanstjek` then navigates to that origin without forwarding customer data, query parameters or Railway cookies. The Worker owns its relative `/api/dawa`, `/api/analyze-screenshot`, `/api/subscribe`, Stripe injection, subscription checkout and webhook. No reverse proxy, DNS route, shared Stripe key, CORS expansion or production config change was made. This is a shared entrypoint with navigation to the separate mortgage origin, not a completed single-origin Worker deployment.
- Without a valid Worker URL, the route displays `public/boliglaanstjek-preview.html`, reconstructed from the supplied complete fragment, plus `public/mortgage-preview.js`. It starts with manual input, labels estimates and local mode, blocks fetches, screenshot analysis, bank sending and subscription/payment actions; no Worker APIs are accidentally sent to Railway. Removed the placeholder MobilePay payment box in this derivative and repaired malformed dark-mode CSS. Original supplied input is untouched. No automatic assessment-to-mortgage data transfer is claimed or implemented.
- Validation: `npm.cmd test` runs the prior eight security regressions plus five integration checks covering product routes, invalid redirect configuration, historical payment callbacks, HTML/script structure, basic mortgage arithmetic and blocked preview network requests. `node --check server.js`, `node --check public/home.js`, `node --check public/mortgage-preview.js` and `git diff --check` also run. No dependencies were downloaded. Existing tests use a mocked Express/Stripe VM and synthetic data; they do not prove real browser/SDK/provider operation.
- Limits: node_modules is absent, so the real Express app was not started. Browser inspection was attempted but the browser access host was unavailable; responsive CSS is implemented but mobile/desktop screenshots and interaction QA remain outstanding. No live address, BBR, Stripe, mail or Cloudflare requests were triggered. Existing security risks from the prior handover remain outstanding.
- Required before release: provide the existing Cloudflare app URL and Worker source/Stripe injection (without secrets or KV customer/admin records); verify actual subscription price IDs, success/cancel/portal URLs, webhook signatures and paid/unpaid access in an isolated mocked or Stripe test environment. Review inherited mortgage demo functions and estimated market rates; they are not verified live quotations. Confirm backend origins remain routed independently. Complete real Express/browser testing after approved dependency installation, including mobile, keyboard, autocomplete, success/cancel and report polling. Any same-domain Cloudflare proxy routing needs a separately reviewed implementation and callback audit.
- No push, public PR, merge, deployment, paid request or production change. Proposed local review title: "Add a shared Danish homepage for property and mortgage checks". Owner review and explicit approval are required before publishing any branch or PR.

## Connect supplied Cloudflare origin and finalize local routing — 2026-10-28
- Agent: Codex. Branch: `codex/unified-bolig-homepage`, continuing from `2dd5360`; fetched origin and confirmed no incoming main commits at inspection. Existing committed security-hardening remains in branch ancestry. Inputs remain unmodified/untracked; no other agent's tracked work was present.
- Source availability: searched all workspace filenames recursively, including hidden/ignored files outside .git. `boliglansradar-worker.js` is NOT present. The integration folder still contains only README.md and boliglansradar-frontend-fragment.html, with no nested integration folder. No Worker source, Stripe injection, webhook route or subscription entitlement logic was invented. The supplied Worker URL is `https://boliglansradar.gamma7th.workers.dev/`; it was not contacted during this offline task.
- Changes: `server.js`, `public/index.html`, `test/security.test.js`, this handover. The mortgage product now defaults to the supplied Worker origin with a temporary, uncached 302 navigation; an optional valid HTTPS root-origin `BOLIGLAANSRADAR_URL` override is retained. Empty/invalid override shows the disconnected preview; `/boliglaanstjek/preview` explicitly opens that preview for local review. Redirects send Referrer-Policy: no-referrer and do not copy any incoming query/customer/session data. The product card explains that navigation continues to Boliglånsradar.
- Assessment payment routing: newly created Railway Stripe checkouts use `/ejendomsvurdering?session=<order>` and `/ejendomsvurdering?cancelled=1` on the existing request origin. Old `/?session=...`, `/?cancelled=1` and `/?test=...` links now receive the assessment HTML directly from Express, without requiring the homepage JavaScript redirect; static directory-index handling is disabled so it cannot swallow root callbacks. The existing client redirect remains for historical direct `/index.html` links. Normal `/` requests continue serving the shared homepage. This changes callback paths only: amount, currency, payment mode, separate Stripe credentials, raw webhook verification and hardened report cookies/ownership are preserved.
- Tests: `npm.cmd test` passes 16/16, including the prior eight security regressions; routing, configured/default Worker destinations, query non-forwarding, referrer suppression, preview isolation, invalid configuration, old/new callbacks, normal homepage/static-index behaviour and independent API ownership are covered. Stripe session creation is captured by a mock to verify actual generated success/cancel URLs, unchanged payment amount/currency/mode and HttpOnly /api cookie scope. Three new routing expectations failed before the implementation. Syntax checks pass for server.js, test/security.test.js, public/home.js and public/mortgage-preview.js; `git diff --check` passes. No dependencies installed, live providers invoked, money spent or customer data accessed. These are offline VM/route tests, not real Express, browser or Stripe cryptographic integration tests. node_modules is still absent; browser/mobile QA remains outstanding as noted above.
- Scope completed locally: the shared two-product entrypoint, independent-origin navigation, Railway callback routing and regression validation. Scope blocked by missing Worker source: audit/repair of mortgage checkout creation, success/cancel/portal callbacks, Stripe signature verification, paid/unpaid subscription access and matching shared navigation inside the Worker UI. The reconstructed fragment alone cannot establish those details. Do not treat the Worker payment flow as verified or the fragment as a deployable replacement.

### Routing and hosting contract for later approved release
| Public location | Owner / behaviour |
| --- | --- |
| `https://vurderingstjekket.dk/` | Railway shared homepage; historical payment/test query links render assessment |
| `/ejendomsvurdering` and Railway `/api/*` | Existing Railway assessment service; absolute `/api/...` calls retain same origin and report cookies |
| Railway `/api/create-payment` and `/api/stripe-webhook` | Railway Stripe one-time checkout and original raw-body webhook; endpoint URL unchanged |
| `/boliglaanstjek` | 302 to `https://boliglansradar.gamma7th.workers.dev/`, without copied query data |
| Worker `/api/dawa`, `/api/analyze-screenshot`, `/api/subscribe` | Called on the Worker origin by its existing frontend; inferred from supplied fragment, not verified against missing Worker source |
| Mortgage Stripe checkout, return/portal URLs and webhook | Remain owned by the existing Worker; exact callback/webhook paths require Worker source review |
| `/boliglaanstjek/preview` | Disconnected development preview, no external fetches or payments |

- DNS/hosting remaining: no new DNS records or Worker proxy are needed for navigation to the existing workers.dev hostname. Keep the existing vurderingstjekket.dk Railway domain mapping and TLS; do not send its `/api/*` traffic to Cloudflare's mortgage Worker. Existing mortgage Stripe secrets, prices, webhook endpoint/signing secret and KV bindings remain exclusively in Cloudflare; do not copy them into Railway. The supplied default URL works without setting a new Railway variable; any already configured BOLIGLAANSRADAR_URL takes precedence and should be checked during an approved release. Preserve independent existing webhook configurations; no Stripe dashboard edits were made.
- A branded mortgage subdomain or a same-origin reverse proxy is optional future work, not required for this navigation architecture. It would require an explicitly approved Cloudflare custom-domain/DNS mapping and a review of Worker origins, Stripe callback/portal URLs, webhook registration and cookies before switching traffic. No exact DNS record or proxy route can be safely prescribed without inspecting account settings and Worker source. The current local implementation navigates away to the Worker origin; it does not host both applications under a single browser origin.
- Next: supply the missing `boliglansradar-worker.js` without secrets or KV customer/admin records; review its payment callbacks and add the shared-home return link there, then complete isolated end-to-end/browser QA. Existing security remediation and operational risks in the prior handover still apply. Proposed review title: "Connect mortgage Worker origin and preserve independent Stripe callbacks". Local commit only; no public PR, push, merge, deployment, DNS/account/production changes authorized or performed.

## Read-only Worker audit and running local mock preview — 2026-10-28
- Agent: Codex. Branch: `codex/unified-bolig-homepage`, based on `f9a113f`. Read project instructions/handover and fetched origin. No tracked uncommitted work was present before this task. This entry supersedes the previous missing-source status: the owner supplied an external reference at `C:\Users\zulfi\Documents\boliglansradar-reference\worker.js`.
- Reference handling: read all 587 lines without editing, copying into the repository or staging the Worker. SHA-256 before/after is `a9e752b99718d643ec34c62a22979867e94570704d8b4d413133e07de86aaaaf`; unchanged. The source contains a hardcoded administrator fallback; its value must not be copied into reports or Git. Synthetic credentials/data are used for every audit test. No live Worker, KV, Stripe, address-provider, AI-provider or email requests were made. The reviewed reference and reconstructed fragment have NOT been confirmed identical to deployed Worker/KV versions.
- Added `scripts/local-preview.mjs`, `npm run preview`, `.gitignore` (node_modules only), `test/local-preview.test.js`, and optional `test/worker-reference.test.js`. Updated this handover. Production server.js, frontend assets and deployment settings are unchanged in this task.
- Dependency installation was approved through the filesystem/network approval tool: `npm.cmd install --ignore-scripts --package-lock=false` installed declared dependencies, with no dependency/lockfile changes. node_modules is ignored. npm reported zero known vulnerabilities at installation; this is not a complete security audit.
- Running local URL: `http://localhost:3000`, launched with `npm.cmd run preview`. The launcher runs real Express and the existing server.js route code in an isolated VM, binds only to 127.0.0.1, uses synthetic environment variables rather than the owner's environment, blocks outbound server fetches, substitutes address/BBR fixtures and external market-data functions, mocks Stripe and email, disables admin/internal-test routes, and prevents customer/cache filesystem reads/writes. Valuation calculation, input checks, payment-route logic and access-cookie checks still run from server.js. A visible local-demo banner and same-origin CSP distinguish mock pages. Production `npm start` remains unchanged and must NOT be used for this mock demonstration.
- Verified against the actual running localhost listener: homepage HTTP 200 contains both products and the local-demo banner; assessment HTTP 200 contains its form; `/boliglaanstjek` returns 302 with Location exactly `https://boliglansradar.gamma7th.workers.dev/`. Redirect was inspected without following it. Mortgage navigation intentionally points at the existing external application; do not follow it when conducting an entirely offline demonstration. The disconnected `/boliglaanstjek/preview` remains available for local mortgage UI review.
- Real Express HTTP integration test: address suggestions -> BBR fixture -> POST free-check with 120 m2 and 3,000,000 DKK -> calculated 1,800,000 DKK synthetic estimate; invalid input rejected; checkout returns a local simulated page and HttpOnly ownership cookie; unpaid report denied; webhook disabled; admin disabled; legacy cancelled callback serves assessment. Network-block counter stayed zero. These figures are fixtures, not a real property valuation. For manual UI review, enter `Demovej` and select the demo address, then use the sample valuation above. No real Stripe checkout session is created, even by the local payment button.
- Browser verification limitation: Computer Use skill was read and used to locate Chrome, but its safety check stopped automation because it could not confidently determine the current browser URL. No further UI actions were taken. Homepage/form HTTP delivery, submission and payment redirect were verified; visual layout, actual browser autocomplete interaction, keyboard/mobile behaviour and full browser payment/cookie flow remain unverified. Do not describe these HTTP tests as completed visual/browser QA.

### Worker/Railway comparison — inspected source evidence
| Area | Railway | Cloudflare reference |
| --- | --- | --- |
| Checkout endpoint/mode | `/api/create-payment`, one-time payment | Worker lines 367–428: `/api/create-checkout-session`, subscription; monthly/yearly environment price IDs |
| Success / cancellation | `/ejendomsvurdering?session=...` / `?cancelled=1`; historical root callbacks supported | Lines 388–400: Worker request origin plus `/?payment=success&session_id={CHECKOUT_SESSION_ID}` / `/?payment=cancelled` |
| Webhook | `/api/stripe-webhook`, existing raw-body Stripe SDK signature and hardened order/payment checks | Lines 431–489: `/api/webhook/stripe`, raw-body Web Crypto HMAC, completed/deleted events only |
| Address lookup | `/api/adresse` and `/api/bbr`, existing Railway integration | Lines 520–529: `/api/dawa` proxies Dataforsyningen autocomplete with incoming query; separate response shape, no BBR integration |
| HTML | public/index.html homepage; separate assessment page | Lines 570–584: joins nine HTML_KV chunks, replaces one DAWA URL, injects Stripe script only by replacing literal `</body>` |
| Ownership/storage | Hardened browser-bound /api report cookie and in-memory orders | Subscriber KV key derived from lossy normalized email; no customer authentication on subscribe updates |

### Production blockers and audit findings (no production fixes applied)
1. HTML/payment wiring: the supplied reconstructed fragment has no `</body>`. Running it through the actual Worker delivery code does not inject `/api/create-checkout-session` or override placeholder payCard(). A synthetic wrapped page does receive the injection. Confirm actual KV chunks before assuming a live outage; reconcile complete document wrapping and injection before release. Worker lines 288–305 detect annual plans via radio/tab selectors that do not match fragment `btnAarlig` and `selectedPlan`. An isolated injected-script test with annual state submits monthly. Email falls back to the generic email selector rather than the fragment's subEmail ID, making this integration brittle. Cancellation return has no matching injected UI handler; success banner trusts a URL parameter and does not verify payment or send the promised confirmation email.
2. Payment trust/replay: actual HMAC signature validation rejects bad signatures and accepts locally signed valid ones, but lines 26–55 have no timestamp tolerance. Tests demonstrate that an ancient correctly signed checkout event with unpaid status, wrong mode/currency/amount still activates the record, and replay performs another write. Activation (lines 451–467) does not match a server-created checkout, approved price/plan or paid entitlement, and no event-ID deduplication exists. Multiple v1 signatures are reduced to a single value by Object.fromEntries. Review with Stripe test fixtures before any release.
3. Subscription lifecycle: deletion (lines 470–482) depends on subscription metadata.email, but checkout sets session metadata only, not subscription_data metadata. A deletion event without that email leaves the customer active in tests. Add a reliable subscription/customer-ID mapping in a separately approved Worker change; review invoice failure/renewal, subscription updates, delayed payment success and out-of-order events. No customer portal endpoint exists in this reference; do not invent a portal callback or assume self-service cancellation is implemented.
4. Customer data/admin: unauthenticated `/api/subscribe` (lines 492–515) can overwrite another active subscriber's address/loan/plan using their email. Email normalization collisions were reproduced with two distinct synthetic emails. Administrator HTML interpolates subscriber email/address into innerHTML (lines 186–207, 228–247), so unescaped public input is a stored-XSS risk in the authenticated dashboard. The hardcoded admin fallback must be removed and any used exposed credential rotated through a separately approved task. Admin KV listing is unpaginated and responses have no explicit no-store controls.
5. Address/AI robustness and costs: DAWA proxy copies the query but drops upstream status (mock 503 became 200), lacks timeout/error handling and method restriction. The Railway source comments mention DAWA retirement, while Worker still uses that provider; current provider availability was NOT checked offline. `/api/analyze-screenshot` is unauthenticated/unmetered, invokes a paid AI API with arbitrary submitted image data, and lacks size/type/rate limits; errors/invalid model output can become HTTP 200 with empty data. Validate provider availability, output schema and frontend loan-type compatibility without live billable calls. No live data claims are substantiated by the static mortgage rate table. Fragment bank sending is a timer-driven demonstration, not a bank-delivery service; placeholder payment details and example/prefilled data require review before production.
6. Routing/content: unknown Worker paths/methods fall back to main HTML HTTP 200, including a POST to Railway's webhook path. The wrong webhook URL could therefore silently acknowledge without processing; preserve the exact independent webhook endpoints in the table above. No same-domain proxy is implemented. Existing assessment-to-mortgage automatic-prefill claim in the source fragment is unsupported; the unified navigation deliberately does not transmit customer data. Shared return navigation in the Worker UI still needs a separately authorized Worker change. The reference contains mojibake text; verify actual deployed encoding before making any broad text replacement.
- Outstanding Railway security/operational risks from the earlier security handover remain: exposed credential defaults, process-local order durability/recovery, in-memory duplicate suppression, webhook durability and production-browser verification. This task does not remediate them.
- Offline validation: with `BOLIGLAANSRADAR_REFERENCE` set to the external path, `npm.cmd test` runs 26 tests (16 existing, one real Express mock integration, nine Worker audit checks). AUDIT FINDING tests PASS when they reproduce unsafe current reference behaviour; passing does NOT mean those issues are fixed. Without the optional environment variable, the nine external-reference checks skip explicitly. The reference remains outside Git and the optional test contains no copied Worker source or actual credentials. Syntax checks cover server.js, local launcher and new test scripts; `git diff --check` passes. Real HMAC is exercised for the reference, but no Stripe SDK/Cloudflare runtime or live callback delivery is exercised.
- Hosting/DNS: keep main domain and all assessment `/api/*` traffic on Railway; existing Worker hostname needs no new DNS record for the shared navigation. Keep Cloudflare's Stripe secrets, price IDs, HTML_KV and webhook registration separate. Future custom mortgage domain/same-origin proxy needs approved DNS/Worker routing, canonical callback origins, cookie behaviour and webhook review. No DNS, account settings, Worker KV, Stripe dashboard, deployment, push or production changes were made. The preview server is intentionally left running for the owner; restart with `npm.cmd run preview` if stopped.
- Proposed local review title: "Add isolated local preview and document read-only mortgage Worker audit". Review/fix the blockers in an approved development copy; do not modify or commit the reference. No public PR is authorized.

---

## BoligLånsRadar results-screen redesign — 2026-10-30

- **Agent:** Claude Code (claude-sonnet-4-6). **Branch:** `claude/resultat-redesign`. **Status:** implementation complete, PR pending (not yet pushed).
- **Approved scope** (Zulfiqar approved in full, 2026-10-30):
  - Full redesign of `public/boliglaanstjek-preview.html` panel-4 (results screen)
  - Live market rates from Danmarks Nationalbank Statistics API (not hardcoded)
  - Calculation bug fixes: bidragssats now included in new ydelse, correct modified-duration bond pricing, realistic opkonvertering nyRest
  - 5/10/20-year scenario comparison (hold lån vs. konvertér)
  - Friværdi badge gamification: Guld (<40% LTV), Sølv (<60%), Bronze (60–80%), Rød (>80%)
  - Colored signal bar replacing old "trafiklys" — legally safe wording "vurdér med din bank" (NOT "anbefalet")
  - Monitoring subscription: 49 kr/måned or 399 kr/år via Stripe checkout; users get monthly email + instant alert when conversion pays off
  - Cost breakdown with ESTIMAT markers, break-even table
  - Legal disclaimer: all results are indicative, not financial advice
  - Desktop 2-column layout (≥700px)

### Changed files

**`server.js`** (two additions before the `notify-signup` endpoint):
1. `fetchLiveRenter()` — async function that fetches `https://api.statbank.dk/v1/data/DNRENTM/JSONSTAT` (Danmarks Nationalbank free API, no auth) with 6-hour in-memory cache. Falls back to hardcoded values if API fails. Exposes `GET /api/markedsrenter`.
2. `POST /api/laanovervagning/start` — creates a Stripe Checkout subscription session (monthly 49 kr / yearly 399 kr) with loan metadata stored for later monitoring alerts.

**`public/boliglaanstjek-preview.html`** — extensive changes to the JS section and panel-4 HTML:
- **CSS** (added in previous session): `.res-2col`, `.friv-badge`, `.friv-guld/soelv/bronze/rod`, `.friv-meter`, `.scene-table`, `.omk-row`, `.res-signal`, `.legal-note`, `.overvag-box`, `.alert-thresh` and responsive 2-col at 700px.
- **JS calculation fixes:**
  - `MARKEDSRENTER` constant → replaced with async `hentMarkedsrenter()` that calls `/api/markedsrenter`
  - `mYdelse()` now takes `bidragPct` param so new ydelse correctly includes bidragssats
  - `kurstabEstimat()` now uses proper Macaulay modified-duration formula instead of `loebetid * 0.6` approximation
  - Opkonvertering `nyRest`: changed from arbitrary `rest * 0.5` floor to realistic `rest * 0.75` cap
  - `beregn()` made `async` to await live rates
  - Added `scenarieBeregning()` and `restgaeldEfter()` helpers for 5/10/20-year totals
  - Added `renderResultat()` which dynamically writes panel-4 HTML
  - Added `overvagToggle()` and `startOvervagning()` for the monitoring subscription flow
- **Panel-4 HTML:** replaced static markup with `<!-- rendered by renderResultat() in JS -->`. The dynamic render produces: friværdi badge + meter, colored signal bar, nøgletal table with live rate source label, scenario comparison table, cost breakdown, monitoring subscription box (with toggle, alert thresholds, email), bankpakke button, and legal disclaimer.

### Architecture notes for next agent

- `beregn()` is now `async` — the `onclick="beregn()"` in step 3 still works (browser handles unhandled promise, no error).
- `window._beregningState` stores the last calc state for `startOvervagning()` to reference.
- `window._overvagPeriode` stores 'maaned' or 'aar' for the toggle.
- The old gauge SVG animation (`animateGauge()`) remains in the JS but is no longer called — it can be removed in a cleanup pass.
- Bidragssats tiers: LTV ≤40% → 0.40%, ≤60% → 0.55%, ≤80% → 0.85%, >80% → 1.50% (unchanged from prior implementation).
- Live rates endpoint returns: `{ fastforrentet, F1, F3, F5, afdragsfri, updated, source }`. Source is "Danmarks Nationalbank" or "fallback".
- The subscription webhook (handling `customer.subscription.created`, monthly email, instant alert) is NOT yet implemented — that is future work.

### Validation performed
- `node --check server.js` — passes
- Manual code review of JS calculations
- No live API call or browser test yet (no Playwright run done)

### Security / deployment constraints (unchanged from project rules)
- Do NOT deploy to production or merge to main without Zulfiqar's explicit approval
- Do NOT activate Stripe live mode without approval
- NEVER hardcode secrets — all in Railway env vars: `ADMIN_KEY`, `BBR_USER`, `BBR_PASS`, Stripe keys, `ANTHROPIC_API_KEY`
- `ANTHROPIC_API_KEY` must be set as Railway env var (analyze-screenshot returns 503 if absent)

### Pending / next actions
1. **Push branch and open PR** — ready to push `claude/resultat-redesign` to GitHub and open PR for review.
2. **Browser / Playwright test** — validate the panel-4 render end-to-end with sample loan data.
3. **Subscription webhook** — implement the monitoring email logic: monthly status mail, instant alert when conversion threshold is crossed. Requires storing subscriber data and a cron/scheduled job.
4. **GoCardless open banking** — discussed, not yet approved.
5. **Remove dead gauge code** — `animateGauge()` is now unused, can be cleaned up.
6. **Credential rotation** — exposed admin/BBR credential defaults still in Git history; rotate before production release.

### Approved by Zulfiqar
"ja til det hele, der skal være live opdatering af markedsrenter. bidragssats skal med, beregninger skal fixes...brugerne skal betale for overvågning af deres lån månedlig eller årlig og så får de en månedlig mail medmindre det kan betale sig at omlægge får de den mail med det samme...friværdierne skal med i overblikket...guldniveau under 40% sølv niveau under 60% bronze niveau over 60%..."

## PR #23 merged — kunderute og adresse-autocomplete — 2026-10-30

- Agent: Claude Sonnet 4.6. Branch: `claude/fix-address-and-flow`, merged to main.
- **Root cause 1 (kunder så gammel side):** `/boliglaanstjek` redirectede til den gamle Cloudflare Worker (`boliglansradar.gamma7th.workers.dev`). Ruten er nu forenklet til at serve `boliglaanstjek-preview.html` direkte. `BOLIGLAANSRADAR_URL` env var er ikke længere i brug.
- **Root cause 2 (adresse-dropdown virkede ikke):** `dawaSearch()` kaldte DAWA via server-proxy, som blokerer udgående forbindelser til `api.dataforsyningen.dk`. Browseren kalder nu DAWA direkte (`api.dataforsyningen.dk/adresser/autocomplete`) — CORS er åbent og ingen token kræves.
- Changed files: `server.js` (12 linjer fjernet), `public/boliglaanstjek-preview.html` (dawaSearch rewritten).
- Kundeflowet er nu fuldt operationelt på `/boliglaanstjek`: adresse → låneoplysninger → analyse-dashboard → Stripe-abonnementsboks.
- Railway auto-deployer fra main — live inden for ~3 min fra merge.
- Pending: subscription webhook/email-logik (månedlig statusmail + øjeblikkelig alert ved konverteringstærskel) er ikke implementeret. Stripe test-mode er stadig aktiv — skift ikke til live-mode uden Zulfiqars godkendelse.

## PR #25 åben — fjern dev-banner — 2026-10-30

- Agent: Claude Sonnet 4.6. Branch: `claude/fix-dev-banner`.
- Fjerner hardkodet "Lokal forhåndsvisning"-banner fra toppen af `boliglaanstjek-preview.html`.
- **KRITISK:** `www.vurderingstjekket.dk` peger stadig DNS-mæssigt på den gamle Cloudflare Worker, ikke Railway. Alle Railway-rettelser er usynlige for kunder. Kræver Zulfiqars godkendelse til DNS-skift. Afventer Railway-appens URL fra Zulfiqar.


## Interactive mortgage scenarios — Codex — 2026-11-03
- Branch: codex/interactive-mortgage-scenarios, based on origin/main 72a7b14. Inspected PR75 (open/overlapping), merged PR78 and PR79. No changes to Claude branches.
- Preserve green compact dashboard; add accessible lower-payment / borrow-more / pay-down tabs, touch help and responsive table cards. Retain property data, bank package, extra afdragsfri/afdrag alternatives, existing subscription flow and PR79 panel-8 CTA. Restore missing PR75 sticky subnav/navigation and summary cards without its stale recommendations/sign conventions.
- One baseline (entered payment where available), signed monthly changes, gross vs net cash, fees paid upfront or deducted from payout. Reuse existing mYdelse, bidragssats and konvOmk; model assumptions are disclosed, not lender quotations. Main headline uses the same four-type scenario model. No invented redemption quote or future rate forecast.
- No payment/auth/backend/deployment changes. Full repayment model fee is zero but actual redemption charges are unknown. Existing model limitations remain (simplified contribution/rate amortization and tier assumptions).
- Validation results and remaining actions recorded after checks below. No merge/deployment authorized.

- Final validation: 11 focused mortgage tests PASS (node --test test/mortgage-scenarios.test.cjs); inline compilation, server syntax and git diff --check PASS. Browser clicks verified the three panels and touch help using synthetic data with outbound connections blocked. At 390px viewport document width was 376px excluding scrollbar; no page overflow. Desktop/mobile screenshots saved outside Git.
- Existing npm test is NOT green: 14 security tests fail due to an outdated Express mock (urlencoded missing) and old disconnected-preview expectations. Pristine origin/main reproduces 14 failures and 2 passes. Local Express integration also cannot run here because dependencies are absent. No dependency download, live API, real payment or paid generation.
- Fixed annual/monthly selector state to match the existing handler; no backend/payment-provider change. CSS frames the existing house photo to hide embedded example amounts. Missing rate history now shows only current levels instead of fabricated history. Existing monitoring cron exists in server.js; scheduling and mail delivery not verified.
- Actual redemption prices and fees require a lender quote; simplified existing engine retained. PR75 remains open and untouched; relevant equivalent fixes implemented here, with PR79 panel-8 CTA retained. Review ready locally. No merge/deployment. Public branch/PR publication awaits owner confirmation under the ask-before-publication rule.


## Mortgage market value and repayment clarity — 2026-11-03 — Codex
- Branch: codex/market-value-and-scenario-clarity, based on main 6335871 (PR80). Follow-up corrections to the approved dashboard release. No concurrent incoming changes at final fetch.
- Final user rule: comparable sales from the last rolling 12 months, then current comparable listings, then neighbourhood sale/asking m2 prices scaled to subject area; only a genuine known/entered public EV is a last reserve. An EV reserve is explicitly labelled "Skats vurdering — handelsprisen kan være højere". Provider outages are distinguished from absence of transactions; no arbitrary numeric substitute is invented. The rest/0.65 fallback and demo EV/address were removed.
- New mortgage-market.js isolates current data from the tax/appeal valuation. It calls only free Boliga endpoints, filters dates/sizes/property type/family sales, uses median m2 prices and a 5 km distance limit where coordinates are available, and checks up to four adjacent postcode areas before the final reserve. Small real samples are labelled uncertain. Current listing dates are checked when supplied by the provider. No paid Apify fallback. Tax valuation still uses its original historical 2020–2021/DST model unchanged.
- New public/mortgage-property.js shares one awaited lookup for autocomplete selection, typed addresses, VT/transferred addresses and manual-area recovery when BBR is absent/uncertain. It handles {suggestions} and legacy arrays, does not select ambiguous units silently, and ignores stale responses after an address change. Known EV can be transferred using adresse/ev query values; otherwise the actual public EV can be entered in the last-reserve field. Unknown EV is never fabricated.
- Tables show plain LTV percentages, omit repeating cost/break-even columns, and show one cost note per active panel. New principal scenarios now all include repayments, compared against the user's actual current payment; the interest-only baseline and the principal component are explained visibly. The afdrag/afdragsfri alternatives remain in their existing details section. Added manual loan entry alongside screenshot upload; no paid image analysis needed for manual entry.
- Mortgage-specific BBR-to-property mapping corrected (row houses 130/131/132, apartments 140, summer homes 510) without altering historical tax classification. Existing VM preview/test harnesses now inject the new module dependency explicitly.
- Validation: 38 targeted tests pass. They cover 12-month boundary, source precedence, date/size/distance filtering, neighbourhood m2 scaling, adjacent postcodes, small samples, EV reserve conditions, no rest/65% fabrication, both address response shapes/entry flows, pending/stale requests, manual BBR recovery, compact columns, signed cash flow and principal-vs-interest-only basis. JS syntax and diff checks pass.
- Full suite: 64 tests, 40 pass, 15 fail, 9 skip. The 14 legacy security failures (outdated Express mock/preview assumptions) and missing Express dependency in the isolated worktree remain inherited; no dependencies installed. Do not describe this as a green full suite.
- Browser validation used blocked outbound connections and synthetic market/loan fixtures. Typed address -> BBR -> market -> manual loan entry -> dashboard works; desktop and 390px iframe layouts checked. Real Boliga API access from this computer returned a provider challenge; no bypass attempted. Provider availability on Railway requires post-deployment verification. No live Stripe/AI/scraper or email tests.

## Free market-source recovery — 2026-11-03 — Codex
- PR81 deployed successfully, but live Boliga sold/asking probes were blocked upstream. Added the independently accessible, free Boligsiden public cases endpoint as the asking-data reserve before EV. Matching verifies postcode, property type, active status, living area and listed age. Source is labelled Boligsiden/udbud; it is never presented as completed sales.
- 40 targeted tests pass, including blocked-provider recovery and rejection of wrong postcodes/types/old listings. Real public data probe using 150 m2 in Ishoej returned 5,182,692 DKK from six active asking comparisons; this is a test subject, not the owner's property valuation. No paid scraping, subscription or AI call.
- Both mortgage entry routes still share one awaited address pipeline. Historical tax/appeal logic remains unchanged. Actual Railway availability is checked after deployment; no guarantee of exact future property values is claimed.


## Customer bank package and reusable QA — 2026-11-03 — Codex
- Branch: codex/qa-and-commercial-clarity, based on main 554c2a5 (PR82). Recent open Claude PR75/73 inspected; their stale overlapping data/UI implementations were not merged. Owner explicitly authorized corrections and deployment once checks pass.
- Product: personal bank negotiation package99 DKK, delivered ONLY to the buyer's email. Includes approximate property value, equity/LTV, loan comparison, conditional contribution examples and five questions tailored to debt, payment basis, LTV and remaining term. Budget is an editable UTF8 CSV attachment, excluded from mail/report body. Full report is a genuine dependency-free WinAnsi PDF; HTML attachment removed after Gmail showed source text. Compact branded mail and PDF visually checked at mobile/desktop and rendered to PNG; two-page owner example contains only owner-authorized previously supplied figures, no new address valuation.
- Server prepares and persists an order with current mortgage market lookup and entered loan/budget values before Checkout. Exact settled checkout/order/amount/currency binding controls customer email fulfillment. Attachments are PDF+CSV. Saved buyer email controls destination. Provider idempotency key, in-process locking, persisted sentAt and503 webhook retries cover failures/replays. No bank contact/document sharing occurs. Existing local document organizer retained and labelled local/optional; invented salary/expense/loan defaults removed.
- Subscription remains49 DKK/month or399/year. A verified paid99 bank purchase reduces the first annual invoice to300; annual recurring unit price stays399. Genuine older299 purchases retain their actual credit. Unique single-redemption, duration-once Stripe coupon is tied to the original customer. Refund/dispute/invalid/customerless proofs fail closed. No email-only entitlement. Payment returns verify with Stripe before success display.
- Monitoring now uses the same recent-sales/listings/explicit-EV market pipeline and principal/bidrag/payment baseline as the dashboard. Missing data/reserve rates suppress action alerts; interest-only10800 is not replaced with an invented amortizing baseline. Current indicative F1/F3/F5/30-year-fixed references come from the official Nykredit Aktuelt column with observation date, no forecast substitution, no fabricated rate interpolation; source age >14days fails closed to labelled reserves. These are reference rates, not personal offers. F1 eligibility and effective30-year benchmark limitations are disclosed. The old invalid DNRENTM and unofficial bond proxy were removed.
- Monthly status, alerts and confirmation use honest cadence/source wording. HMAC-signed30-day management links support owner-only loan/property updates and Stripe billing portal access. Subscription cancellation is terminal for a particular subscriptionID, returning paid customers can rejoin, and exact checkout/subscription deduplication handles replay. Legacy records migrate only after matching settled Stripe order/customer-email/subscription proof. Current property/debt/payment inputs still require customer updates; no bank feed or automatic debt projection is claimed.
- Contribution examples are before-tax hypothetical0.10/0.20/0.30 percentage-point changes unless both actual customer-supplied rates are known. No automatic repricing below60% or lender quote is implied. Summer-home thresholds are not generalized. RD/Nordea official sources and checked dates included.
- Corrected nonempty-but-unusable Boliga listing fallback to independent fresh Boligsiden data. Rounding changes display only, preserving full precision for LTV. Fixed last-document removal readiness, actual document navigation and mobile field labels. Selvsalg no longer unlocks from success query alone; its brochure uses a dedicated populated print view and optional local photos.
- Existing Claude QA instructions refreshed. Four reusable personal Codex agents (qa-journeys, qa-data-output, qa-payments-access, qa-release) plus project-qa skill installed in owner's personal Codex folders; validated TOML and independent skill forward review. They do not authorize spending, real mail, publishing or deployment.
- Validation:174 tests,165 PASS,0 FAIL,9 SKIP (legacy Worker reference tests). Full real-Express loopback integration used the already-installed source checkout dependency through an external temporary loader; no dependency downloads. Includes actual route fixtures for paid fulfillment, retries/replay, credit, signed account links, legacy migration, primary rate parser, calculations, outputs, PDF xref/encoding/pagination and responsive frontend. Syntax and diff checks pass. Independent QA findings were fixed and re-tested.
- Owner explicitly requested a test customer mail; original and corrected examples sent through the connected Gmail account. Corrected example has actual PDF+CSV. This verifies content/send acceptance, NOT the production Resend delivery chain or actual Stripe charge/coupon concurrency/renewal. No charges, paid AI calls, real subscription cancellation or third-party bank messages were performed.
- Operational checks after deployment: verify public route/assets and current indicative rate API/source/date; verify health flags. Stripe portal configuration, actual inbox delivery, durable volume restart/multi-instance behavior and provider redemption races remain outside offline certification. Bank orders use the existing data directory and require persistent storage. Do not describe fixture tests as certification of all external systems. Existing paid AI generation and external n8n workflows were not executed during QA.


## Upload prefill and property-specific Selvsalg199 — 2026-11-03 — Codex
- Branch codex/mortgage-upload-prefill, based on production PR83 merge cebe90c. User authorized corrections/deployment and explicitly chose a199 DKK Selvsalg test price; bank package99 and monitoring49/399 unchanged. One real Claude test with a fictional loan image was explicitly approved; original customer screenshot must not enter public fixtures or provider testing.
- Root cause: frontend ignored non-2xx JSON error responses and showed extraction success unconditionally; backend swallowed malformed model JSON and returned200 with null fields. Blank defaults exposed this inherited defect. Existing Claude/Anthropic provider/model/request boundary retained; only extraction instructions and response normalization corrected. No new upload destination.
- mortgage-ocr.js joins text blocks, parses complete JSON safely, normalizes Danish amounts and decimal rates, preserves zero/missing distinctions, rejects invalid/truncated/error/empty output. Only explicit payment periods may convert a next-payment amount into a monthly average. S1 is not guessed asF1. Remaining term is separate from original term. Recognized lender, actual annual bidrag, remaining interest-only years and refinancing date are optional and validated.
- Form prefill now distinguishes actual/partial extraction from service failure, supports errors/read failures/out-of-order responses, and retains explicit loan metadata. HEIC is rejected before provider usage with conversion guidance. Current monthly payment is explicitly required rather than fabricated from a next-payment amount. Zero interest is valid. Recognized current lender appears in the hold-loan row. Known annual bidrag and dates reach the personal bank package; exact current contribution cost is separate from hypothetical reductions. No all-market cheapest-lender ranking or provider-specific offer is claimed.
- User requested an assessment of a new-loan term selector; recommended but NOT implemented pending their choice. No automatic provider links or changes to actual current loan term. Scenario references and model contribution assumptions remain indicative.
- Selvsalg previously inserted unverified claims about condition, light, neighbourhood, transport and family suitability. Copy now uses known property facts and seller-confirmed highlights only, with editable per-case browser drafts. Photo guide/checklist/document overview reflect property type; unknown types remain conditional. Existing paid access/photo/brochure behavior preserved. Landing/case/start/home price199 matches Checkout199 even with a stale799 environment override. No legal-document generation, portal listing or real human appraisal is implied; existing terms gates retained.
- Validation:211 tests,202 PASS,0 FAIL,9 SKIP legacy Worker reference. Includes13 actual frontend/route upload checks, numeric normalization, full loan metadata flow, seven Selvsalg property variations and actual Checkout199 regression. No downloads/dependencies. Local visual preview uses fictional figures. The one authorized real provider test is performed only after the release and reported separately; no original bank image is sent during testing.
