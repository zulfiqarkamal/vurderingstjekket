/**
 * Vurderingstjekket v3 — server.js
 *
 * Two-tier property-tax appeal service for Denmark:
 *   FREE  → address lookup (Adressevælger) → BBR auto-fill → EJEN77 market baseline → eligibility result
 *   PAID  → 350 kr via Stripe → Apify boliga-scraper pulls real comps → klage document
 *
 * Required env vars (add as Replit Secrets or .env):
 *   STRIPE_SECRET_KEY        e.g. sk_live_...
 *   STRIPE_WEBHOOK_SECRET    e.g. whsec_...
 *   APIFY_TOKEN              your Apify API token
 *   BBR_USER                 (optional, defaults to IUXUCSLFZW)
 *   BBR_PASS                 (optional, defaults to Ghulab.4u)
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Stripe webhook needs raw body for signature verification
app.use("/api/stripe-webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Explicit fallback so "/" always returns index.html even if static middleware misses it
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Credentials / keys ───────────────────────────────────────
const APIFY_TOKEN           = process.env.APIFY_TOKEN;
const STRIPE_SECRET         = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BBR_USER              = process.env.BBR_USER || "IUXUCSLFZW";
const BBR_PASS              = process.env.BBR_PASS || "Ghulab.4u";
const ADR_TOKEN             = "adressevaelger123"; // official free-tier token

const stripe = STRIPE_SECRET
  ? new Stripe(STRIPE_SECRET)
  : null;

// ─── Kommunekode → Landsdel (EJEN77 OMRÅDE) ───────────────────
const KOMMUNEKODE_TO_LANDSDEL = {
  // 01 – København by
  "0101":"01","0147":"01",
  // 02 – Københavns omegn
  "0151":"02","0153":"02","0155":"02","0157":"02","0159":"02",
  "0161":"02","0163":"02","0165":"02","0167":"02","0169":"02",
  "0173":"02","0175":"02","0183":"02","0185":"02","0187":"02",
  // 03 – Nordsjælland
  "0190":"03","0201":"03","0210":"03","0217":"03","0219":"03",
  "0223":"03","0230":"03","0240":"03","0250":"03","0260":"03","0270":"03",
  // 04 – Bornholm
  "0400":"04",
  // 05 – Østsjælland
  "0253":"05","0259":"05","0265":"05","0269":"05","0320":"05",
  // 06 – Vest- og Sydsjælland
  "0306":"06","0316":"06","0326":"06","0329":"06","0330":"06",
  "0336":"06","0340":"06","0360":"06","0370":"06","0376":"06",
  "0390":"06","0396":"06",
  // 07 – Fyn
  "0410":"07","0420":"07","0430":"07","0440":"07","0450":"07",
  "0461":"07","0479":"07","0480":"07","0482":"07","0492":"07",
  // 08 – Sydjylland
  "0510":"08","0530":"08","0540":"08","0550":"08","0561":"08",
  "0563":"08","0573":"08","0575":"08","0580":"08","0607":"08",
  "0621":"08","0630":"08",
  // 09 – Østjylland
  "0615":"09","0706":"09","0707":"09","0710":"09","0727":"09",
  "0730":"09","0740":"09","0741":"09","0746":"09","0751":"09",
  // 10 – Vestjylland
  "0657":"10","0661":"10","0665":"10","0671":"10","0756":"10",
  "0760":"10","0779":"10","0791":"10",
  // 11 – Nordjylland
  "0773":"11","0787":"11","0810":"11","0813":"11","0820":"11",
  "0825":"11","0840":"11","0846":"11","0849":"11","0851":"11","0860":"11",
};

// Typical average m² for enfamiliehuse by Landsdel (used to derive kr/m² from EJEN77)
const LANDSDEL_AVG_M2 = {
  "01": 100, "02": 128, "03": 155, "04": 120, "05": 148,
  "06": 135, "07": 130, "08": 142, "09": 148, "10": 158, "11": 148,
};

const LANDSDEL_NAVN = {
  "01":"Landsdel København by",   "02":"Landsdel Københavns omegn",
  "03":"Landsdel Nordsjælland",   "04":"Landsdel Bornholm",
  "05":"Landsdel Østsjælland",    "06":"Landsdel Vest- og Sydsjælland",
  "07":"Landsdel Fyn",            "08":"Landsdel Sydjylland",
  "09":"Landsdel Østjylland",     "10":"Landsdel Vestjylland",
  "11":"Landsdel Nordjylland",
};

// ─── BBR helpers ──────────────────────────────────────────────
function bbrAnvendelseLabel(kode) {
  const k = parseInt(kode);
  if (k === 110) return "Stuehus til landbrugsejendom";
  if (k === 120) return "Fritliggende enfamilieshus";
  if (k === 121) return "Sammenbygget enfamilieshus";
  if (k === 122) return "Dobbelt-/kæde-/rækkehus";
  if (k >= 130 && k <= 139) return "Ejerlejlighed / etageboliger";
  if (k === 160 || k === 185) return "Fritidshus / sommerhus";
  if (k >= 110 && k <= 129) return "Enfamiliehus";
  return `Boligtype (BBR-kode ${kode})`;
}

function isEnfamilie(kode) { const k=parseInt(kode); return k>=110&&k<=129; }
function isEjerlejlighed(kode) { const k=parseInt(kode); return k>=130&&k<=149; }

// ─── EJEN77 cache ─────────────────────────────────────────────
const EJEN77_CACHE = new Map();

async function getEJEN77Avg2020_2022(landsdel, ejendomskate = "0111") {
  // Returns { avgPricek, quarters, krPerM2 } averaged over 2020K1–2022K4
  const key = `${landsdel}|${ejendomskate}`;
  const cached = EJEN77_CACHE.get(key);
  if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) return cached.data;

  const quartersParam = [
    "2020K1","2020K2","2020K3","2020K4",
    "2021K1","2021K2","2021K3","2021K4",
    "2022K1","2022K2","2022K3","2022K4",
  ].join(",");

  // BNØGLE=3 → gennemsnitlig pris pr. ejendom (1000 kr); OVERDRAG=1 → fri handel
  const url =
    `https://api.statbank.dk/v1/data/EJEN77/JSONSTAT` +
    `?OMRÅDE=${landsdel}&EJENDOMSKATE=${ejendomskate}&BNØGLE=3&OVERDRAG=1` +
    `&Tid=${quartersParam}&lang=da`;

  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`EJEN77 HTTP ${res.status}`);

  const raw = await res.json();

  // JSON-stat stores values as { "0": 2500, "1": 2600, ... } or as an array
  const valueObj = raw.dataset?.value ?? raw.value ?? {};
  const vals = Array.isArray(valueObj)
    ? valueObj
    : Object.values(valueObj);

  const numbers = vals.filter(v => v != null && !isNaN(v) && v > 0);
  if (numbers.length === 0) throw new Error("Ingen EJEN77-data for dette område");

  const avgPricek = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const avgM2 = LANDSDEL_AVG_M2[landsdel] || 145;
  const data = {
    avgPricek,                            // 1000 kr per typical property
    krPerM2: (avgPricek * 1000) / avgM2, // kr per m²
    quarters: numbers.length,
    avgM2Used: avgM2,
  };

  EJEN77_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

// ─── Adressevælger + BBR ──────────────────────────────────────

// GET /api/adresse?q=<text>  →  returns list of address suggestions
app.get("/api/adresse", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 3) return res.json({ suggestions: [] });

  try {
    const url = `https://adressevaelger.dk/adresser/soeg?tekst=${encodeURIComponent(q)}&token=${ADR_TOKEN}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Adressevælger ${r.status}`);
    const raw = await r.json();

    const suggestions = (Array.isArray(raw) ? raw : raw.results ?? [])
      .slice(0, 8)
      .map(s => ({
        adresseId:    s.adresseidentificerer || s.id || null,
        husnummerId:  s.husnummeridentificerer || s.husnummerUUID || null,
        label:        s.betegnelse || s.adresse || s.tekst || "",
        postnr:       s.postnummer || s.postnr || "",
        by:           s.postdistrikt || s.by || "",
        kommunekode:  s.kommunekode || "",
        vejnavn:      s.vejnavn || "",
      }));

    res.json({ suggestions });
  } catch (err) {
    res.status(502).json({ error: "Adressesøgning fejlede: " + err.message });
  }
});

// GET /api/bbr?husnummerId=<uuid>&kommunekode=<code>  →  returns BBR data
app.get("/api/bbr", async (req, res) => {
  const { husnummerId, adresseId, kommunekode } = req.query;
  if (!husnummerId) return res.status(400).json({ error: "Mangler husnummerId" });

  try {
    const auth = `username=${BBR_USER}&password=${encodeURIComponent(BBR_PASS)}`;
    const bygUrl =
      `https://services.datafordeler.dk/BBR/BBRPublic/1/rest/bygning` +
      `?Husnummer=${husnummerId}&${auth}&format=JSON`;

    const r = await fetch(bygUrl);
    if (!r.ok) throw new Error(`BBR HTTP ${r.status}`);
    const bygninger = await r.json();

    if (!Array.isArray(bygninger) || bygninger.length === 0) {
      return res.json({ found: false, message: "Ingen BBR-bygningsdata fundet." });
    }

    // Pick the primary residential building (lowest kode or first)
    const byg = bygninger[0];
    const bbrKommune = String(byg.kommunekode || kommunekode || "").padStart(4, "0");
    const landsdel = KOMMUNEKODE_TO_LANDSDEL[bbrKommune] || "09";
    const m2 = parseInt(byg.bygningSamletBoligareal || byg.bygningSamletBygningsareal || 0);
    const anvKode = String(byg.bygningsAnvendelse || "120");
    const opfoeretAar = (byg.byggeriAfsluttet || byg.opfoerelsesdatoTekst || "").slice(0, 4);

    res.json({
      found: true,
      m2,
      anvKode,
      boligtypeLabel: bbrAnvendelseLabel(anvKode),
      isEnfamilie: isEnfamilie(anvKode),
      isEjerlejlighed: isEjerlejlighed(anvKode),
      kommunekode: bbrKommune,
      landsdel,
      landsdelnavn: LANDSDEL_NAVN[landsdel] || landsdel,
      opfoeretAar,
    });
  } catch (err) {
    res.status(502).json({ error: "BBR-opslag fejlede: " + err.message });
  }
});

// ─── Free eligibility check ───────────────────────────────────
// POST /api/free-check  body: { m2, kommunekode, anvKode, ev }
app.post("/api/free-check", async (req, res) => {
  const { m2, kommunekode, anvKode, ev } = req.body || {};
  const evNum = Number(ev);
  const m2Num = Number(m2);

  if (!m2Num || !evNum) return res.status(400).json({ error: "Mangler m² og/eller ejendomsværdi" });

  const landsdel = KOMMUNEKODE_TO_LANDSDEL[String(kommunekode).padStart(4,"0")] || "09";
  const ejendomskate = isEnfamilie(anvKode) ? "0111" : "0111"; // future: "0121" for etage

  try {
    const ejenData = await getEJEN77Avg2020_2022(landsdel, ejendomskate);

    const marketValue2022 = ejenData.krPerM2 * m2Num;  // estimated 2020-2022 market value
    const targetEV        = Math.round(marketValue2022 * 0.80); // 80% rule
    const gap_pct         = ((evNum - targetEV) / targetEV) * 100;

    let verdict, label, color;
    if      (gap_pct >= 15) { verdict="STÆRK";    label="Stærk indikation – god grund til klage";   color="red";   }
    else if (gap_pct >=  5) { verdict="MULIG";     label="Mulig klage – bør undersøges nærmere";     color="amber"; }
    else if (gap_pct > -10) { verdict="USIKKER";   label="Usikkert – kan ikke udelukkes";            color="amber"; }
    else                    { verdict="INGEN";     label="Næppe grund til klage baseret på disse tal"; color="green"; }

    res.json({
      verdict, label, color,
      evNum, targetEV,
      marketValue2022: Math.round(marketValue2022),
      krPerM2: Math.round(ejenData.krPerM2),
      gap_pct: Math.round(gap_pct * 10) / 10,
      landsdel, landsdelnavn: LANDSDEL_NAVN[landsdel],
      ejenData,
    });
  } catch (err) {
    res.status(502).json({ error: "Markedsdata fejlede: " + err.message });
  }
});

// ─── In-memory session store ──────────────────────────────────
const SESSIONS = new Map(); // sessionId → { status, ... }

// ─── Create Stripe payment session ───────────────────────────
// POST /api/create-payment  body: { address, label, m2, kommunekode, anvKode, ev, gv, freeResult }
app.post("/api/create-payment", async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe er ikke konfigureret (mangler STRIPE_SECRET_KEY)" });

  const sessionId = crypto.randomUUID();
  SESSIONS.set(sessionId, {
    status: "pending_payment",
    createdAt: Date.now(),
    ...req.body,
  });

  try {
    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "dkk",
          product_data: {
            name: "Vurderingstjekket – Klagetekst",
            description: `Klage til Skatteankestyrelsen · ${req.body.label || req.body.address || "din ejendom"}`,
          },
          unit_amount: 35000, // 350 DKK in øre
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${origin}/?session=${sessionId}`,
      cancel_url:  `${origin}/?cancelled=1`,
      metadata:    { sessionId },
    });

    SESSIONS.get(sessionId).stripeCheckoutId = checkoutSession.id;
    res.json({ checkoutUrl: checkoutSession.url, sessionId });
  } catch (err) {
    SESSIONS.delete(sessionId);
    res.status(502).json({ error: "Stripe fejl: " + err.message });
  }
});

// ─── Stripe webhook ───────────────────────────────────────────
app.post("/api/stripe-webhook", async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Webhook ikke konfigureret");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook sig fejl:", err.message);
    return res.status(400).send("Webhook fejl: " + err.message);
  }

  // ACK immediately — Stripe will retry if we don't respond within 30 s
  res.json({ received: true });

  if (event.type === "checkout.session.completed") {
    const co = event.data.object;
    const sessionId = co.metadata?.sessionId;
    const sess = sessionId && SESSIONS.get(sessionId);
    if (!sess) return;

    sess.status = "generating";
    console.log(`✅ Payment OK for session ${sessionId} — starting klage generation`);

    generateKlage(sessionId, sess).catch(err => {
      console.error("generateKlage fejl:", err);
      sess.status = "error";
      sess.error = err.message;
    });
  }
});

// ─── Klage generation ─────────────────────────────────────────
const BOLIGA_ACTOR = "haketa~boliga-scraper";

function apifyTypeCode(anvKode) {
  if (isEnfamilie(anvKode)) return "1";        // villa/parcelhus
  if (isEjerlejlighed(anvKode)) return "3";    // ejerlejlighed
  const k = parseInt(anvKode);
  if (k === 160 || k === 185) return "4";      // fritidshus
  return "1";
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function generateKlage(sessionId, sess) {
  if (!APIFY_TOKEN) {
    sess.status = "error";
    sess.error = "APIFY_TOKEN mangler på serveren.";
    return;
  }

  const m2Num  = Number(sess.m2);
  const evNum  = Number(sess.ev);
  const typeCode = apifyTypeCode(sess.anvKode || "120");
  // Extract postal code from the address label
  const zipMatch = (sess.address || sess.label || "").match(/\b(\d{4})\b/);
  const zipCode  = zipMatch ? zipMatch[1] : "0000";

  const actorInput = {
    listingType:  "sold",
    zipCodes:     zipCode,
    propertyTypes:[typeCode],
    soldYearMin:   2020,
    soldYearMax:   2022,
    maxItems:      40,
  };

  const apifyUrl =
    `https://api.apify.com/v2/acts/${BOLIGA_ACTOR}/run-sync-get-dataset-items` +
    `?token=${APIFY_TOKEN}`;

  const r = await fetch(apifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(actorInput),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Apify fejl ${r.status}: ${txt.slice(0, 200)}`);
  }

  const allComps = await r.json();
  if (!Array.isArray(allComps)) throw new Error("Uventet Apify-svar");

  // Size band: ±25% around subject, widen if fewer than 4
  let band = allComps.filter(c => c.squareMeterPrice && c.size >= m2Num * 0.75 && c.size <= m2Num * 1.25);
  if (band.length < 4) band = allComps.filter(c => c.squareMeterPrice && c.size >= m2Num * 0.60 && c.size <= m2Num * 1.40);
  if (band.length < 3) band = allComps.filter(c => c.squareMeterPrice);
  if (band.length === 0) band = allComps;

  const sqmPrices = band.map(c => c.squareMeterPrice).filter(Boolean);
  const medianSqm = sqmPrices.length > 0 ? median(sqmPrices) : null;
  const estimatedMarket = medianSqm ? Math.round(medianSqm * m2Num) : null;
  const targetEV        = estimatedMarket ? Math.round(estimatedMarket * 0.80) : null;

  const topComps = band
    .sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))
    .slice(0, 8);

  sess.status        = "done";
  sess.klageTekst    = buildKlageTekst({ sess, medianSqm, estimatedMarket, targetEV, comps: topComps });
  sess.comps         = topComps;
  sess.estimatedMarket = estimatedMarket;
  sess.targetEV      = targetEV;
  sess.medianSqm     = medianSqm;
}

function fmtKr(n) { return Math.round(n).toLocaleString("da-DK") + " kr"; }
function fmtDate(d) { try { return new Date(d).toLocaleDateString("da-DK"); } catch(e) { return d || ""; } }

function buildKlageTekst({ sess, medianSqm, estimatedMarket, targetEV, comps }) {
  const evNum = Number(sess.ev);
  const m2Num = Number(sess.m2);
  const gap   = targetEV ? Math.round(((evNum - targetEV) / targetEV) * 100) : null;
  const gvStr = sess.gv ? `\n  Grundværdi: ${fmtKr(Number(sess.gv))}` : "";

  const rows = comps.map(c =>
    `  - ${c.address || "ukendt"}, ${c.size} m², solgt ${fmtDate(c.soldDate)}: ` +
    `${fmtKr(c.price)} (${fmtKr(c.squareMeterPrice)}/m²)`
  ).join("\n");

  return `Til Skatteankestyrelsen

Klage over ejendomsvurdering — ${sess.address || sess.label || ""}

EJENDOMSOPLYSNINGER
  Adresse:         ${sess.address || sess.label || ""}
  Boligareal:      ${m2Num} m²
  Ejendomstype:    ${sess.boligtypeLabel || ""}
  Ejendomsværdi:   ${fmtKr(evNum)}${gvStr}

BEGRUNDELSE

Det gøres gældende, at den fastsatte ejendomsværdi på ${fmtKr(evNum)} er for høj i
forhold til ejendomsvurderingslovens § 15, stk. 2. Loven bestemmer, at ejendomsværdien
skal fastsættes til 80 % af ejendommens markedsværdi på vurderingstidspunktet.

MARKEDSANALYSE — SAMMENLIGNELIGE HANDLER 2020–2022

Analysen er baseret på ${comps.length} sammenlignelige, tinglysningsregistrerede handler
i postnummerområdet i perioden 2020–2022, som er det prisleje, Vurderingsstyrelsen selv
har anvendt som grundlag for 2022-vurderingen.

${medianSqm ? `Median salgspris pr. m²: ${fmtKr(medianSqm)}/m²` : "Se vedlagte bilag."}
${estimatedMarket ? `Skønnet markedsværdi for ejendommen (${m2Num} m²): ${fmtKr(estimatedMarket)}` : ""}
${targetEV ? `80 % heraf (lovens krav til EV): ${fmtKr(targetEV)}` : ""}
${gap != null ? `\nForskellen svarer til ca. ${gap} % (${fmtKr(evNum - targetEV)}).` : ""}

REFERENCEEJENDOMME (tinglysningsregistrerede handler 2020–2022):
${rows}

PÅSTAND

Ejendomsværdien bedes nedsat til maksimalt ${fmtKr(targetEV || Math.round(evNum * 0.90))}
svarende til 80 % af den dokumenterede markedsværdi.${
  sess.gv ? "\n\nGrundværdien klages der ikke over i denne omgang." : ""}

BILAG
  1. Vurderingsmeddelelse (vedlægges ved indsendelse til skatteankestyrelsen.dk)
  2. BBR-meddelelse
  3. Oversigt over sammenlignelige handler (se ovenfor)

Med venlig hilsen

[Dit fulde navn]
[Din adresse]
[E-mail og/eller tlf.]
[Dato]

────────────────────────────────────────────────
Klagetekst genereret af Vurderingstjekket.dk
Data er vejledende og ikke juridisk rådgivning.
Kontrollér altid frister og beløb selv inden indsendelse.
`;
}

// ─── Klage status ─────────────────────────────────────────────
app.get("/api/klage/:sessionId", (req, res) => {
  const sess = SESSIONS.get(req.params.sessionId);
  if (!sess) return res.status(404).json({ error: "Session ikke fundet" });

  res.json({
    status:          sess.status,
    klageTekst:      sess.klageTekst    || null,
    error:           sess.error         || null,
    estimatedMarket: sess.estimatedMarket || null,
    targetEV:        sess.targetEV      || null,
    medianSqm:       sess.medianSqm     || null,
    comps:           sess.comps         || null,
  });
});

// ─── Test: generer klagetekst uden betaling ───────────────────
app.get("/api/test-klage", async (_req, res) => {
  const sessionId = crypto.randomUUID();
  const testSess = {
    status:        "generating",
    address:       "Testvej 1, 2100 København Ø",
    label:         "Testvej 1, 2100 København Ø",
    m2:            120,
    kommunekode:   "0101",
    anvKode:       "120",
    boligtypeLabel:"Fritliggende enfamilieshus",
    ev:            4500000,
    gv:            null,
    createdAt:     Date.now(),
  };
  SESSIONS.set(sessionId, testSess);
  try {
    await generateKlage(sessionId, testSess);
    res.json({
      sessionId,
      status:    testSess.status,
      klageTekst: testSess.klageTekst || null,
      error:     testSess.error      || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    stripe:  !!stripe,
    apify:   !!APIFY_TOKEN,
    sessions: SESSIONS.size,
  });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vurderingstjekket v3 🏡  http://localhost:${PORT}`));
