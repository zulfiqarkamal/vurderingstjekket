# Mortgage lender catalogue: sources and limits

Checked: 2026-11-03. Owner: maintainers of mortgage-lender-catalogue.js. This records independently published numeric facts and modelling decisions; no customer data or copied price sheets are stored.

## Supported comparison

Private owner-occupied year-round homes only (BBR120/130/131/132/140). Three lenders' currently open fixed-rate amortizing series are matched (published coupons0–10% and netprices above50, not restricted to4%), each using that lender's own course and contribution tiers. This is a bounded comparison, not the whole market or a binding loan offer. Variable loans, interest-only alternatives, summerhomes and commercial properties are not ranked in this version. Deep-discountseries increase the fundingdebt and must pass the engine’s LTV and residual-debt checks; a lowcoupon alone is not a saving.

The engine uses the customer's chosen term within10–30years. Tenyears is this comparison's conservative minimum, not an asserted lender rule. The feeds identify a maximum30-year financing series. Published productterms establish that the loan can run up to30years, rather than requiring every loan to run exactly30years:

- [Nordea obligationslån](https://www.nordea.dk/privat/produkter/boliglaan/obligationslaan-med-fast-rente.html): term up to30years and calculations for differing terms. Its coursepage explicitly defines the displayed term as maximum loan duration.
- [Realkredit Danmark obligationslån](https://rd.dk/laantyper/obligationslaan): maximum30years. The official [loan terms](https://www.rd.dk/PDF/Privat/LAANTYPEROGFORRETNINGSBETINGELSER-PRIVATRD.pdf) also describe1–30years and underlyingbondmaturity limits. Final term/offer remains lender-approved.
- [Totalkredit fastforrentet](https://www.totalkredit.dk/boliglan/valg-af-lan/lantyper/fastforrentet/): fixedrate up to30years; the coursepage defines displayed term as maximum amortization period.

## Primary runtime feeds

### Nordea Kredit

[Public coursepage](https://www.nordea.dk/privat/produkter/boliglaan/Kurser-realkreditlaan-kredit.html) embeds an official bank.nordea.dk widget referring to [fixedrate/bonds.json](https://ebolig.nordea.dk/wemapp/api/credit/fixedrate/bonds.json).

Only explicitcoupon/maximum30years/repaymentFreedomMax=Nej rows are used. Markedclosed rows and prices above100 are excluded. Coupon is parsed from the explicit bondname, never from an effectiveyield. The reported optagelseskurs is reduced by the price list's0.20-course-point payoutdeduction; raw and adjustedprices are both retained and this transformation is disclosed. This feed has no observationtimestamp. The catalogue preserves rateObservedAt=null and labels the time as live retrieval, not a fabricated observationdate. The page says rates are refreshed every15minutes; response caching is no-store. Users still need the bank's actual payoutquote.

[Contribution sheet](https://www.nordea.dk/Images/144-119161/20170105bidragssatser.pdf), effective2026-02-23: fixedowner-home marginal tiers0–40/.225%,40–60/.675%,60–80/1.025%. Fixedinterest-only surcharges0/.05/.65percentagepoints are metadata only; no IO product is ranked.

[Fee sheet](https://www.nordea.dk/Images/144-97716/Nordea%20Kredit%20Prisliste%20januar%202025.pdf): its filename says2025 but the actualPDF is effective2026-09-11. Loan fee3500DKK; settlementcommission follows published cashvalue tiers (including0.15% up to3000DKK in the200k–3m band). Additional bank and redemptionexpenses remain unknown.

### Realkredit Danmark

[Public coursepage](https://rd.dk/kurser-og-renter?segment=P) exposes [GetOpenOffers](https://rd.dk/api/Rates/GetOpenOffers). Its JSON payload may be a JSON-encoded string and is decoded without evaluating code. Only loanTypeCode01,30year,publishednominalcoupon,zeroIOterms and an eligible offerprice are used. The most recent nonfuture dated currentprice is selected. Forwardsettlementprices are not substituted. Explicit lastModified supplies observationtime in Europe/Copenhagen.

The displayedprice already includes0.25course-point deduction; it is not subtracted again. The actualpublishedcoupon funds the annuity; any effectiveyield is not used as a secondcoupon.

[Private price sheet](https://rd.dk/PDF/Privat/Prisblad-privat.pdf), effective2026-09-23: fixedowner-home marginal contributiontiers .206/.618/1.012%; IO surcharge above60 is.80percentagepoints (metadata only). Published components include4000DKKloanfee,4000DKKpropertyprocessing and0.15%settlementcommission (minimum175DKK). These are not a complete switchingquote. Existingloanprices may follow older terms. Quarterlypaymentpricing can differ; the model normalizes indicative monthly cashflow, not a contractual installment schedule.

### Totalkredit

[Public coursepage](https://www.totalkredit.dk/boliglan/kurser-og-priser) loads its public price-information widget. The widget exposes [get-bond-products-and-prices](https://gateway.api.nykredit.it/mortgage-product-and-price-overview/get-bond-products-and-prices); requests require Accept: application/json;v=1 (plainapplication/json returns406).

Only AVAILABLE/openForLoanOfferFlag,DKK,FIXED_RATE_COUPON_BOND,FULLY_CALLABLE,ANNUITY,P30Y rows with an explicitpublishedcoupon are used. offerPriceWithMarkDown is used directly, including its0.20pointdeduction. Its timestamp is retained. yieldToMaturity remains separate from the nominalcoupon and cannot drive an annuity as if it were nominalinterest.

[Private price sheet](https://www.totalkredit.dk/siteassets/dokumenter/privat/prisblad/prisblad--privat.pdf), effective2026-07-01: fixedowner-home marginal tiers .45/.85/1.20%; IO surcharges0/.02/.65points are metadata only. Loanfee is up to4000DKK, settlement0.15% minimum150DKK. Intermediatingbankfees may be additional.

[KundeKroner eligibility](https://www.totalkredit.dk/boliglan/kurser-og-priser/kundekroner/) explicitly covers everyprivatecustomer, including newcustomers, with an automatic quarterlydeduction. The catalogue therefore marks .25percentagepoints p.a. as automaticallyapplicable to this privateowner-home scope through2029-12-31. The engine must apply the rebate only through that date and show gross/netpayment plus postexpiry effect. No extension after2029 is assumed.

### Jyske Realkredit: excluded from current ranking

[Products/courses](https://www.jyskebank.dk/bolig/realkreditkurser) and [pricepage](https://www.jyskebank.dk/privat/priser/bolig) are primarysources. The currentpricepage is effective2026-10-01; fixedowner-home tiers .225/.800/1.000%, minimumannualcontribution900DKK. F1 is genuinely available as a new Jyskeproduct; this must not be confused with Nordea's lender-specific restriction.

The server-side publiccoursefetch returned403 during verification. No challengebypass, privatecredential or price from anotherlender is used. Coverage explicitly identifies Jyske as excluded because no reliable live matchedprice was obtained. Its published contributions/fees are recorded as reference metadata only and never create a fakeoffer.

## Freshness and cost safeguards

Quote retrieval coalesces simultaneouscalls per adapter, caches for30minutes per fetchadapter, returns defensivecopies, and carries an explicit expiresAt. Timestampedpublishedquotes older than4days or future-dated beyond5minutes are excluded (weekendgrace). Missing/malformed/closed feeds produce no offers, with coverage reasons. No illustrativefallback is admitted into a multi-lender ranking.

Staticprice-list facts were checked2026-11-03 and expire for this feature2026-12-03. A maintainer must reread the primarysheets and update facts/reviewdates before the cutoff. Afterexpiry, offers are excluded rather than silently using stale tariffs. This conservative reviewexpiry is applicationpolicy, not the lender's announced tarifftermination.

All fees.amount remainnull and fees.known=false for total switchingcost. Detailedpublishedcomponents are retained, but redemptionterms, individualbankfees and tinglysning/possibleprior-dutyreuse require actualcustomerquotes. The engine must not fabricate a full saving/payback or an actionalert from these missingcosts.

## Validation

Offlinefixtures contain reduced numericpublicfacts only. Tests cover matchedlender-specificprices/tiers, no doublecoursededuction, nominalcoupon vs effectiveyield, closed/IO/currency/term rejection, freshness/reviewexpiry, sourcefailurecoverage, automatictime-limitedrebate metadata, cacheisolation and nonstandard21-year maximumterm semantics. Live read-only feedverification returned all three matchedproviders; no paid API, customerinput, checkout or externalmessage was used.

Contactlinks point to actualproductpages, separately from course-sourceURLs. Totalkreditcontact is through its cooperatingbanks, not a promise of a direct Totalkredit bankquote.
