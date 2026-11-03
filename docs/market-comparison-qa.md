# Market comparison release QA — 2026-11-03

Scope: public-price comparison for private year-round owner homes, fixed-rate amortizing loans,10–30 years. Current own-price feeds: Nordea Kredit, Realkredit Danmark, Totalkredit. Jyske is excluded because its price feed could not be read reliably. Variable-rate and interest-only NEW products are not ranked; original reference scenarios remain.

| Boundary | Evidence |
|---|---|
| Official public feeds → matched products | EXECUTED,3 providers and4 live products; own coupon/net price/contribution per provider; no paid API |
| Financing → five-year cash plus residual-debt cost | EXECUTED, independent closed-form oracle and29 engine tests; low coupon cannot win merely from lower payment |
| Free input → redacted teaser | EXECUTED actual route with mocked catalogue; no lender/contact/full rows returned; no extra property lookup quota consumed |
| Completed/refunded/canceled/trial purchase → access | MOCKED Stripe receipts, EXECUTED actual server routes; refund/cancel/trial/expiry denied |
| Bank purchase → frozen comparison → PDF/email | MOCKED payment/mail, EXECUTED builder and replay/retry tests; buyer-only, no bank messages |
| Subscription → fresh comparison for three goals | MOCKED Stripe, EXECUTED actual routes; saved property/loan overrides client data |
| Monthly schedule → comparison → output/alert | MOCKED Stripe/providers/mail, EXECUTED handler; unknown costs do not create action alerts |
| Storage migration/restart | EXECUTED isolated in-memory filesystem, current volume records override legacy, legacy not deleted, corrupt data fails closed |
| Desktop/mobile customer UI | EXECUTED local synthetic customer with real public-rate snapshot;390px page width376px, no horizontal clipping; mobile cell wrapping fixed |
| Customer PDF | EXECUTED4-page local fixture rendered with Poppler; all pages visually inspected; headings stay with following text |

Final suite:304 tests,295 pass,0 fail,9 existing legacy Worker skips. Last wording-only output test7/7pass. No dependencies installed. No real payments, customer emails, AI-image calls or credentials entered. Actual Stripe checkout/provider fulfillment is NOT live-tested by this release.

Limits: totals and personal gain remain unconfirmed when customer redemption, bank fees or risk/IO basis are missing. Public contribution spread is explicitly not a switching saving. Source facts checked2026-11-03 require maintainer review before2026-12-03; ranking fails closed after the catalogue review cutoff. Quotes cache30minutes and exclude stale/closed/unmatched data. Normal statutory consumer rights and existing checkout terms are unchanged; no voluntary refund guarantee or refund button was added.
