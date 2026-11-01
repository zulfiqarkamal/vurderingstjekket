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
 *   BBR_USER                 (required — set in Railway environment variables)
 *   BBR_PASS                 (optional, defaults to Ghulab.4u)
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Stripe webhook needs raw body for signature verification
app.use("/api/stripe-webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "25mb" }));

// Product routing: Railway retains all assessment APIs and its Stripe webhook.
app.get("/ejendomsvurdering", (_req, res) => {
  res.set("Cache-Control", "no-cache").sendFile(path.join(__dirname, "public", "ejendomsvurdering.html"));
});
app.get("/boliglaanstjek/preview", (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "public", "boliglaanstjek-preview.html"));
});
app.get("/boliglaanstjek", (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "public", "boliglaanstjek-preview.html"));
});
app.get("/selvsalg", (_req, res) => {
  res.set("Cache-Control", "no-cache").sendFile(path.join(__dirname, "public", "selvsalg.html"));
});
app.get("/selvsalg/start", (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "public", "selvsalg-start.html"));
});
app.get("/selvsalg/sag/:id", (_req, res) => {
  res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "public", "selvsalg-sag.html"));
});
app.get("/min-bolig", (_req, res) => {
  res.set("Cache-Control", "no-cache").sendFile(path.join(__dirname, "public", "min-bolig.html"));
});
// HTML må ikke caches, ellers ser folk en gammel version af siden efter en opdatering
app.use(express.static(path.join(__dirname, "public"), {
  // Let the root handler recognize historical payment returns before serving home.
  index: false,
  setHeaders: (res, filePath) => { if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); },
}));

// Fallback: serve index.html from public/ or root
app.get("/", (req, res) => {
  if (["session", "cancelled", "test"].some(key => Object.prototype.hasOwnProperty.call(req.query, key))) {
    return res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "public", "ejendomsvurdering.html"));
  }
  const pub  = path.join(__dirname, "public", "index.html");
  const root = path.join(__dirname, "index.html");
  const target = fs.existsSync(pub) ? pub : fs.existsSync(root) ? root : null;
  if (target) res.set("Cache-Control", "no-cache").sendFile(target);
  else res.status(404).send("Mangler index.html — upload public/index.html til GitHub");
});

// ─── Credentials / keys ───────────────────────────────────────
const APIFY_TOKEN           = process.env.APIFY_TOKEN;
const STRIPE_SECRET         = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BBR_USER              = process.env.BBR_USER;
const BBR_PASS              = process.env.BBR_PASS;
const ADR_TOKEN             = "adressevaelger123"; // official free-tier token
const RESEND_API_KEY        = process.env.RESEND_API_KEY;
const RESEND_FROM           = process.env.RESEND_FROM || "Vurderingstjekket <onboarding@resend.dev>";
// Pris for klagepakken. Der betales kun, når de lokale handler viser en sag.
const PRICE_DKK             = parseInt(process.env.PRICE_DKK || "350");

const stripe = STRIPE_SECRET
  ? new Stripe(STRIPE_SECRET, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 2,
    })
  : null;

// ─── E-mail (Resend HTTP API) ──────────────────────────────────
// Gmail SMTP was tried first (port 465, then 587/STARTTLS) but both hung for
// ~2.5 min then failed with "Connection timeout" — confirmed via live testing
// that Railway's network silently drops outbound SMTP entirely, on any port.
// Resend's API runs over plain HTTPS (port 443), same as the rest of the app,
// so it isn't affected by that restriction.
// NOTE: with the default onboarding@resend.dev sender, Resend only delivers
// to the email address of the Resend account owner. To send to any customer
// email, verify vurderingstjekket.dk as a sending domain in the Resend
// dashboard (adds a few DNS records at Simply.com) and set RESEND_FROM to
// e.g. "Vurderingstjekket <noreply@vurderingstjekket.dk>".
async function sendKlageMail(to, address, klageTekst, hasGrounds = true) {
  if (!RESEND_API_KEY) {
    console.warn("⚠️  E-mail ikke konfigureret (mangler RESEND_API_KEY)");
    return false;
  }
  if (!to || !to.includes("@")) {
    console.warn("⚠️  Ingen gyldig e-mail-adresse til kunde — spring over");
    return false;
  }

  const title = hasGrounds ? "🏡 Din klagetekst er klar" : "📋 Dit analyseresultat er klar";
  const intro = hasGrounds
    ? `Tak for dit køb hos <strong>Vurderingstjekket</strong>. Herunder finder du din færdige klagetekst til Skatteankestyrelsen.`
    : `Tak for dit køb hos <strong>Vurderingstjekket</strong>. Vi har analyseret de faktiske handler i dit postnummerområde, og de understøtter desværre ikke en klage over din ejendomsvurdering. Herunder kan du se den fulde analyse og dataene bag konklusionen.`;
  const stepsBlock = hasGrounds ? `
    <div class="steps">
      <h3>📋 Sådan sender du din klage</h3>
      <ol>
        <li>Gå til <strong>skatteankestyrelsen.dk</strong> og log ind med MitID</li>
        <li>Vælg "Indsend klage" → "Ejendomsvurdering"</li>
        <li>Kopier teksten ovenfor ind i klageformularen</li>
        <li>Vedhæft din vurderingsmeddelelse og evt. BBR-meddelelse</li>
        <li>Indsend — du modtager kvittering pr. e-mail fra Skatteankestyrelsen</li>
      </ol>
    </div>` : `
    <div class="steps">
      <h3>ℹ️ Ønsker du alligevel at klage?</h3>
      <p style="margin:0;font-size:.88rem;color:#374151;line-height:1.6">
        Det er altid din egen beslutning. Du kan bruge dataene i analysen ovenfor som
        dokumentation, hvis du selv vil indsende en klage på <strong>skatteankestyrelsen.dk</strong>.
        Vi har ikke udarbejdet en formel klagepåstand, da de konkrete lokale handler ikke
        understøtter den.
      </p>
    </div>`;

  const htmlBody = `<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6f9;margin:0;padding:20px}
  .wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden}
  .header{background:#0b2447;color:#fff;padding:28px 32px}
  .header h1{margin:0;font-size:1.3rem}
  .header p{margin:6px 0 0;opacity:.75;font-size:.9rem}
  .body{padding:28px 32px}
  .klagetekst{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;font-family:monospace;font-size:.82rem;white-space:pre-wrap;line-height:1.6;color:#1a2130}
  .steps{background:#eff6ff;border-radius:8px;padding:16px 20px;margin-top:20px}
  .steps h3{margin:0 0 10px;font-size:.95rem;color:#1c6dc4}
  .steps ol{margin:0;padding-left:20px;font-size:.88rem;color:#374151;line-height:1.8}
  .footer{border-top:1px solid #e2e8f0;padding:18px 32px;font-size:.78rem;color:#9ca3af;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>${title}</h1>
    <p>${address}</p>
  </div>
  <div class="body">
    <p>${intro}</p>

    <div class="klagetekst">${klageTekst.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>

    ${stepsBlock}

    <p style="margin-top:20px;font-size:.85rem;color:#6b7280">⚠️ <em>${hasGrounds ? "Klageteksten" : "Analysen"} er vejledende og udgør ikke juridisk rådgivning. Kontrollér selv frister og beløb inden indsendelse.</em></p>
  </div>
  <div class="footer">Vurderingstjekket · Spørgsmål? Svar på denne mail.</div>
</div>
</body>
</html>`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject: hasGrounds ? `Din klagetekst er klar — ${address}` : `Dit analyseresultat er klar — ${address}`,
        text: `Tak for dit køb.\n\nHerunder er ${hasGrounds ? "din klagetekst" : "dit analyseresultat"}:\n\n${klageTekst}\n\n---\nVurderingstjekket`,
        html: htmlBody,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Resend ${r.status}: ${body}`);
    }
    console.log(`📧 ${hasGrounds ? "Klagetekst" : "Analyseresultat"} sendt til ${to}`);
    return true;
  } catch (err) {
    console.error("E-mail fejl:", err.message);
    return false;
  }
}

// ─── Generic sendEmail (Resend) ──────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) { console.warn("⚠️  RESEND_API_KEY mangler"); return false; }
  if (!to || !String(to).includes("@")) { console.warn("⚠️  Ugyldig e-mail:", to); return false; }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(() => "")}`);
    console.log(`📧 Mail sendt til ${to}: "${subject}"`);
    return true;
  } catch (err) { console.error("sendEmail fejl:", err.message); return false; }
}

// ─── E-mail-skabeloner ────────────────────────────────────────
function emailWrap(content) {
  return `<!DOCTYPE html><html lang="da"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f4f8;margin:0;padding:16px}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.hdr{background:#0b2447;padding:28px 32px;color:#fff}
.hdr h1{margin:0;font-size:1.25rem;font-weight:700}
.hdr p{margin:6px 0 0;opacity:.7;font-size:.88rem}
.body{padding:28px 32px}
.stat{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.stat-box{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;text-align:center}
.stat-box .val{font-size:1.4rem;font-weight:700;color:#0b2447}
.stat-box .lbl{font-size:.75rem;color:#64748b;margin-top:2px}
.section{margin:24px 0}
.section h2{font-size:1rem;font-weight:700;color:#0b2447;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}
.verdict{border-radius:10px;padding:16px 20px;margin:20px 0;font-weight:700;font-size:1.05rem}
.verdict.go{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.verdict.vent{background:#fef9c3;color:#713f12;border:1px solid #fde68a}
.cta{display:block;background:#0b2447;color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:8px;font-weight:700;font-size:1rem;margin:24px 0}
.news{background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;border-radius:0 8px 8px 0;font-size:.88rem;color:#1e40af}
.footer{border-top:1px solid #e2e8f0;padding:18px 32px;font-size:.75rem;color:#9ca3af;text-align:center}
</style></head><body><div class="wrap">${content}<div class="footer">Vurderingstjekket · <a href="https://vurderingstjekket.dk/boliglaanstjek" style="color:#9ca3af">Se dit overblik</a> · <a href="https://vurderingstjekket.dk/afmeld?id={{ID}}" style="color:#9ca3af">Afmeld</a></div></div></body></html>`;
}

function buildConfirmationEmail({ email, adresse, nextMailDate }) {
  const dato = nextMailDate || "den 1. i næste måned";
  const html = emailWrap(`
    <div class="hdr"><h1>📬 Du er tilmeldt BoligLånsRadar</h1><p>${adresse || "Dit boliglån er nu under opsyn"}</p></div>
    <div class="body">
      <p>Tak for din tilmelding. Her er hvad du kan forvente:</p>
      <div class="section">
        <h2>Hvad du modtager</h2>
        <ul style="font-size:.9rem;color:#374151;line-height:1.9;padding-left:20px;margin:0">
          <li>📊 <strong>Månedlig statusmail</strong> — din lånesituation, markedsrenter og om det kan betale sig at omlægge</li>
          <li>🔔 <strong>Øjeblikkelig alert</strong> — hvis renten falder nok til at omlægning er en god forretning</li>
          <li>🏘️ <strong>Lokalt boligmarked</strong> — handler i dit område og din friværdiudvikling</li>
          <li>📅 <strong>Terminsoversigt</strong> — hvornår din næste termin er og hvad der sker</li>
        </ul>
      </div>
      <div class="section">
        <h2>Din første mail ankommer</h2>
        <p style="font-size:.9rem;color:#374151">Din første månedsopdatering ankommer <strong>${dato}</strong>. Til den tid ser du din fulde låneanalyse.</p>
      </div>
      <a class="cta" href="https://vurderingstjekket.dk/boliglaanstjek">Se din boliglånsberegning nu →</a>
      <p style="font-size:.8rem;color:#9ca3af;text-align:center">Spørgsmål? Svar blot på denne mail.</p>
    </div>`);
  const text = `Tak for din tilmelding til BoligLånsRadar.\n\nDu modtager månedlige opdateringer om dit boliglån, markedsrenter og omlægningsmuligheder. Din første mail ankommer ${dato}.\n\nSe din beregning: https://vurderingstjekket.dk/boliglaanstjek`;
  return { subject: "Velkommen til BoligLånsRadar — vi holder øje med dit lån", html, text };
}

function beregnMaanedligYdelse(restgaeld, renteAarlig, loebetidAar) {
  const r = renteAarlig / 100 / 12;
  const n = loebetidAar * 12;
  if (r === 0) return Math.round(restgaeld / n);
  return Math.round(restgaeld * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
}

function buildMonthlyEmail(ab, aktuelleRenter, boligData) {
  const nu = new Date();
  const maaned = nu.toLocaleString("da-DK", { month: "long", year: "numeric" });
  const aktuelRente = aktuelleRenter?.[ab.laantype] ?? aktuelleRenter?.fastforrentet ?? ab.rente;

  // Beregn nuværende ydelse baseret på resterende løbetid
  const aarSidenOprettelse = (Date.now() - new Date(ab.createdAt).getTime()) / (365.25 * 24 * 3600 * 1000);
  const tilbagevaerende = Math.max(5, (ab.loebetid || 25) - aarSidenOprettelse);
  const nuvaerende_ydelse = beregnMaanedligYdelse(ab.restgaeld, ab.rente, tilbagevaerende);
  const ny_ydelse = beregnMaanedligYdelse(ab.restgaeld, aktuelRente, tilbagevaerende);
  const besparelse = nuvaerende_ydelse - ny_ydelse;
  const omlægningOmkostning = 35000; // typisk
  const breakEvenMaaneder = besparelse > 0 ? Math.round(omlægningOmkostning / besparelse) : 999;
  const goOmlæg = aktuelRente < ab.rente - 0.5 && breakEvenMaaneder < 60;

  // Friværdi (estimat baseret på boligdata)
  const anslaaetVaerdi = boligData?.anslaaetVaerdi;
  const frivaerdi = anslaaetVaerdi ? Math.round(anslaaetVaerdi - ab.restgaeld) : null;

  // Næste termin (fastforrentet: 1.1, 1.4, 1.7, 1.10 — F1: 1.1)
  function naestTermin() {
    const terminMdr = ab.laantype === "fastforrentet" ? [1,4,7,10] : [1];
    const n = new Date();
    for (let i = 0; i < 4; i++) {
      const candidate = new Date(n.getFullYear(), terminMdr[i % terminMdr.length] - 1, 1);
      if (candidate > n) return candidate.toLocaleDateString("da-DK", { day:"numeric", month:"long", year:"numeric" });
    }
    return "1. januar " + (n.getFullYear() + 1);
  }

  const verdictBlock = goOmlæg
    ? `<div class="verdict go">🟢 Nu kan det betale sig at omlægge — spar ~${besparelse.toLocaleString("da-DK")} kr/md</div>`
    : `<div class="verdict vent">🟡 Vent — nuværende fordel: ${besparelse > 0 ? besparelse.toLocaleString("da-DK")+" kr/md" : "ingen besparelse endnu"}${breakEvenMaaneder < 999 ? ` · Break-even om ${breakEvenMaaneder} mdr.` : ""}</div>`;

  const ctaBlock = goOmlæg
    ? `<a class="cta" href="https://vurderingstjekket.dk/boliglaanstjek">Se omlægningsmuligheder nu →</a>`
    : `<a class="cta" href="https://vurderingstjekket.dk/boliglaanstjek">Se din friværdi og lånestatus →</a>`;

  const nyheder = aktuelRente > ab.rente
    ? `Markedsrenten er steget til <strong>${aktuelRente.toFixed(2)}%</strong> — din eksisterende rente på ${ab.rente.toFixed(2)}% er nu attraktiv. Omlæg ikke.`
    : `Markedsrenten er <strong>${aktuelRente.toFixed(2)}%</strong> ${aktuelRente < ab.rente ? `— ${(ab.rente - aktuelRente).toFixed(2)} procentpoint under din nuværende rente` : "— på niveau med din nuværende rente"}.`;

  const html = emailWrap(`
    <div class="hdr"><h1>📊 Din låneradar — ${maaned}</h1><p>${ab.adresse || "Dit boliglån"}</p></div>
    <div class="body">
      <div class="stat">
        <div class="stat-box"><div class="val">${(ab.restgaeld/1000000).toFixed(2)} mio.</div><div class="lbl">Restgæld (kr.)</div></div>
        <div class="stat-box"><div class="val">${ab.rente.toFixed(2)}%</div><div class="lbl">Din rente</div></div>
        <div class="stat-box"><div class="val">${aktuelRente.toFixed(2)}%</div><div class="lbl">Markedsrente nu</div></div>
        ${frivaerdi ? `<div class="stat-box"><div class="val">${(frivaerdi/1000).toFixed(0)} t. kr.</div><div class="lbl">Ansl. friværdi</div></div>` : ""}
      </div>

      ${verdictBlock}

      <div class="section">
        <h2>Omlægningstjek</h2>
        <p style="font-size:.88rem;color:#374151;margin:0 0 8px">Din nuværende ydelse: <strong>${nuvaerende_ydelse.toLocaleString("da-DK")} kr/md</strong></p>
        <p style="font-size:.88rem;color:#374151;margin:0 0 8px">Ny ydelse ved omlægning: <strong>${ny_ydelse.toLocaleString("da-DK")} kr/md</strong></p>
        <p style="font-size:.88rem;color:#374151;margin:0">Omlægningsomkostning (estimat): ~35.000 kr · Break-even: ${breakEvenMaaneder < 999 ? breakEvenMaaneder+" mdr." : "ikke aktuelt"}</p>
      </div>

      <div class="section">
        <h2>Renteudsigt</h2>
        <p style="font-size:.88rem;color:#374151;margin:0 0 8px">Nationalbanken følger ECBs pengepolitik tæt. Næste rentebeslutning overvåges løbende.</p>
        <div class="news">📰 ${nyheder}</div>
      </div>

      ${boligData?.antalHandler ? `
      <div class="section">
        <h2>Boligmarked i dit område</h2>
        <p style="font-size:.88rem;color:#374151;margin:0 0 6px">${boligData.antalHandler} handler i dit postnummer seneste måned</p>
        ${boligData.gennemsnitmKr ? `<p style="font-size:.88rem;color:#374151;margin:0 0 6px">Gennemsnitlig m²-pris: <strong>${boligData.gennemsnitmKr.toLocaleString("da-DK")} kr/m²</strong></p>` : ""}
        ${anslaaetVaerdi ? `<p style="font-size:.88rem;color:#374151;margin:0">Anslået boligværdi (estimat): <strong>${anslaaetVaerdi.toLocaleString("da-DK")} kr.</strong></p>` : ""}
      </div>` : ""}

      <div class="section">
        <h2>Terminsoversigt</h2>
        <p style="font-size:.88rem;color:#374151;margin:0">Næste termin: <strong>${naestTermin()}</strong>. ${goOmlæg ? "Overvej at omlægge <em>inden</em> terminen for at spare fra næste periode." : "Intet du skal handle på nu."}</p>
      </div>

      ${ctaBlock}
    </div>`).replace(/{{ID}}/g, ab.id || "");

  const text = `Din låneradar — ${maaned}\n\nRestgæld: ${ab.restgaeld.toLocaleString("da-DK")} kr.\nDin rente: ${ab.rente.toFixed(2)}%\nMarkedsrente: ${aktuelRente.toFixed(2)}%\n\n${goOmlæg ? `🟢 Nu kan det betale sig at omlægge — spar ~${besparelse.toLocaleString("da-DK")} kr/md` : `🟡 Vent — ingen klar fordel endnu`}\n\nSe mere: https://vurderingstjekket.dk/boliglaanstjek`;
  return {
    subject: goOmlæg ? `🔔 Nu kan det betale sig at omlægge — ${maaned}` : `📊 Din låneradar — ${maaned}`,
    html, text, goOmlæg, besparelse,
  };
}

function buildAlertEmail(ab, besparelse) {
  const html = emailWrap(`
    <div class="hdr" style="background:#166534"><h1>🔔 Nu kan det betale sig at omlægge</h1><p>${ab.adresse || "Dit boliglån"}</p></div>
    <div class="body">
      <div class="verdict go">🟢 Markedsrenten er faldet nok til at en omlægning kan betale sig</div>
      <p style="font-size:.95rem;color:#374151">Du kan spare ca. <strong>${besparelse.toLocaleString("da-DK")} kr. om måneden</strong> ved at omlægge dit lån nu.</p>
      <div class="section">
        <h2>Hvad du skal gøre nu</h2>
        <ol style="font-size:.9rem;color:#374151;line-height:1.9;padding-left:20px;margin:0">
          <li>Kontakt din bank eller dit realkreditinstitut og bed om et konkret tilbud</li>
          <li>Spørg specifikt om omlægning fra ${ab.rente.toFixed(2)}% til aktuel markedsrente</li>
          <li>Bed om break-even-beregning inkl. alle gebyrer</li>
          <li>Husk: omlæg inden næste termin for at spare fra næste periode</li>
        </ol>
      </div>
      <a class="cta" href="https://vurderingstjekket.dk/boliglaanstjek">Se din fulde låneoversigt →</a>
      <p style="font-size:.8rem;color:#9ca3af;text-align:center">Beregningen er vejledende — bed altid om et konkret tilbud fra din bank.</p>
    </div>`).replace(/{{ID}}/g, ab.id || "");
  const text = `🔔 Nu kan det betale sig at omlægge dit lån!\n\nDu kan spare ca. ${besparelse.toLocaleString("da-DK")} kr/md.\n\nKontakt din bank og bed om et konkret tilbud på omlægning.\n\nSe mere: https://vurderingstjekket.dk/boliglaanstjek`;
  return { subject: "🔔 Nu kan det betale sig at omlægge din restgæld", html, text };
}

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
  "0253":"05","0259":"05","0265":"05","0269":"05","0350":"05",
  // 06 – Vest- og Sydsjælland
  "0306":"06","0316":"06","0320":"06","0326":"06","0329":"06","0330":"06",
  "0336":"06","0340":"06","0360":"06","0370":"06","0376":"06",
  "0390":"06",
  // 07 – Fyn
  "0410":"07","0420":"07","0430":"07","0440":"07","0450":"07",
  "0461":"07","0479":"07","0480":"07","0482":"07","0492":"07",
  // 08 – Sydjylland
  "0510":"08","0530":"08","0540":"08","0550":"08","0561":"08",
  "0563":"08","0573":"08","0575":"08","0580":"08","0607":"08",
  "0621":"08","0630":"08",
  // 09 – Østjylland
  "0615":"09","0706":"09","0707":"09","0710":"09","0727":"09",
  "0730":"09","0740":"09","0741":"09","0746":"09","0751":"09","0766":"09",
  // 10 – Vestjylland
  "0657":"10","0661":"10","0665":"10","0671":"10","0756":"10",
  "0760":"10","0779":"10","0791":"10",
  // 11 – Nordjylland
  "0773":"11","0787":"11","0810":"11","0813":"11","0820":"11",
  "0825":"11","0840":"11","0846":"11","0849":"11","0851":"11","0860":"11",
};

// Typical average boligareal (m²) per Landsdel, split by property type, used to derive
// kr/m² from EJEN77's average price per property. DST does not publish average area in
// EJEN77 (BNØGLE 4 covers only landbrug/grunde), so these are fixed estimates.
const LANDSDEL_AVG_M2_ENFAMILIE = {
  "01": 100, "02": 128, "03": 155, "04": 120, "05": 148,
  "06": 135, "07": 130, "08": 142, "09": 148, "10": 158, "11": 148,
};
// Ejerlejligheder are systematically smaller than houses
const LANDSDEL_AVG_M2_EJERLEJLIGHED = {
  "01": 78, "02": 80, "03": 90, "04": 80, "05": 85,
  "06": 82, "07": 80, "08": 85, "09": 82, "10": 85, "11": 80,
};

// EJEN77 EJENDOMSKATE: 0111 = Enfamiliehuse, 2103 = Ejerlejligheder i alt
// (0121 is "Ejendomme med 2 lejligheder", i.e. whole two-unit buildings, not apartments)
const EJENDOMSKATE_ENFAMILIE = "0111";
const EJENDOMSKATE_EJERLEJLIGHED = "2103";

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

async function getEJEN77Avg2020_2022(landsdel, ejendomskate = EJENDOMSKATE_ENFAMILIE) {
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
  const avgM2 = ejendomskate === EJENDOMSKATE_EJERLEJLIGHED
    ? (LANDSDEL_AVG_M2_EJERLEJLIGHED[landsdel] || 82)
    : (LANDSDEL_AVG_M2_ENFAMILIE[landsdel] || 145);
  const data = {
    avgPricek,                            // 1000 kr per typical property
    krPerM2: (avgPricek * 1000) / avgM2, // kr per m²
    quarters: numbers.length,
    avgM2Used: avgM2,
  };

  EJEN77_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

// Prisindeks (EJ56) pr. kvartal, så handler fra 2020–2021 kan føres frem til
// vurderingstidspunktet 1.1.2022. Returnerer { "2020K1": 81.6, ..., target } eller null.
const EJ56_CACHE = new Map();
async function getPrisindeks(landsdel, ejendomskate) {
  if (!landsdel) return null;
  const key = `${landsdel}|${ejendomskate}`;
  const cached = EJ56_CACHE.get(key);
  if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) return cached.data;
  try {
    const kvartaler = ["2020K1","2020K2","2020K3","2020K4","2021K1","2021K2","2021K3","2021K4","2022K1"];
    const url = `https://api.statbank.dk/v1/data/EJ56/JSONSTAT?OMRÅDE=${landsdel}` +
      `&EJENDOMSKATE=${ejendomskate}&TAL=100&Tid=${kvartaler.join(",")}&lang=da`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`EJ56 HTTP ${r.status}`);
    const raw = await r.json();
    const vals = raw.dataset?.value ?? raw.value ?? [];
    const idx = raw.dataset?.dimension?.Tid?.category?.index || {};
    const data = {};
    for (const k of kvartaler) {
      const v = Array.isArray(vals) ? vals[idx[k]] : vals[String(idx[k])];
      if (v > 0) data[k] = v;
    }
    // Niveauet 1.1.2022 ligger mellem 4. kvartal 2021 og 1. kvartal 2022
    if (!data["2021K4"] || !data["2022K1"]) throw new Error("Mangler kvartaler omkring 1.1.2022");
    data.target = (data["2021K4"] + data["2022K1"]) / 2;
    EJ56_CACHE.set(key, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn("Prisindeks fejlede, handler bruges uden tidskorrektion:", e.message);
    return null;
  }
}

// Boligens koordinater (UTM zone 32, meter) fra Adressevælgeren
const KOORD_CACHE = new Map();
async function getAdresseKoordinater(adresseId) {
  if (!adresseId) return null;
  if (KOORD_CACHE.has(adresseId)) return KOORD_CACHE.get(adresseId);
  try {
    const r = await fetch(`https://adressevaelger.dk/adresser/${encodeURIComponent(adresseId)}?token=${ADR_TOKEN}`,
      { headers: { "Accept": "application/json" } });
    if (!r.ok) return null;
    const k = (await r.json())?.adresse?.husnummer?.adgangspunkt?.koordinater;
    const res = k && k.x && k.y ? { x: Number(k.x), y: Number(k.y) } : null;
    KOORD_CACHE.set(adresseId, res);
    return res;
  } catch {
    return null;
  }
}

// WGS84 (Boligas lat/lon) til UTM zone 32 (EPSG:25832), så afstanden kan regnes i meter
function wgs84TilUtm32(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, lon0 = 9 * Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const x = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  return { x, y };
}

// ─── Adressevælger + BBR ──────────────────────────────────────

// GET /api/adresse?q=<text>  →  returns list of address suggestions
// Primary: Dataforsyningen autocomplete (no token required, stable public API)
// Fallback: Adressevælgeren
app.get("/api/adresse", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 3) return res.json({ suggestions: [] });

  // Try Dataforsyningen first (https://api.dataforsyningen.dk)
  try {
    const url = `https://api.dataforsyningen.dk/adresser/autocomplete?q=${encodeURIComponent(q)}&caretpos=${q.length}&per_side=8&fuzzy=`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Dataforsyningen HTTP ${r.status}`);
    const raw = await r.json();

    if (Array.isArray(raw) && raw.length > 0) {
      const suggestions = raw.map(item => {
        const adr = item.adresse || {};
        return {
          adresseId:   adr.id || null,
          husnummerId: adr.adgangsadresseid || null,
          label:       item.tekst || "",
          postnr:      adr.postnr || "",
          by:          adr.postnrnavn || "",
          kommunekode: adr.kommunekode || "",
          vejnavn:     adr.vejnavn || "",
        };
      });
      return res.json({ suggestions });
    }
    throw new Error("Dataforsyningen returnerede tomt svar");
  } catch (primaryErr) {
    console.warn("[adresse] Dataforsyningen fejlede, prøver Adressevælgeren:", primaryErr.message);
  }

  // Fallback: Adressevælgeren
  try {
    const url = `https://adressevaelger.dk/adresser/soeg?tekst=${encodeURIComponent(q)}&token=${ADR_TOKEN}&maksimum=8`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Adressevælgeren HTTP ${r.status}`);
    const raw = await r.json();
    console.log("[adresse] Adressevælgeren raw keys:", Object.keys(raw).join(","), "first item:", JSON.stringify((raw.fund || raw.results || raw.adresser || [])[0] || {}).slice(0, 200));

    // Try common response keys
    const items = Array.isArray(raw.fund) ? raw.fund
      : Array.isArray(raw.results) ? raw.results
      : Array.isArray(raw.adresser) ? raw.adresser
      : Array.isArray(raw) ? raw : [];

    const suggestions = items
      .filter(s => !s.type || s.type === "adresse" || s.type === "Adresse")
      .slice(0, 8)
      .map(s => {
        const tekst = s.titel || s.tekst || s.label || s.adresse || "";
        const postnrMatch = tekst.match(/\b(\d{4})\b/);
        const postnr = postnrMatch ? postnrMatch[1] : "";
        const by = postnr ? tekst.replace(/^.*\b\d{4}\b\s*/, "").trim() : "";
        return {
          adresseId:   s.id || s.adresseId || null,
          husnummerId: s.husnummerId || null,
          label:       tekst,
          postnr,
          by,
          kommunekode: "",
          vejnavn:     "",
        };
      });

    if (suggestions.length) return res.json({ suggestions });
    console.warn("[adresse] Ingen suggestions fra hverken Dataforsyningen eller Adressevælgeren for:", q);
    res.json({ suggestions: [] });
  } catch (err) {
    console.error("[adresse] Begge adresse-API'er fejlede:", err.message);
    res.status(502).json({ error: "Adressesøgning fejlede: " + err.message });
  }
});

// Fallback: resolve kommunekode straight from Adressevælgeren's address-detail
// endpoint. This works even when the BBR building lookup finds nothing (e.g.
// commercial/apartment complexes with no registered boligareal), so the user
// never has to type a kommunekode in by hand — it's always derived from the
// address they picked.
async function resolveKommunekodeFromAdresse(adresseId) {
  if (!adresseId) return null;
  try {
    const url = `https://adressevaelger.dk/adresser/${adresseId}?token=${ADR_TOKEN}`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!r.ok) return null;
    const data = await r.json();
    const kommune = data?.adresse?.husnummer?.navngivenvejkommunedel?.kommune;
    return kommune ? String(kommune).padStart(4, "0") : null;
  } catch {
    return null;
  }
}

// Boligens eget areal fra BBR-enheden (lejligheden), ikke hele bygningen.
// Returnerer null hvis adressen ikke kan slås op som én enhed.
async function lookupEnhedAreal(adresseId, auth) {
  if (!adresseId) return null;
  try {
    const url =
      `https://services.datafordeler.dk/BBR/BBRPublic/1/rest/enhed` +
      `?AdresseIdentificerer=${adresseId}&${auth}&format=JSON`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const enheder = await r.json();
    if (!Array.isArray(enheder) || enheder.length !== 1) return null;
    const e = enheder[0];
    const areal = parseInt(e.enh027ArealTilBeboelse || 0) || parseInt(e.enh026EnhedensSamledeAreal || 0) || 0;
    return areal > 0 ? areal : null;
  } catch {
    return null;
  }
}

// GET /api/bbr?husnummerId=<uuid>&adresseId=<uuid>&kommunekode=<code>  →  returns BBR data
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
      // No BBR building data (e.g. commercial complex) — still resolve the
      // kommunekode/landsdel from the address itself so the user only has
      // to enter m² manually, never the kommunekode.
      const fallbackKommune = await resolveKommunekodeFromAdresse(adresseId) ||
        (kommunekode ? String(kommunekode).padStart(4, "0") : null);
      const fallbackLandsdel = fallbackKommune ? KOMMUNEKODE_TO_LANDSDEL[fallbackKommune] : null;

      return res.json({
        found: false,
        message: "Ingen BBR-bygningsdata fundet.",
        kommunekode: fallbackKommune || "",
        landsdel: fallbackLandsdel || "",
        landsdelnavn: fallbackLandsdel ? (LANDSDEL_NAVN[fallbackLandsdel] || fallbackLandsdel) : "",
      });
    }

    // Pick the primary residential building: prefer one with an actual
    // boligareal (the real house) over garages/carports/outbuildings,
    // which share the same husnummer but report byg039 = 0 or absent.
    const boligAreal = (b) => parseInt(b.byg039BygningensSamledeBoligAreal || 0) || 0;
    const byg =
      bygninger.find((b) => boligAreal(b) > 0) ||
      bygninger[0];

    let bbrKommune = String(byg.kommunekode || kommunekode || "").padStart(4, "0");
    if (!KOMMUNEKODE_TO_LANDSDEL[bbrKommune]) {
      bbrKommune = (await resolveKommunekodeFromAdresse(adresseId)) || bbrKommune;
    }
    const landsdel = KOMMUNEKODE_TO_LANDSDEL[bbrKommune] || "09";
    // For lejligheder er bygningens boligareal hele opgangens areal (fx 754 m²).
    // Brug derfor enhedens eget areal, når adressen kan slås op som enhed.
    const enhedM2 = await lookupEnhedAreal(adresseId, auth);
    const bygningM2 = boligAreal(byg) || parseInt(byg.byg038SamletBygningsareal || 0) || 0;
    const m2 = enhedM2 || bygningM2;
    // Arealet er usikkert, hvis vi kun har bygningens areal, og bygningen kan rumme flere boliger
    const areaUncertain = !enhedM2 && (isEjerlejlighed(byg.byg021BygningensAnvendelse) || bygningM2 > 300);
    const anvKode = String(byg.byg021BygningensAnvendelse || "120");
    const opfoeretAar = String(byg.byg026Opførelsesår || "");

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
      areaSource: enhedM2 ? "enhed" : "bygning",
      areaUncertain,
    });
  } catch (err) {
    res.status(502).json({ error: "BBR-opslag fejlede: " + err.message });
  }
});

// Returnerer en liste af advarsler (tekst til brugeren) når tallene ser forkerte ud
function checkInputPlausibility({ evNum, m2Num, marketValue2022, erLejlighed }) {
  const warnings = [];
  const evPerM2 = evNum / m2Num;
  if (m2Num < 20) {
    warnings.push(`Boligarealet er kun ${m2Num} m². Er det rigtigt?`);
  } else if (m2Num > (erLejlighed ? 250 : 500)) {
    warnings.push(`Boligarealet er ${m2Num} m². Det er usædvanligt stort for ${erLejlighed ? "en lejlighed" : "en bolig"} og kan være hele bygningens areal.`);
  }
  if (evPerM2 < 2000) {
    warnings.push(`Ejendomsværdien svarer til kun ${Math.round(evPerM2).toLocaleString("da-DK")} kr/m². Mangler der et ciffer?`);
  } else if (evPerM2 > 150000) {
    warnings.push(`Ejendomsværdien svarer til ${Math.round(evPerM2).toLocaleString("da-DK")} kr/m². Er der et ciffer for meget?`);
  }
  // Langt fra estimatet i begge retninger tyder på tastefejl i EV eller areal
  const ratio = evNum / marketValue2022;
  if (warnings.length === 0 && (ratio > 2.5 || ratio < 0.4)) {
    warnings.push(`Ejendomsværdien er ${ratio > 1 ? "mere end dobbelt så høj som" : "under halvdelen af"} det typiske niveau for en bolig på ${m2Num} m² i dit område. Tjek beløb og areal.`);
  }
  return warnings;
}

// ─── Free eligibility check ───────────────────────────────────
// POST /api/free-check  body: { m2, kommunekode, anvKode, ev, address }
app.post("/api/free-check", async (req, res) => {
  const { m2, kommunekode, anvKode, ev, address, opfoeretAar, grundareal, adresseId } = req.body || {};
  const evNum = Number(ev);
  const m2Num = Number(m2);

  if (!m2Num || !evNum) return res.status(400).json({ error: "Mangler m² og/eller ejendomsværdi" });

  const kommunekodeNorm = String(kommunekode || "").padStart(4, "0");
  const landsdel = KOMMUNEKODE_TO_LANDSDEL[kommunekodeNorm];
  if (!landsdel) {
    return res.status(400).json({ error: "Mangler eller ukendt kommunekode — kan ikke bestemme landsdel. Angiv kommunekode manuelt." });
  }
  // Ejerlejligheder get apartment price data; everything else keeps the enfamiliehus baseline
  const erLejlighed = isEjerlejlighed(anvKode);
  const ejendomskate = erLejlighed ? EJENDOMSKATE_EJERLEJLIGHED : EJENDOMSKATE_ENFAMILIE;

  try {
    const ejenData = await getEJEN77Avg2020_2022(landsdel, ejendomskate);

    const marketValue2022 = ejenData.krPerM2 * m2Num;  // estimated 2020-2022 market value
    // Korrekt klagegrænse: en klage kan kun ændre EV hvis ændringen overstiger 20 % af EV
    // (skatteforvaltningsloven § 35 h stk 2). Det kræver at markedsestimatet er under 80 % af EV.
    // gap_pct måler hvor meget EV overstiger estimatet som andel af EV (ikke af estimatet).
    const targetEV        = Math.round(evNum * 0.80); // klagegrænse: markedsværdi skal ligge under dette
    const gap_pct         = ((evNum - marketValue2022) / evNum) * 100;

    // Tastefejl (1,5 mio. skrevet som 15 mio.) og forkert areal giver ellers et tilfældigt
    // resultat. Bed brugeren bekræfte tallene, før vi viser noget.
    const warnings = checkInputPlausibility({ evNum, m2Num, marketValue2022, erLejlighed });
    if (warnings.length > 0 && req.body.confirmed !== true) {
      logEvent("input_warning", { address: address || "", m2: m2Num, ev: evNum, warnings });
      return res.status(422).json({ needsConfirm: true, warnings });
    }

    // Først de rigtige tinglyste handler i postnummeret. Det er dem, der afgør om der er en sag,
    // så kunden får svaret gratis og kun betaler for klagen, når der er noget at klage over.
    const postnr = postnrFrom(req.body);
    let local = null;
    if (postnr) {
      try {
        const [comps, indeks, koord] = await Promise.all([
          getSoldComps(postnr, apifyTypeCode(anvKode || "120")),
          getPrisindeks(landsdel, ejendomskate),
          getAdresseKoordinater(adresseId),
        ]);
        const a = analyseComps(comps, m2Num, evNum, { address, year: opfoeretAar, lot: grundareal, koord, indeks });
        if (a.estimatedMarket && a.compsCount >= 3) local = a;
      } catch (e) {
        console.warn("Lokale handler fejlede, bruger landsdelsgennemsnit:", e.message);
      }
    }

    let verdict, label, color, source, estimate, canBuy;
    if (local) {
      source   = "lokal";
      estimate = local.estimatedMarket;
      const localGap = ((evNum - estimate) / evNum) * 100;
      // Et enkelt hus kan afvige meget fra de lokale handler (stand, renovering, beliggenhed).
      // Test på 2.434 rigtige handler (okt. 2026): med en fast grænse på 20 % fik 11–32 % af korrekt
      // vurderede boliger rød. Derfor følger grænsen spredningen i handlerne, og ved få eller meget
      // spredte handler bliver resultatet højst orange. Det gav ca. 3 % falske røde i alle områder.
      const usikker = local.compsCount < 8 || local.spredning == null || local.spredning > 0.45;
      const graenseSag = usikker ? Infinity : 20 + 30 * local.spredning;
      if      (localGap >= graenseSag) { verdict="SAG";   label="Stor afvigelse";    color="red";   }
      else if (localGap >= 10) { verdict="TÆT";   label="Mulig afvigelse";   color="amber"; }
      else                     { verdict="INGEN"; label="Mindre afvigelse";  color="green"; }
      canBuy = verdict === "SAG";
      local.usikker = usikker;
    } else {
      // Ingen lokale handler: landsdelsgennemsnittet er for groft til at sige ja,
      // så kun de tydeligste tilfælde får tilbudt den betalte analyse.
      source   = "landsdel";
      estimate = Math.round(marketValue2022);
      if      (gap_pct >= 25) { verdict="STÆRK";    label="Stærk indikation – god grund til klage";   color="red";   }
      else if (gap_pct >= 15) { verdict="MULIG";     label="Mulig klage – bør undersøges nærmere";     color="amber"; }
      else if (gap_pct >   5) { verdict="USIKKER";   label="Usikkert – kan ikke udelukkes";            color="amber"; }
      else                    { verdict="INGEN";     label="Næppe grund til klage baseret på disse tal"; color="green"; }
      canBuy = verdict === "STÆRK";
    }
    const finalGap = ((evNum - estimate) / evNum) * 100;
    const savingsPerYear = estimate < evNum
      ? Math.round(ejendomsvaerdiskat(evNum) - ejendomsvaerdiskat(estimate))
      : 0;

    const result = {
      verdict, label, color, source, canBuy,
      evNum, targetEV,
      estimate,
      marketValue2022: Math.round(marketValue2022),
      krPerM2: Math.round(ejenData.krPerM2),
      gap_pct: Math.round(finalGap * 10) / 10,
      savingsPerYear,
      price: PRICE_DKK,
      postnr,
      landsdel, landsdelnavn: LANDSDEL_NAVN[landsdel],
      propertyType: erLejlighed ? "ejerlejlighed" : "enfamiliehus",
      ejenData,
    };
    logEvent("free_check", {
      address: address || "",
      m2: m2Num, ev: evNum, kommunekode: String(kommunekode).padStart(4,"0"),
      verdict, gap_pct: result.gap_pct, targetEV, propertyType: result.propertyType,
      source, compsCount: local ? local.compsCount : 0, savingsPerYear,
      usikker: local ? local.usikker : null, spredning: local && local.spredning != null ? Math.round(local.spredning * 100) / 100 : null,
      tidskorrigeret: local ? local.tidskorrigeret : null,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: "Markedsdata fejlede: " + err.message });
  }
});

// ─── In-memory session store ──────────────────────────────────
const SESSIONS = new Map(); // sessionId → { status, ... }

// ─── BoligSelvsalg sags-storage ──────────────────────────────
// File-based JSON persistence so sager survive server restarts.
const SAGER_FILE = path.join(__dirname, "data", "selvsalg-sager.json");
function loadSager() {
  try {
    if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    if (fs.existsSync(SAGER_FILE)) return JSON.parse(fs.readFileSync(SAGER_FILE, "utf8"));
  } catch {}
  return {};
}
function saveSager(sager) {
  try {
    if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(SAGER_FILE, JSON.stringify(sager, null, 2));
  } catch (e) { console.error("saveSager fejl:", e.message); }
}
const SAGER = loadSager(); // sagId → { adresse, boligtype, m2bolig, ... betalt, oprettet }

// ─── Låneovervågning abonnenter ───────────────────────────────
const ABONNENTER_FILE = path.join(__dirname, "data", "laanovervagning-abonnenter.json");
function loadAbonnenter() {
  try {
    if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    if (fs.existsSync(ABONNENTER_FILE)) return JSON.parse(fs.readFileSync(ABONNENTER_FILE, "utf8"));
  } catch {}
  return [];
}
function saveAbonnenter(liste) {
  try {
    if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(ABONNENTER_FILE, JSON.stringify(liste, null, 2));
  } catch (e) { console.error("saveAbonnenter fejl:", e.message); }
}
let ABONNENTER = loadAbonnenter(); // [{ id, email, restgaeld, rente, loebetid, laantype, adresse, ... }]

// A report ID is a locator, not authorization. Bind access to the browser
// that started checkout; never expose the access secret in URLs or JSON.
function grantReportAccess(req, res, sessionId, sess) {
  const token = crypto.randomBytes(32).toString("hex");
  sess.accessTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  sess.accessExpiresAt = Date.now() + 24 * 3600 * 1000;
  res.cookie(`report_access_${sessionId}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure === true || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    path: "/api",
    maxAge: 24 * 3600 * 1000,
  });
}

function canAccessReport(req, sessionId, sess) {
  if (!sess || !(sess.paymentVerified === true || sess.testAuthorized === true) ||
      !sess.accessTokenHash || !(sess.accessExpiresAt > Date.now())) return false;
  const name = `report_access_${sessionId}=`;
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(name));
  const token = cookie ? cookie.slice(name.length) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(sess.accessTokenHash, "hex"));
}

function checkoutInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const numeric = value => typeof value === "number" || typeof value === "string";
  if (!numeric(body.m2) || !numeric(body.ev)) return null;
  const m2 = Number(body.m2), ev = Number(body.ev);
  if (!Number.isFinite(m2) || m2 <= 0 || !Number.isFinite(ev) || ev <= 0) return null;
  const data = { m2, ev };
  for (const field of ["address", "label", "postnr", "kommunekode", "anvKode", "boligtypeLabel", "landsdel", "opfoeretAar", "adresseId"]) {
    if (body[field] == null) continue;
    if (typeof body[field] !== "string" || body[field].length > 500) return null;
    data[field] = body[field];
  }
  if (!(data.address || data.label)) return null;
  for (const field of ["gv", "grundareal"]) {
    if (body[field] == null) continue;
    if (!numeric(body[field])) return null;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) return null;
    data[field] = value;
  }
  data.forhold = Array.isArray(body.forhold) ? body.forhold.filter(k => typeof k === "string" && Object.hasOwn(FORHOLD, k)) : [];
  // Retain only the analytics label, never trust a submitted eligibility result.
  const verdict = body.freeResult?.verdict;
  data.freeResult = { verdict: ["SAG", "TÆT", "INGEN", "STÆRK", "MULIG", "USIKKER"].includes(verdict) ? verdict : null };
  return data;
}

// ─── History log (persistent JSON file) ───────────────────────
// Gemmes på Railway Volume (/data) hvis den findes, så data overlever redeploys.
// Falder tilbage til lokal mappe (f.eks. ved kørsel uden volume) hvis /data ikke findes.
const HISTORY_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const HISTORY_FILE = path.join(HISTORY_DIR, "history.json");
console.log(`📁 History-fil: ${HISTORY_FILE}`);
let HISTORY = [];
try {
  if (fs.existsSync(HISTORY_FILE)) {
    HISTORY = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    console.log(`📋 Indlæste ${HISTORY.length} historikposter`);
  }
} catch(e) { console.warn("Kunne ikke læse history.json:", e.message); }

function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(HISTORY, null, 2)); }
  catch(e) { console.warn("Kunne ikke skrive history.json:", e.message); }
}

function logEvent(type, data) {
  const entry = { id: Date.now(), type, ts: new Date().toISOString(), ...data };
  HISTORY.unshift(entry); // nyeste først
  if (HISTORY.length > 2000) HISTORY = HISTORY.slice(0, 2000);
  saveHistory();
  return entry;
}

// ─── Admin dashboard ──────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error("FATAL: ADMIN_KEY env var is not set. Admin routes are disabled.");
}

const ADMIN_LOGIN_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin login</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f6f9}
.box{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:320px;width:100%;text-align:center}
input{width:100%;padding:10px;margin:12px 0;border:1px solid #d1d5db;border-radius:8px;font-size:1rem}
button{width:100%;padding:11px;background:#1c6dc4;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:600}
.err{color:#b91c1c;font-size:0.9rem;margin-top:8px}
</style></head><body>
<div class="box"><h2>🔐 Admin login</h2>
<form method="post" action="/admin/login">
<input type="password" name="key" placeholder="Admin-nøgle" autofocus>
<button type="submit">Log ind</button>
</form></div></body></html>`;

function requireAdminCookie(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).send("Admin ikke konfigureret (mangler ADMIN_KEY)");
  const cookie = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith("admin_session="));
  if (cookie && cookie.split("=")[1] === ADMIN_KEY) return next();
  return res.status(401).send(ADMIN_LOGIN_HTML);
}

app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  if (!ADMIN_KEY) return res.status(503).send("Admin ikke konfigureret");
  if (req.body.key === ADMIN_KEY) {
    res.setHeader("Set-Cookie", `admin_session=${ADMIN_KEY}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=43200`);
    return res.redirect(303, "/admin");
  }
  return res.status(401).send(ADMIN_LOGIN_HTML);
});

app.get("/admin", requireAdminCookie, (req, res) => {
  const search = (req.query.q || "").toLowerCase();
  const typeFilter = req.query.type || "";
  const page = Math.max(1, parseInt(req.query.page || "1"));
  const perPage = 50;

  let rows = HISTORY;
  if (search) rows = rows.filter(r =>
    (r.address||"").toLowerCase().includes(search) ||
    (r.sessionId||"").toLowerCase().includes(search) ||
    (r.customerEmail||"").toLowerCase().includes(search)
  );
  if (typeFilter) rows = rows.filter(r => r.type === typeFilter);
  else rows = rows.filter(r => r.type !== "pay_shown"); // fylder kun i listen; tælles i salgstragten

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const slice = rows.slice((page - 1) * perPage, page * perPage);

  // Overblik: alt samlet i tre farver. Tjek uden lokale handler (landsdelsgennemsnit) tælles med i
  // deres farve og vises kun som én linje, fordi de er et groft estimat.
  const payments    = HISTORY.filter(r => r.type === "payment").length;
  const klager      = HISTORY.filter(r => r.type === "klage_done").length;
  const ingenBelaeg = HISTORY.filter(r => r.type === "klage_no_grounds").length;
  const freeChecks  = HISTORY.filter(r => r.type === "free_check").length;
  const revenue     = HISTORY.filter(r => r.type === "payment").reduce((sum, r) => sum + (r.amount || 350), 0);
  const signups     = HISTORY.filter(r => r.type === "notify_signup").length;
  // MULIG/USIKKER kommer kun uden lokale handler og får ingen købeknap, så de står for sig
  const FARVE = { SAG: "roed", STÆRK: "roed", TÆT: "orange", MULIG: "usikker", USIKKER: "usikker", INGEN: "groen" };
  const farveAf = v => FARVE[v] || "groen";
  const tjekListe = HISTORY.filter(r => r.type === "free_check");
  const udenLokale = tjekListe.filter(r => r.source === "landsdel").length;
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 + " %" : "–";
  const sidst7 = Date.now() - 7 * 864e5;
  const tjek7 = tjekListe.filter(r => Date.parse(r.ts) >= sidst7).length;
  const betalt7 = HISTORY.filter(r => r.type === "payment" && Date.parse(r.ts) >= sidst7).length;
  const tael = (type, f) => HISTORY.filter(r => r.type === type && f(r)).length;
  const raekker = [["roed", "🔴 Rød", "Stor afvigelse – købeknap vises med det samme"],
                   ["orange", "🟠 Orange", "Mulig sag – købeknap efter kryds ved forhold"],
                   ["groen", "🟢 Grøn", "Ingen sag – kun tilmelding"],
                   ["usikker", "⚪ Usikker", "Ingen lokale handler – kun tilmelding"]].map(([f, navn, forklaring]) => {
    const tjek   = tael("free_check", r => farveAf(r.verdict) === f);
    const vist   = tael("pay_shown", r => farveAf(r.verdict) === f);
    const klik   = tael("buy_click", r => farveAf(r.verdict) === f);
    const stripe_ = tael("checkout_started", r => farveAf(r.freeVerdict) === f);
    const betalt = tael("payment", r => farveAf(r.freeVerdict) === f);
    return { f, navn, forklaring, tjek, vist, klik, stripe: stripe_, betalt };
  });
  const medSag = raekker[0].tjek + raekker[1].tjek;
  const ingenKnap = f => f === "groen" || f === "usikker";
  const sum = k => raekker.reduce((s, r) => s + r[k], 0);
  // Klik registreres først fra denne version; før da kendes kun "gik til betaling"
  const sporingFra = HISTORY.filter(r => r.type === "pay_shown" || r.type === "buy_click").map(r => r.ts).sort()[0];
  const funnelHtml = `<div class="scroll"><table class="funnel"><thead><tr><th>Resultat</th><th>Tjek</th><th>Så købeknap</th><th>Klikkede køb</th><th>Gik til betaling</th><th>Betalte</th></tr></thead><tbody>
${raekker.map(r => `<tr><td><strong>${r.navn}</strong><div class="hint">${r.forklaring}</div></td><td>${r.tjek} <span class="hint">${pct(r.tjek, freeChecks)}</span></td><td>${ingenKnap(r.f) ? "–" : r.vist}</td><td>${ingenKnap(r.f) ? "–" : r.klik}</td><td>${ingenKnap(r.f) ? "–" : r.stripe}</td><td>${r.betalt}</td></tr>`).join("")}
<tr class="sum"><td>I alt</td><td>${freeChecks}</td><td>${sum("vist")}</td><td>${sum("klik")}</td><td>${sum("stripe")}</td><td>${payments}</td></tr></tbody></table></div>`;
  const advarsel = medSag > 0 && payments === 0
    ? `<div class="alert">⚠️ <strong>${medSag} tjek med en mulig sag, men 0 betalinger.</strong> ${sum("klik") ? `${sum("klik")} har klikket køb, men kun ${sum("stripe")} kom videre til betaling. Klik der stopper, skyldes typisk, at kunden ikke har sat kryds ved "endelig vurdering" (${tael("buy_click", r => r.blocked)} af klikkene).` : sporingFra ? "Ingen har klikket på købeknappen endnu." : "Klik på købeknappen måles fra nu af, så næste gang kan du se, hvor kunderne falder fra."}</div>`
    : "";

  const rowHtml = slice.map(r => {
    const TYPES = {
      payment: ["💳", "Betaling"], klage_done: ["📄", "Klagetekst"], klage_no_grounds: ["📋", "Ingen belæg"],
      klage_error: ["❌", "Fejl"], free_check: ["🔍", "Gratis tjek"], checkout_started: ["🛒", "Til betaling"],
      input_warning: ["⚠️", "Tjek af tal"], notify_signup: ["📬", "Tilmelding"], email_sent: ["📧", "Mail sendt"],
      pay_shown: ["👀", "Så købeknap"], buy_click: ["👆", "Klik på køb"],
    };
    const [ico, label] = TYPES[r.type] || ["•", r.type];
    const snippet = (r.klageTekst||"").slice(0,120).replace(/</g,"&lt;") || "";
    // E-mail kan nu komme fra den offentlige tilmeldingsformular, så den escapes altid
    const safeEmail = String(r.customerEmail || "").replace(/[<>"'&]/g, "");
    const emailCol = r.customerEmail
      ? `<a href="mailto:${safeEmail}" style="color:#1c6dc4;font-size:0.78rem">${safeEmail}</a>${r.emailSent===false?' ⚠️':r.emailSent?' ✅':''}`
      : '<span style="color:#9ca3af;font-size:0.78rem">—</span>';

    // Build result column based on event type
    let resultatCol = '<span style="color:#9ca3af">—</span>';
    if (r.type === "free_check" && r.verdict) {
      const vColor = r.verdict === "STÆRK" || r.verdict === "SAG" ? "#dc2626" : r.verdict === "MULIG" || r.verdict === "USIKKER" || r.verdict === "TÆT" ? "#d97706" : "#059669";
      const vLabel = { STÆRK: "Stærk", MULIG: "Mulig", USIKKER: "Usikker", SAG: "Sag", TÆT: "Tæt på" }[r.verdict] || "Ingen";
      resultatCol = `<span style="color:${vColor};font-weight:600">${vLabel}</span>` +
        (r.gap_pct != null ? ` <span style="font-size:0.75rem;color:#6b7280">(${r.gap_pct>0?"+":""}${r.gap_pct}%)</span>` : "");
    } else if (r.type === "klage_done") {
      resultatCol = '<span style="color:#059669;font-weight:600">Klage genereret</span>';
    } else if (r.type === "klage_no_grounds") {
      resultatCol = '<span style="color:#d97706;font-weight:600">Intet belæg</span>';
    } else if (r.type === "klage_error") {
      resultatCol = `<span style="color:#dc2626;font-weight:600">Fejl</span>`;
    } else if (r.type === "payment") {
      resultatCol = '<span style="color:#1c6dc4;font-weight:600">350 kr betalt</span>';
    }

    return `<tr>
      <td style="white-space:nowrap;font-size:0.78rem;color:#6b7280">${r.ts.slice(0,16).replace("T"," ")}</td>
      <td>${ico} <strong>${label}</strong></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.address||"").replace(/"/g,"'")}">
        ${(r.address||"-").replace(/</g,"&lt;")}</td>
      <td>${resultatCol}</td>
      <td style="text-align:right">${r.ev ? (Number(r.ev)/1000000).toFixed(1)+"M" : "-"}</td>
      <td style="text-align:right">${r.m2 ? r.m2+" m²" : "-"}</td>
      <td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${emailCol}</td>
      <td style="font-size:0.75rem;color:#6b7280;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="${snippet}">${snippet||""}</td>
    </tr>`;
  }).join("");

  const pagerHtml = pages > 1 ? Array.from({length:pages},(_,i)=>
    `<a href="/admin?q=${encodeURIComponent(search)}&type=${typeFilter}&page=${i+1}"
      style="padding:4px 10px;border-radius:6px;background:${i+1===page?"#1c6dc4":"#e8f1fc"};color:${i+1===page?"#fff":"#1c6dc4"};text-decoration:none;font-size:0.85rem;font-weight:600">${i+1}</a>`
  ).join(" ") : "";

  res.send(`<!DOCTYPE html><html lang="da"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Vurderingstjekket</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6f9;color:#1a2130;margin:0}
header{background:#0b2447;color:#fff;padding:18px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{margin:0;font-size:1.1rem}
header a{color:#aac4e8;font-size:0.82rem;text-decoration:none}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:20px 24px 8px;max-width:1100px}
.kpi{background:#fff;border-radius:12px;padding:16px 18px;border:1px solid #e2e8f0}
.kpi.hl{background:#0b2447;color:#fff;border-color:#0b2447}
.kpi .n{font-size:1.9rem;font-weight:700;line-height:1.1}
.kpi .l{font-size:0.85rem;font-weight:600;margin-top:4px}
.kpi .hint{margin-top:2px}
.kpi.hl .hint{color:#aac4e8}
.hint{font-size:0.76rem;color:#6b7280;font-weight:400}
.alert{margin:8px 24px 0;max-width:1052px;background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;border-radius:10px;padding:12px 16px;font-size:0.9rem}
.box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin:16px 24px;padding:18px 20px;max-width:1052px}
.box h2,.evh{margin:0 0 10px;font-size:1rem}
.evh{margin:24px 24px 10px}
.funnel{margin:0}
.scroll{overflow-x:auto}
@media(max-width:600px){.kpis{grid-template-columns:1fr 1fr;padding:16px}.kpi .n{font-size:1.5rem}.box,.alert{margin-left:16px;margin-right:16px}.bar form{min-width:0;flex-wrap:wrap}}
.funnel td,.funnel th{padding:10px 12px}
.funnel tr.sum td{font-weight:700;border-top:2px solid #e2e8f0}
.bar{padding:0 24px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar form{display:flex;gap:8px;flex:1;min-width:240px}
.bar input{flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem}
.bar select{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem}
.bar button{padding:9px 16px;background:#1c6dc4;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;margin:0 0 24px}
th{text-align:left;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;border-bottom:2px solid #e2e8f0}
td{padding:9px 12px;border-bottom:1px solid #f0f2f5;font-size:0.87rem;vertical-align:top}
tr:hover td{background:#f8fafc}
.pager{padding:0 24px 32px;display:flex;gap:6px;flex-wrap:wrap}
.empty{text-align:center;padding:40px;color:#9ca3af;font-size:0.9rem}
</style></head><body>
<header>
  <h1>Vurderingstjekket · Salg</h1>
  <a href="/admin">← Alle poster</a>
</header>

<div class="kpis">
  <div class="kpi"><div class="n">${freeChecks}</div><div class="l">Gratis tjek</div><div class="hint">${tjek7} de sidste 7 dage</div></div>
  <div class="kpi"><div class="n">${medSag}</div><div class="l">Med mulig sag (rød/orange)</div><div class="hint">${pct(medSag, freeChecks)} af tjek</div></div>
  <div class="kpi"><div class="n">${payments}</div><div class="l">Betalinger</div><div class="hint">${betalt7} de sidste 7 dage</div></div>
  <div class="kpi"><div class="n">${pct(payments, medSag)}</div><div class="l">Konvertering</div><div class="hint">betalinger af tjek med sag</div></div>
  <div class="kpi hl"><div class="n">${revenue.toLocaleString("da-DK")} kr</div><div class="l">Omsætning</div><div class="hint">${freeChecks ? Math.round(revenue / freeChecks).toLocaleString("da-DK") + " kr pr. tjek" : "–"}</div></div>
</div>
${advarsel}
<section class="box">
  <h2>Salgstragt</h2>
  ${funnelHtml}
  <p class="hint" style="margin:10px 0 0">${udenLokale} tjek (${pct(udenLokale, freeChecks)}) fandt ingen lokale handler og brugte et groft gennemsnit for landsdelen. De røde blandt dem er talt med under Rød.${sporingFra ? ` Klik måles fra ${sporingFra.slice(0, 10)}.` : ""}</p>
  <p class="hint" style="margin:4px 0 0">Klagetekster lavet: ${klager} · Intet belæg efter betaling: ${ingenBelaeg} · E-mail-tilmeldinger: ${signups}</p>
</section>

<h2 class="evh">Alle hændelser</h2>
<div class="bar">
  <form method="get" action="/admin">
    <input type="text" name="q" placeholder="Søg adresse eller session-ID..." value="${(req.query.q||"").replace(/"/g,"&quot;")}">
    <select name="type">
      <option value="">Alle typer</option>
      <option value="payment"${typeFilter==="payment"?" selected":""}>💳 Betalinger</option>
      <option value="klage_done"${typeFilter==="klage_done"?" selected":""}>📄 Klagetekster</option>
      <option value="klage_no_grounds"${typeFilter==="klage_no_grounds"?" selected":""}>📋 Ingen belæg</option>
      <option value="klage_error"${typeFilter==="klage_error"?" selected":""}>❌ Fejl</option>
      <option value="free_check"${typeFilter==="free_check"?" selected":""}>🔍 Gratis tjek</option>
      <option value="buy_click"${typeFilter==="buy_click"?" selected":""}>👆 Klik på køb</option>
      <option value="checkout_started"${typeFilter==="checkout_started"?" selected":""}>🛒 Til betaling</option>
      <option value="notify_signup"${typeFilter==="notify_signup"?" selected":""}>📬 Tilmeldinger</option>
    </select>
    <button type="submit">Søg</button>
  </form>
</div>

<div class="scroll"><table>
<thead><tr>
  <th>Tidspunkt</th><th>Type</th><th>Adresse</th><th>Resultat</th><th>EV</th><th>Areal</th><th>E-mail</th><th>Uddrag</th>
</tr></thead>
<tbody>
${rowHtml || '<tr><td colspan="8" class="empty">Ingen poster fundet</td></tr>'}
</tbody>
</table></div>
${pagerHtml ? `<div class="pager">${pagerHtml}</div>` : ""}
</body></html>`);
});

// ─── Create Stripe payment session ───────────────────────────
// POST /api/create-payment  body: { address, label, m2, kommunekode, anvKode, ev, gv, freeResult }
app.post("/api/create-payment", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!stripe) return res.status(500).json({ error: "Stripe er ikke konfigureret (mangler STRIPE_SECRET_KEY)" });
  const input = checkoutInput(req.body);
  if (!input) return res.status(400).json({ error: "Ugyldige boligoplysninger" });

  const sessionId = crypto.randomUUID();
  SESSIONS.set(sessionId, {
    ...input,
    status: "pending_payment",
    createdAt: Date.now(),
    paymentVerified: false,
    expectedAmount: PRICE_DKK * 100,
  });

  logEvent("checkout_started", {
    sessionId,
    address: input.label || input.address || "",
    ev: input.ev,
    m2: input.m2,
    kommunekode: String(input.kommunekode || "").padStart(4, "0"),
    freeVerdict: input.freeResult.verdict,
  });

  try {
    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
    const checkoutSession = await stripe.checkout.sessions.create({
      // Ingen fast liste: Stripe viser de betalingsmetoder, der er slået til i dashboardet
      // (kort, og MobilePay når det aktiveres der).
      line_items: [{
        price_data: {
          currency: "dkk",
          product_data: {
            name: "Vurderingstjekket – Klagepakke",
            description: `Dokumentation og færdig klage · ${input.label || input.address || "din ejendom"}`,
          },
          unit_amount: PRICE_DKK * 100, // øre
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${origin}/ejendomsvurdering?session=${sessionId}`,
      cancel_url:  `${origin}/ejendomsvurdering?cancelled=1`,
      metadata:    { sessionId },
    });

    SESSIONS.get(sessionId).stripeCheckoutId = checkoutSession.id;
    grantReportAccess(req, res, sessionId, SESSIONS.get(sessionId));
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

    // BoligSelvsalg payment
    if (co.metadata?.type === "selvsalg") {
      const sagId = co.metadata?.sagId;
      const sag = sagId && SAGER[sagId];
      if (sag && co.payment_status === "paid" && co.currency === "dkk" && !sag.betalt) {
        sag.betalt = true;
        sag.betaltAt = new Date().toISOString();
        saveSager(SAGER);
        logEvent("selvsalg_betalt", { sagId, adresse: sag.adresse, amount: co.amount_total });
        console.log(`✅ Selvsalg betalt: sag ${sagId}`);
      }
      return;
    }

    // Låneovervågning abonnement
    if (co.metadata?.type === "laanovervagning" && co.payment_status === "paid" && co.currency === "dkk") {
      const email = co.customer_details?.email || co.customer_email || co.metadata?.email;
      if (email && !ABONNENTER.find(a => a.email === email)) {
        const ab = {
          id: crypto.randomUUID(),
          email,
          createdAt: new Date().toISOString(),
          stripeCheckoutId: co.id,
          restgaeld:         parseInt(co.metadata?.restgaeld || "0"),
          rente:             parseFloat(co.metadata?.rente || "4"),
          loebetid:          parseInt(co.metadata?.loebetid || "25"),
          laantype:          co.metadata?.laantype || "fastforrentet",
          alertYdelseKr:     parseInt(co.metadata?.alertYdelseKr || "2000"),
          alertRestgaeldKr:  parseInt(co.metadata?.alertRestgaeldKr || "200000"),
          periode:           co.metadata?.periode || "maanedlig",
          adresse:           co.metadata?.adresse || "",
          postnr:            (co.metadata?.adresse || "").match(/\b(\d{4})\b/)?.[1] || "",
          lastSentAt:        null,
          alertSentAt:       null,
        };
        ABONNENTER.push(ab);
        saveAbonnenter(ABONNENTER);
        logEvent("overvagning_tilmeldt", { email, restgaeld: ab.restgaeld, rente: ab.rente });
        console.log(`✅ Overvågning tilmeldt: ${email}`);
        // Send bekræftelsesmail
        const nextMailDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString("da-DK", { day:"numeric", month:"long" });
        const mail = buildConfirmationEmail({ email, adresse: ab.adresse, nextMailDate });
        sendEmail({ to: email, ...mail }).catch(() => {});
      }
      return;
    }

    const sessionId = co.metadata?.sessionId;
    const sess = sessionId && SESSIONS.get(sessionId);
    if (!sess) return;
    // Signature verification authenticates Stripe, but this event must also
    // represent the settled payment for this exact server-created order.
    if (co.id !== sess.stripeCheckoutId || co.payment_status !== "paid" ||
        co.currency !== "dkk" || co.amount_total !== sess.expectedAmount) return;
    if (sess.paymentVerified) return;

    sess.paymentVerified = true;
    sess.status = "generating";
    // Capture customer email from Stripe for later delivery
    sess.customerEmail = co.customer_details?.email || co.customer_email || null;
    // Log payment event
    logEvent("payment", {
      sessionId,
      address: sess.label || sess.address || "",
      ev: sess.ev, gv: sess.gv, m2: sess.m2,
      kommunekode: sess.kommunekode,
      stripePaymentId: co.payment_intent || co.id,
      amount: co.amount_total != null ? co.amount_total / 100 : PRICE_DKK,
      freeVerdict: sess.freeResult?.verdict || null,
      customerEmail: sess.customerEmail || null,
    });
    console.log(`✅ Payment OK for session ${sessionId} — starting klage generation`);

    generateKlage(sessionId, sess).catch(err => {
      console.error("generateKlage fejl:", err);
      sess.status = "error";
      sess.error = err.message;
      logEvent("klage_error", { sessionId, address: sess.label||"", error: err.message });
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

// Median, hvor hver pris tæller med sin vægt (fx nære handler mere end fjerne)
function vaegtetMedian(vals, vaegte) {
  const par = vals.map((v, i) => [v, vaegte[i] ?? 1]).sort((a, b) => a[0] - b[0]);
  const halv = par.reduce((s, p) => s + p[1], 0) / 2;
  let acc = 0;
  for (let i = 0; i < par.length; i++) {
    acc += par[i][1];
    // Ligger halvdelen præcis mellem to priser (fx lige mange uden vægt), tages gennemsnittet
    if (Math.abs(acc - halv) < 1e-9 && i + 1 < par.length) return (par[i][0] + par[i + 1][0]) / 2;
    if (acc > halv) return par[i][0];
  }
  return par[par.length - 1][0];
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function postnrFrom(obj) {
  if (/^\d{4}$/.test(String(obj.postnr || ""))) return String(obj.postnr);
  const m = (obj.address || obj.label || "").match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

// Tinglyste handler 2020–2021 pr. postnummer og boligtype. Handlerne ændrer sig ikke,
// så de gemmes på disk og hentes kun én gang pr. postnummer (sparer Apify-kørsler og tid).
const COMPS_CACHE_FILE = path.join(HISTORY_DIR, "comps-cache.json");
const COMPS_TTL_MS     = 90 * 24 * 3600 * 1000;
let COMPS_CACHE = {};
try {
  if (fs.existsSync(COMPS_CACHE_FILE)) COMPS_CACHE = JSON.parse(fs.readFileSync(COMPS_CACHE_FILE, "utf8"));
} catch (e) { console.warn("Kunne ikke læse comps-cache.json:", e.message); }
const COMPS_INFLIGHT = new Map();
// Seneste hentning af handler, så /api/health viser om Boliga eller Apify virker (ingen persondata)
let LAST_COMPS_FETCH = null;

// Salgsdatoen som dansk dato. Boliga sender midnat dansk tid i UTC, fx "2021-03-31T22:00:00Z" = 1. april
function danskDato(iso) {
  const d = new Date(iso);
  return isNaN(d) ? String(iso || "") : d.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
}

// Handler direkte fra Boligas offentlige søge-API (gratis, op til 200 handler).
// Felterne oversættes til samme form, som Apify-aktøren giver.
async function getSoldCompsBoliga(zipCode, typeCode) {
  const url = page => "https://api.boliga.dk/api/v2/sold/search/results?searchTab=1" +
    `&propertyType=${encodeURIComponent(typeCode)}&salesDateMin=2020&salesDateMax=2021` +
    `&zipcodeFrom=${encodeURIComponent(zipCode)}&zipcodeTo=${encodeURIComponent(zipCode)}` +
    `&sort=date-d&pageSize=50&page=${page}`;
  const results = [];
  for (let page = 1; page <= 4; page++) {
    const r = await fetch(url(page), {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Vurderingstjekket)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Boliga HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data?.results)) throw new Error("Uventet Boliga-svar");
    results.push(...data.results);
    if (page >= (data.meta?.totalPages || 1)) break;
  }
  return results.map(c => ({
    guid:             c.guid,
    address:          `${c.address}, ${c.zipCode} ${c.city || ""}`.trim(),
    price:            c.price,
    size:             c.size,
    squareMeterPrice: c.sqmPrice ? Math.round(c.sqmPrice) : null,
    soldDate:         danskDato(c.soldDate),
    buildYear:        c.buildYear,
    latitude:         c.latitude,
    longitude:        c.longitude,
    salesType:        c.saleType,
  }));
}

async function getSoldComps(zipCode, typeCode) {
  if (!zipCode) throw new Error("Mangler postnummer");
  const key = `v4|${zipCode}|${typeCode}`; // v4: op til 200 handler 2020–2021, direkte fra Boliga
  const cached = COMPS_CACHE[key];
  if (cached && Date.now() - cached.ts < COMPS_TTL_MS) return cached.comps;
  // To samtidige opslag i samme postnummer deler én Apify-kørsel
  if (COMPS_INFLIGHT.has(key)) return COMPS_INFLIGHT.get(key);

  const job = (async () => {
    let comps;
    try {
      comps = await getSoldCompsBoliga(zipCode, typeCode);
      LAST_COMPS_FETCH = { kilde: "boliga", ok: true, antal: comps.length, tid: new Date().toISOString() };
    } catch (e) {
      console.warn("Boliga direkte fejlede, prøver Apify:", e.message);
      LAST_COMPS_FETCH = { kilde: "boliga", ok: false, fejl: e.message.slice(0, 120), tid: new Date().toISOString() };
      comps = await getSoldCompsApify(zipCode, typeCode);
      LAST_COMPS_FETCH = { ...LAST_COMPS_FETCH, reserve: "apify", reserveAntal: comps.length };
    }
    // Et tomt svar kan være en midlertidig fejl hos Boliga, så det gemmes ikke
    if (comps.length === 0) return comps;
    COMPS_CACHE[key] = { ts: Date.now(), comps };
    try { fs.writeFileSync(COMPS_CACHE_FILE, JSON.stringify(COMPS_CACHE)); }
    catch (e) { console.warn("Kunne ikke skrive comps-cache.json:", e.message); }
    return comps;
  })();
  COMPS_INFLIGHT.set(key, job);
  try { return await job; } finally { COMPS_INFLIGHT.delete(key); }
}

// Reserve: samme handler via Apify-aktøren (koster pr. handel og har en månedsgrænse)
async function getSoldCompsApify(zipCode, typeCode) {
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN mangler på serveren.");
  {
    // Aktørens soldYearMin/soldYearMax bliver ignoreret (den returnerer de nyeste salg),
    // så perioden sættes direkte i Boligas egen søge-URL. Kun handler før vurderings-
    // tidspunktet 1.1.2022 bruges som sammenligningsgrundlag.
    // Aktøren følger ikke selv flere sider af en start-URL (hver side giver 10 handler),
    // så siderne 1–8 gives med hver for sig
    const boligaUrl = page => "https://api.boliga.dk/api/v2/sold/search/results?searchTab=1" +
      `&propertyType=${encodeURIComponent(typeCode)}&salesDateMin=2020&salesDateMax=2021` +
      `&zipcodeFrom=${encodeURIComponent(zipCode)}&zipcodeTo=${encodeURIComponent(zipCode)}&sort=date-d&page=${page}`;
    const actorInput = {
      listingType: "sold",
      startUrls:   [1, 2, 3, 4, 5, 6, 7, 8].map(page => ({ url: boligaUrl(page) })),
      maxItems:    80,
    };
    const apifyUrl =
      `https://api.apify.com/v2/acts/${BOLIGA_ACTOR}/run-sync-get-dataset-items` +
      `?token=${APIFY_TOKEN}`;
    const r = await fetch(apifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
      signal: AbortSignal.timeout(150000),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Apify fejl ${r.status}: ${txt.slice(0, 200)}`);
    }
    const raw = await r.json();
    if (!Array.isArray(raw)) throw new Error("Uventet Apify-svar");
    // Samme handel kan komme med på to sider, hvis Boliga får nye data imens
    const seen = new Set();
    return raw.filter(c => { const k = c.id || c.guid || `${c.address}|${c.soldDate}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }
}

// Vejnavnet foran husnummeret, fx "Højager" i "Højager 20, 2670 Greve"
function streetName(address) {
  const m = String(address || "").match(/^\s*([^\d,]+?)\s+\d/);
  return m ? m[1].trim().toLowerCase() : null;
}

// Familiehandler ("Fam. Salg"), auktioner o.l. er ikke markedshandler og må ikke trække estimatet
function erMarkedshandel(c) {
  return !/fam|auktion|tvang/i.test(String(c.salesType || ""));
}

// Kvartal for en salgsdato, fx "2021-05-10" → "2021K2"
function kvartal(dato) {
  const m = String(dato || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}K${Math.ceil(Number(m[2]) / 3)}` : null;
}

// subject: { address, year, lot, koord, indeks } – alt er valgfrit
function analyseComps(allComps, m2Num, evNum, subject = {}) {
  const { address: subjectAddress, year: subjectYear, lot: subjectLot, koord, indeks } = subject;
  // Kun almindelige handler før vurderingstidspunktet 1.1.2022 (gamle cache-poster kan indeholde 2022).
  // Hver pris føres frem til niveauet 1.1.2022 med Danmarks Statistiks prisindeks for landsdelen.
  const pool = allComps.filter(c => c.squareMeterPrice && erMarkedshandel(c) &&
    (!c.soldDate || String(c.soldDate) < "2022-01-01"))
    .map(c => {
      const i = indeks && indeks[kvartal(c.soldDate)];
      const faktor = i ? indeks.target / i : 1;
      return { ...c, faktor, adjSqm: Math.round(c.squareMeterPrice * faktor) };
    });
  // Size band: ±25% around subject, widen if fewer than 4
  let band = pool.filter(c => c.size >= m2Num * 0.75 && c.size <= m2Num * 1.25);
  if (band.length < 4) band = pool.filter(c => c.size >= m2Num * 0.60 && c.size <= m2Num * 1.40);
  if (band.length < 3) band = pool;
  // Ingen brugbare handler før 1.1.2022: hellere intet lokalt estimat end et forkert (så bruges landsdelen)
  // Byggeår: brug huse fra omtrent samme periode, når der er nok af dem
  const yr = parseInt(subjectYear);
  if (yr > 1700) {
    const sameEra = band.filter(c => c.buildYear && Math.abs(c.buildYear - yr) <= 25);
    if (sameEra.length >= 5) band = sameEra;
  }
  // Grundareal: huse med en grund af nogenlunde samme størrelse, når kunden har oplyst den
  const lot = parseInt(subjectLot);
  if (lot > 0) {
    const sameLot = band.filter(c => c.lotSize && c.lotSize >= lot * 0.65 && c.lotSize <= lot * 1.35);
    if (sameLot.length >= 5) band = sameLot;
  }
  // Afstand: ingen hård grænse. De nærmeste handler vægtes højest, og området udvides
  // automatisk, til der er mindst 8 handler (eller alle, hvis der er færre)
  if (koord) {
    band = band.map(c => {
      if (!c.latitude || !c.longitude) return { ...c, afstand: null };
      const u = wgs84TilUtm32(c.latitude, c.longitude);
      return { ...c, afstand: Math.hypot(u.x - koord.x, u.y - koord.y) };
    });
    const kendt = band.filter(c => c.afstand != null).sort((a, b) => a.afstand - b.afstand);
    if (kendt.length >= 5) {
      let radius = 500;
      while (kendt.filter(c => c.afstand <= radius).length < Math.min(8, kendt.length)) radius *= 1.5;
      band = kendt.filter(c => c.afstand <= radius);
    }
  }
  // De mest sammenlignelige handler er dem på samme vej. Brug dem, når der er nok af dem,
  // uanset om de trækker estimatet op eller ned.
  const street = streetName(subjectAddress);
  const sameStreet = street ? band.filter(c => streetName(c.address) === street) : [];
  const usedSameStreet = sameStreet.length >= 3;
  if (usedSameStreet) band = sameStreet;

  const sqmPrices = band.map(c => c.adjSqm || c.squareMeterPrice).filter(Boolean);
  // Vægt: 1 tæt på, faldende med afstanden (halv vægt ved 1 km)
  const vaegte = band.map(c => c.afstand != null ? 1 / (1 + (c.afstand / 1000) ** 2) : 1);
  const medianSqm = sqmPrices.length > 0 ? vaegtetMedian(sqmPrices, vaegte) : null;
  const estimatedMarket = medianSqm ? Math.round(medianSqm * m2Num) : null;
  // Klagegrænse: markedsestimatet skal ligge under 80 % af EV for at klage kan ændre vurderingen
  // (ejendomsværdien skal falde med mere end 20 %, jf. skatteforvaltningsloven § 35 h stk 2)
  const targetEV        = Math.round(evNum * 0.80);

  const topComps = [...band]
    .sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))
    .slice(0, 8);

  // Real grounds check against the actual local (postnummer) analysis.
  // Only generate a formal "EV er for høj"-claim when the real, representative
  // comps actually support it.
  const hasGrounds = estimatedMarket != null && estimatedMarket < targetEV;
  const tidskorrigeret = band.some(c => c.faktor && c.faktor !== 1);
  // Spredning: afstand mellem 25 %- og 75 %-fraktilen i forhold til medianen
  const sorted = [...sqmPrices].sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const spredning = medianSqm && sorted.length >= 4 ? (q(0.75) - q(0.25)) / medianSqm : null;
  return { medianSqm, estimatedMarket, targetEV, topComps, hasGrounds, compsCount: sqmPrices.length, usedSameStreet, tidskorrigeret, spredning };
}

// Omtrentlig årlig ejendomsværdiskat: 5,1 ‰ af beskatningsgrundlaget (80 % af EV)
// op til 9,2 mio. kr og 14 ‰ af resten. Grundskyld og rabatordninger er ikke medregnet.
function ejendomsvaerdiskat(ev) {
  const grundlag = ev * 0.80;
  return 0.0051 * Math.min(grundlag, 9200000) + 0.014 * Math.max(0, grundlag - 9200000);
}

// Forhold ved boligen, som kunden kan krydse af, når vurderingen ligger lige under klagegrænsen.
// Kun disse faste tekster kommer med i klagen (ingen fritekst fra brugeren).
const FORHOLD = {
  renovering:  "Ejendommen trænger til renovering (fx køkken, bad, tag eller vinduer er af ældre dato).",
  skader:      "Der er fugt, skimmel, sætningsskader eller andre bygningsskader.",
  stoej:       "Ejendommen er belastet af støj fra stærkt trafikeret vej, jernbane eller lignende.",
  beliggenhed: "Ejendommen har en ugunstig beliggenhed (fx indkig, nabo til erhverv eller højspændingsmaster, eller en vanskelig grund).",
  areal:       "Boligarealet er reelt mindre eller dårligere end registreret (fx kælder eller tagetage medregnet som fuld bolig).",
};

async function generateKlage(sessionId, sess) {
  const m2Num  = Number(sess.m2);
  const evNum  = Number(sess.ev);
  const zipCode = postnrFrom(sess);
  // Normalt allerede hentet og gemt under det gratis tjek, så det går hurtigt
  const landsdel = KOMMUNEKODE_TO_LANDSDEL[String(sess.kommunekode || "").padStart(4, "0")] || sess.landsdel;
  const [allComps, indeks, koord] = await Promise.all([
    getSoldComps(zipCode, apifyTypeCode(sess.anvKode || "120")),
    getPrisindeks(landsdel, isEjerlejlighed(sess.anvKode) ? EJENDOMSKATE_EJERLEJLIGHED : EJENDOMSKATE_ENFAMILIE),
    getAdresseKoordinater(sess.adresseId),
  ]);
  const analyse = analyseComps(allComps, m2Num, evNum, {
    address: sess.address || sess.label, year: sess.opfoeretAar, lot: sess.grundareal, koord, indeks,
  });
  const { medianSqm, estimatedMarket, targetEV, topComps } = analyse;
  // Lige under grænsen (10–20 %) med forhold ved boligen: klagen bygger på handlerne plus forholdene
  const forhold = (Array.isArray(sess.forhold) ? sess.forhold : []).filter(k => FORHOLD[k]);
  const gapPct  = estimatedMarket ? (evNum - estimatedMarket) / evNum * 100 : 0;
  const medForhold = !analyse.hasGrounds && forhold.length > 0 && gapPct >= 10;
  const hasGrounds = analyse.hasGrounds || medForhold;

  sess.status        = "done";
  sess.hasGrounds    = hasGrounds;
  sess.klageTekst    = hasGrounds
    ? buildKlageTekst({ sess, medianSqm, estimatedMarket, targetEV, comps: topComps, forhold: medForhold ? forhold : [], tidskorrigeret: analyse.tidskorrigeret })
    : buildNoGroundsReport({ sess, medianSqm, estimatedMarket, targetEV, comps: topComps, tidskorrigeret: analyse.tidskorrigeret });
  sess.comps         = topComps;
  sess.estimatedMarket = estimatedMarket;
  sess.targetEV      = targetEV;
  sess.medianSqm     = medianSqm;

  // Log successful klage generation (email is sent on-demand by customer)
  logEvent(hasGrounds ? "klage_done" : "klage_no_grounds", {
    sessionId,
    address: sess.label || sess.address || "",
    ev: sess.ev, gv: sess.gv, m2: sess.m2,
    kommunekode: sess.kommunekode,
    estimatedMarket, targetEV, medianSqm,
    compsCount: topComps.length,
    forhold: medForhold ? forhold : [],
    customerEmail: sess.customerEmail || null,
    klageTekst: (sess.klageTekst || "").slice(0, 300),
  });
}

function fmtKr(n) { return Math.round(n).toLocaleString("da-DK") + " kr"; }
function fmtDate(d) { try { return new Date(d).toLocaleDateString("da-DK"); } catch(e) { return d || ""; } }

function buildKlageTekst({ sess, medianSqm, estimatedMarket, targetEV, comps, forhold = [], tidskorrigeret = false }) {
  const evNum = Number(sess.ev);
  const m2Num = Number(sess.m2);
  // gap_pct: hvor mange procent EV overstiger markedsestimatet (målt som andel af EV)
  const gap   = estimatedMarket ? Math.round(((evNum - estimatedMarket) / evNum) * 100) : null;
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
forhold til ejendomsvurderingslovens § 15, stk. 1. Loven bestemmer, at ejendomsværdien
skal ansættes til ejendommens forventede kontantværdi i fri handel (markedsværdien).
${forhold.length === 0 ? `En klage kan ændre ejendomsværdien, da vores analyse viser, at ejendomsværdien afviger
med mere end 20 % fra den dokumenterede markedsværdi (jf. skatteforvaltningsloven § 35 h,
stk. 2, der kræver en ændring på over 20 % for at klagemyndigheden kan ændre vurderingen).` :
`Sammenlignelige handler viser allerede en markedsværdi under den fastsatte ejendomsværdi.
Derudover har ejendommen særlige forhold, som trækker værdien yderligere ned, og som den
automatiske vurdering ikke tager højde for (se nedenfor). Samlet afviger ejendomsværdien
derfor med mere end 20 % fra ejendommens reelle markedsværdi (jf. skatteforvaltningsloven
§ 35 h, stk. 2).`}

MARKEDSANALYSE — SAMMENLIGNELIGE HANDLER 2020–2021

Analysen er baseret på ${comps.length} sammenlignelige, tinglysningsregistrerede handler
i postnummerområdet fra perioden 2020–2021, dvs. før vurderingstidspunktet 1. januar 2022.
Familiehandler og andre handler, der ikke er almindelige markedshandler, indgår ikke.${tidskorrigeret ? `
Salgspriserne er ført frem til prisniveauet pr. 1. januar 2022 med Danmarks Statistiks
prisindeks for ejendomssalg (EJ56) for landsdelen.` : ""}

${medianSqm ? `Median salgspris pr. m²: ${fmtKr(medianSqm)}/m²` : "Se vedlagte bilag."}
${estimatedMarket ? `Skønnet markedsværdi for ejendommen (${m2Num} m²): ca. ${fmtKr(Math.round(estimatedMarket / 10000) * 10000)}` : ""}
${gap != null ? `Markedsestimatet ligger ca. ${fmtKr(Math.round((evNum - (estimatedMarket || 0)) / 10000) * 10000)} under den ansatte ejendomsværdi, svarende til ca. ${gap} % af ejendomsværdien.` : ""}

REFERENCEEJENDOMME (tinglysningsregistrerede handler 2020–2021):
${rows}
${forhold.length > 0 ? `
SÆRLIGE FORHOLD VED EJENDOMMEN

${forhold.map(k => `  - ${FORHOLD[k]}`).join("\n")}

Forholdene bør dokumenteres med fotos, tilstandsrapport, støjkort eller lignende, som
vedlægges klagen.
` : ""}
PÅSTAND

${forhold.length === 0
  ? `Ejendomsværdien bedes nedsat til ${fmtKr(Math.round((estimatedMarket || evNum * 0.80) / 10000) * 10000)}
svarende til ejendommens dokumenterede markedsværdi (jf. ejendomsvurderingsloven § 15, stk. 1).`
  : `Ejendomsværdien bedes nedsat til højst ${fmtKr(Math.round(estimatedMarket / 10000) * 10000)}, svarende til markedsværdien
efter de sammenlignelige handler, og yderligere under hensyn til de særlige forhold ved
ejendommen (jf. ejendomsvurderingsloven § 15, stk. 1).`}${
  sess.gv ? "\n\nGrundværdien klages der ikke over i denne omgang." : ""}

BILAG
  1. Vurderingsmeddelelse (vedlægges ved indsendelse til skatteankestyrelsen.dk)
  2. BBR-meddelelse
  3. Oversigt over sammenlignelige handler (se ovenfor)${forhold.length > 0 ? "\n  4. Dokumentation for de særlige forhold (fotos, tilstandsrapport m.m.)" : ""}

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

// Honest "no grounds" report — used when the real postnummer-level
// analysis does NOT support a claim that the EV is too high, even though
// the free check's broader landsdel estimate suggested it was worth
// checking. We show the customer the same underlying data so they can see
// exactly why, rather than silently generating a complaint we can't back.
function buildNoGroundsReport({ sess, medianSqm, estimatedMarket, targetEV, comps, tidskorrigeret = false }) {
  const evNum = Number(sess.ev);
  const m2Num = Number(sess.m2);
  // gap_pct: EV vs markedsestimat som andel af EV (negativ = EV under estimat)
  const gap   = estimatedMarket ? Math.round(((evNum - estimatedMarket) / evNum) * 100) : null;

  const rows = comps.map(c =>
    `  - ${c.address || "ukendt"}, ${c.size} m², solgt ${fmtDate(c.soldDate)}: ` +
    `${fmtKr(c.price)} (${fmtKr(c.squareMeterPrice)}/m²)`
  ).join("\n");

  return `ANALYSERESULTAT — ${sess.address || sess.label || ""}

EJENDOMSOPLYSNINGER
  Adresse:         ${sess.address || sess.label || ""}
  Boligareal:      ${m2Num} m²
  Ejendomstype:    ${sess.boligtypeLabel || ""}
  Ejendomsværdi:   ${fmtKr(evNum)}

KONKLUSION: Ikke tilstrækkeligt belæg for en klage

Vi har analyseret ${comps.length} sammenlignelige, tinglysningsregistrerede handler i dit
postnummerområde fra perioden 2020–2021, før vurderingstidspunktet 1. januar 2022. Baseret på disse konkrete lokale handler (ikke kun landsdelsgennemsnittet fra
det gratis tjek) kan vi ikke finde grundlag for at hævde, at din ejendomsværdi er sat
for højt.

En klage kan kun ændre ejendomsværdien, hvis ændringen overstiger 20 % af den fastsatte
ejendomsværdi (jf. skatteforvaltningsloven § 35 h stk 2). Det kræver at markedsværdien
er under 80 % af EV — og det er ikke tilfældet her.

${medianSqm ? `Median salgspris pr. m² i dit postnummer: ${fmtKr(medianSqm)}/m²` : ""}
${estimatedMarket ? `Skønnet markedsværdi for ejendommen (${m2Num} m²): ca. ${fmtKr(Math.round(estimatedMarket / 10000) * 10000)}` : ""}
${gap != null ? `Forskel (EV minus markedsestimat): ca. ${gap} % af EV — kræver over 20 % for at klage kan ændre vurderingen.` : ""}

REFERENCEEJENDOMME (tinglysningsregistrerede handler 2020–2021):
${rows}

Du er naturligvis velkommen til at indsende en klage til Skatteankestyrelsen alligevel —
det er altid din egen beslutning, og du kan bruge tallene ovenfor som dokumentation. Men
vi kan ikke i god tro udarbejde en formel klagepåstand om, at ejendomsværdien er for høj,
når de konkrete lokale handler ikke understøtter det.

────────────────────────────────────────────────
Analyse udarbejdet af Vurderingstjekket.dk
Data er vejledende og ikke juridisk rådgivning.
`;
}

// ─── Tilmelding: besked ved næste vurdering ───────────────────
// POST /api/notify-signup  body: { email, address, verdict }
// ─── Boliglån screenshot OCR ──────────────────────────────────
// Accepts { image: base64string, mediaType: "image/jpeg"|"image/png" }
// Returns { restgaeld, maanedligYdelse, rente, loebetid, laantype }
app.post("/api/analyze-screenshot", async (req, res) => {
  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== "string") return res.status(400).json({ error: "Mangler billede" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "OCR ikke konfigureret" });

  try {
    const isPdf = mediaType === "application/pdf";
    const safeMediaType = isPdf
      ? "application/pdf"
      : (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType) ? mediaType : "image/jpeg");

    const fileBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image } }
      : { type: "image", source: { type: "base64", media_type: safeMediaType, data: image } };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              fileBlock,
              {
                type: "text",
                text: `Du er en dansk bank-OCR. Analysér dette ${isPdf ? "dokument" : "skærmbillede"} fra en dansk netbank eller låneapp og udtræk oplysninger om ét boliglån. Svar KUN med JSON uden markdown-kodeblok:\n{"restgaeld": <heltal kr uden punktum>, "maanedligYdelse": <heltal kr>, "rente": <decimal f.eks. 3.5>, "loebetid": <heltal år>, "laantype": <"fastforrentet"|"variabel"|"rentetilpasning"|"">}\nHvis en værdi ikke kan aflæses, brug null for tal og "" for tekst.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", response.status, err);
      return res.status(502).json({ error: "Analyse mislykkedes" });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || "{}";

    let parsed = {};
    try {
      // strip potential markdown fences if model disobeys
      const clean = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("Failed to parse OCR JSON:", text);
    }

    res.json({
      restgaeld: parsed.restgaeld ?? null,
      maanedligYdelse: parsed.maanedligYdelse ?? null,
      rente: parsed.rente ?? null,
      loebetid: parsed.loebetid ?? null,
      laantype: parsed.laantype ?? "",
    });
  } catch (err) {
    console.error("analyze-screenshot error:", err);
    res.status(500).json({ error: "Serverfejl ved billedanalyse" });
  }
});

// ─── Live markedsrenter (Danmarks Nationalbank + fallback) ────
// Fetches Danish mortgage reference rates from DNB statistics API.
// Cache TTL: 6 hours. Falls back to hardcoded rates if fetch fails.
let _renteCache = null;
let _renteCacheTs = 0;
const RENTE_FALLBACK = { fastforrentet: 4.50, F1: 3.20, F3: 3.50, F5: 3.75, afdragsfri: 4.25, updated: null, source: "fallback" };

async function fetchLiveRenter() {
  const now = Date.now();
  if (_renteCache && now - _renteCacheTs < 6 * 3600 * 1000) return _renteCache;

  // Danmarks Nationalbank Statistics API — series DNRENTEDK (realkreditrenter)
  // Table: DNRENTM gives monthly avg mortgage rates by type.
  // We use the most recent observation for each series.
  try {
    const url = "https://api.statbank.dk/v1/data/DNRENTM/JSONSTAT?lang=da&RENTETYPE=REALKM&REALKM=*&Tid=latest";
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`DNB HTTP ${r.status}`);
    const json = await r.json();
    // Extract values — DNB JSONSTAT has dataset.value array and dimension labels
    const dim = json?.dataset?.dimension;
    const vals = json?.dataset?.value;
    if (!dim || !vals) throw new Error("Uventet format fra DNB");
    // Series labels from REALKM dimension
    const renteLabels = dim?.REALKM?.category?.label || {};
    const renteIds = Object.keys(renteLabels);
    // Map DNB series to our loan types (heuristic — adjust if DNB changes IDs)
    const mapped = {};
    for (let i = 0; i < renteIds.length; i++) {
      const lbl = (renteLabels[renteIds[i]] || "").toLowerCase();
      const val = vals[i];
      if (val === null || val === undefined) continue;
      if (lbl.includes("fastforrentet") || lbl.includes("fast rente")) mapped.fastforrentet = val;
      else if (lbl.includes("f1") || lbl.includes("1-årig")) mapped.F1 = val;
      else if (lbl.includes("f3") || lbl.includes("3-årig")) mapped.F3 = val;
      else if (lbl.includes("f5") || lbl.includes("5-årig")) mapped.F5 = val;
      else if (lbl.includes("afdragsfri")) mapped.afdragsfri = val;
    }
    if (!mapped.fastforrentet) throw new Error("Ingen fastforrentet-rente fra DNB");
    // Fill missing with interpolation
    if (!mapped.afdragsfri) mapped.afdragsfri = mapped.fastforrentet;
    if (!mapped.F1) mapped.F1 = Math.max(1.5, mapped.fastforrentet - 1.3);
    if (!mapped.F3) mapped.F3 = Math.max(1.8, mapped.fastforrentet - 1.0);
    if (!mapped.F5) mapped.F5 = Math.max(2.0, mapped.fastforrentet - 0.75);
    _renteCache = { ...mapped, updated: new Date().toISOString(), source: "Danmarks Nationalbank" };
    _renteCacheTs = now;
    console.log("[renter] Hentet fra DNB:", JSON.stringify(mapped));
    return _renteCache;
  } catch (err) {
    console.warn("[renter] DNB fejlede, bruger fallback:", err.message);
    // Try Nordnet unofficial endpoint as second source
    try {
      const r2 = await fetch("https://www.nordnet.dk/api/2/fund-list?assetType=BOND&isinCountry=DK&currency=DKK&name=realkredit&offset=0&limit=5", {
        headers: { Accept: "application/json", "client-id": "NEXT" }, signal: AbortSignal.timeout(5000)
      });
      if (r2.ok) {
        const d2 = await r2.json();
        const bonds = d2?.results || [];
        // Very rough: find 4% coupon bond yield as proxy for fastforrentet
        const ff = bonds.find(b => b?.coupon_rate >= 3.5 && b?.coupon_rate <= 5.5);
        if (ff?.yield_to_maturity) {
          const ffRate = ff.yield_to_maturity;
          const res = { fastforrentet: ffRate, F1: Math.max(1.5, ffRate - 1.3), F3: Math.max(1.8, ffRate - 1.0), F5: Math.max(2.0, ffRate - 0.75), afdragsfri: ffRate, updated: new Date().toISOString(), source: "Nordnet estimat" };
          _renteCache = res; _renteCacheTs = now;
          return res;
        }
      }
    } catch { /* ignore */ }
    return { ...RENTE_FALLBACK, updated: new Date().toISOString() };
  }
}

app.get("/api/markedsrenter", async (_req, res) => {
  try {
    const renter = await fetchLiveRenter();
    res.set("Cache-Control", "public, max-age=3600").json(renter);
  } catch (err) {
    console.error("[renter]", err);
    res.json({ ...RENTE_FALLBACK, updated: null });
  }
});

// ─── Lån overvågning abonnement ───────────────────────────────
// Gemmer kundens låndetaljer + alert-grænser til overvågning.
// Opretter Stripe Checkout session for 49 kr/md eller 399 kr/år.
app.post("/api/laanovervagning/start", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Betaling ikke konfigureret" });
  const { email, restgaeld, rente, loebetid, laantype, alertYdelseKr, alertRestgaeldKr, periode } = req.body || {};
  if (!email || !restgaeld || !rente) return res.status(400).json({ error: "Mangler data" });

  const pris = periode === "aar" ? 39900 : 4900; // øre
  const label = periode === "aar" ? "BoligLånsRadar Overvågning — 1 år" : "BoligLånsRadar Overvågning — månedlig";
  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price_data: {
        currency: "dkk", unit_amount: pris,
        product_data: { name: label },
        ...(periode === "aar"
          ? { recurring: { interval: "year" } }
          : { recurring: { interval: "month" } })
      }, quantity: 1 }],
      customer_email: email,
      metadata: { restgaeld: String(restgaeld), rente: String(rente), loebetid: String(loebetid || 25), laantype: laantype || "fastforrentet", alertYdelseKr: String(alertYdelseKr || 2000), alertRestgaeldKr: String(alertRestgaeldKr || 200000), type: "laanovervagning" },
      success_url: `${origin}/boliglaanstjek/preview?overvagning=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/boliglaanstjek/preview?overvagning=annulleret`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("[overvagning]", err.message);
    res.status(500).json({ error: "Kunne ikke oprette betaling" });
  }
});

// ─── Bankpakke betaling ────────────────────────────────────────
// 299 kr engangsbetaling for dokumentpakke sendt til udvalgte banker.
app.post("/api/bankpakke/start", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Betaling ikke konfigureret" });
  const { email, banker, adresse } = req.body || {};
  if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(email).trim()))
    return res.status(400).json({ error: "Ugyldig e-mailadresse" });
  if (!banker || !banker.length)
    return res.status(400).json({ error: "Vælg mindst én bank" });

  const BANKPAKKE_PRICE = parseInt(process.env.BANKPAKKE_PRICE_DKK || "89");
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const bankerStr = banker.slice(0, 8).join("|");

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price_data: {
        currency: "dkk",
        product_data: {
          name: "BankPakke — Dokumentation til realkreditinstitutter",
          description: `Sendes til: ${banker.slice(0, 5).join(", ")}`,
        },
        unit_amount: BANKPAKKE_PRICE * 100,
      }, quantity: 1 }],
      customer_email: String(email).trim(),
      metadata: { type: "bankpakke", banker: bankerStr, adresse: adresse || "", email: String(email).trim() },
      success_url: `${origin}/boliglaanstjek/preview?bankpakke=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/boliglaanstjek/preview?bankpakke=annulleret`,
    });
    logEvent("bankpakke_checkout", { email: String(email).trim(), banker: bankerStr, adresse: adresse || "" });
    res.json({ url: session.url });
  } catch (err) {
    console.error("[bankpakke]", err.message);
    res.status(500).json({ error: "Kunne ikke oprette betaling" });
  }
});

// ─── BoligSelvsalg API ────────────────────────────────────────

app.post("/api/selvsalg/opret", (req, res) => {
  const { adresse, boligtype, m2bolig, byggeaar, vaerelse, navn, email, telefon, ejerBekraeftet } = req.body || {};
  if (!adresse || !boligtype || !m2bolig) return res.status(400).json({ error: "Mangler påkrævede felter" });
  if (!navn || !email || !email.includes("@")) return res.status(400).json({ error: "Ugyldig kontaktoplysning" });
  if (!ejerBekraeftet) return res.status(400).json({ error: "Ejerskab skal bekræftes" });

  const sagId = crypto.randomBytes(12).toString("hex");
  const sag = {
    sagId,
    adresse: String(adresse).trim().slice(0, 200),
    boligtype: String(boligtype).trim(),
    m2bolig: parseInt(m2bolig),
    byggeaar: byggeaar ? parseInt(byggeaar) : null,
    vaerelse: vaerelse ? parseInt(vaerelse) : null,
    navn: String(navn).trim().slice(0, 100),
    email: String(email).trim().toLowerCase().slice(0, 200),
    telefon: telefon ? String(telefon).trim().slice(0, 30) : null,
    ejerBekraeftet: true,
    betalt: false,
    oprettet: new Date().toISOString(),
  };
  SAGER[sagId] = sag;
  saveSager(SAGER);
  logEvent("selvsalg_opret", { sagId, adresse: sag.adresse, email: sag.email });
  res.json({ sagId });
});

app.get("/api/selvsalg/sag/:id", (req, res) => {
  const sag = SAGER[req.params.id];
  if (!sag) return res.status(404).json({ error: "Sag ikke fundet" });
  // Return safe subset — do not expose email to unauthenticated browser
  res.json({
    sagId: sag.sagId,
    adresse: sag.adresse,
    boligtype: sag.boligtype,
    m2bolig: sag.m2bolig,
    byggeaar: sag.byggeaar,
    vaerelse: sag.vaerelse,
    navn: sag.navn,
    betalt: sag.betalt,
    oprettet: sag.oprettet,
  });
});

app.post("/api/selvsalg/checkout", async (req, res) => {
  const { sagId } = req.body || {};
  const sag = sagId && SAGER[sagId];
  if (!sag) return res.status(400).json({ error: "Sag ikke fundet" });
  if (sag.betalt) return res.status(400).json({ error: "Salgspakken er allerede aktiveret" });
  if (!stripe) return res.status(503).json({ error: "Betaling ikke konfigureret" });

  const SELVSALG_PRICE = parseInt(process.env.SELVSALG_PRICE_DKK || "799");
  const origin = req.headers.origin || `https://${req.headers.host}`;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price_data: {
        currency: "dkk",
        product_data: {
          name: "BoligSelvsalg — Digital salgspakke",
          description: sag.adresse,
        },
        unit_amount: SELVSALG_PRICE * 100,
      }, quantity: 1 }],
      customer_email: sag.email,
      metadata: { type: "selvsalg", sagId },
      success_url: `${origin}/selvsalg/sag/${sagId}?pakke=ok`,
      cancel_url:  `${origin}/selvsalg/sag/${sagId}`,
    });
    logEvent("selvsalg_checkout", { sagId, adresse: sag.adresse });
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[selvsalg checkout]", err.message);
    res.status(500).json({ error: "Kunne ikke oprette betaling" });
  }
});

app.post("/api/notify-signup", (req, res) => {
  const { email, address, verdict } = req.body || {};
  if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(email).trim())) return res.status(400).json({ error: "Ugyldig e-mailadresse" });
  const em = String(email).trim();
  logEvent("notify_signup", { customerEmail: em, address: address || "", verdict: verdict || null });
  res.json({ ok: true });
  // Send bekræftelsesmail til fri-tilmelding (ingen betaling)
  const nextMailDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString("da-DK", { day:"numeric", month:"long" });
  const mail = buildConfirmationEmail({ email: em, adresse: address || "", nextMailDate });
  sendEmail({ to: em, ...mail }).catch(() => {});
});

// Hvor langt kommer kunden: så købeknappen, klikkede (også når kryds mangler). Kun faste hændelser.
app.post("/api/track", (req, res) => {
  const { event, verdict, blocked } = req.body || {};
  if (!["pay_shown", "buy_click"].includes(event)) return res.status(400).json({ error: "Ukendt hændelse" });
  logEvent(event, {
    verdict: ["SAG", "TÆT", "INGEN", "STÆRK", "MULIG", "USIKKER"].includes(verdict) ? verdict : null,
    ...(event === "buy_click" ? { blocked: blocked === true } : {}),
  });
  res.json({ ok: true });
});

// ─── Klage status ─────────────────────────────────────────────
app.get("/api/klage/:sessionId", (req, res) => {
  res.set("Cache-Control", "no-store");
  const sess = SESSIONS.get(req.params.sessionId);
  if (!canAccessReport(req, req.params.sessionId, sess)) return res.status(403).json({ error: "Ingen adgang til rapporten" });

  res.json({
    status:          sess.status,
    hasGrounds:      sess.hasGrounds    ?? null,
    klageTekst:      sess.klageTekst    || null,
    error:           sess.error         || null,
    estimatedMarket: sess.estimatedMarket || null,
    targetEV:        sess.targetEV      || null,
    medianSqm:       sess.medianSqm     || null,
    comps:           sess.comps         || null,
  });
});

// ─── Send klagetekst on-demand to customer-supplied e-mail ───
// POST /api/send-klage-mail  body: { sessionId, email }
app.post("/api/send-klage-mail", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { sessionId, email } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "Mangler sessionId" });
  if (typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Ugyldig e-mailadresse" });

  const sess = SESSIONS.get(sessionId);
  if (!canAccessReport(req, sessionId, sess)) return res.status(403).json({ error: "Ingen adgang til rapporten" });
  if (sess.status !== "done" || !sess.klageTekst) {
    return res.status(400).json({ error: "Klageteksten er ikke klar endnu" });
  }

  const ok = await sendKlageMail(email, sess.label || sess.address || "", sess.klageTekst, sess.hasGrounds !== false);
  if (ok) {
    logEvent("email_sent", { sessionId, email, address: sess.label || sess.address || "", hasGrounds: sess.hasGrounds });
    res.json({ ok: true });
  } else {
    res.status(502).json({ error: "E-mail kunne ikke sendes — tjek server-loggen" });
  }
});

// ─── Test: generer klagetekst uden betaling ───────────────────
// Brug: /api/test-klage?key=ADMIN_KEY&address=Din+Adresse&ev=3500000
app.get("/api/test-klage", requireAdminCookie, async (req, res) => {
  const addressQuery = (req.query.address || "").trim();
  const evOverride   = req.query.ev ? parseInt(req.query.ev) : null;

  let sessData;

  if (addressQuery.length > 3) {
    // Brug direkte indtastede værdier — spring adresseopslag over
    const m2Input  = req.query.m2  ? parseInt(req.query.m2)  : 120;
    const kvKode   = req.query.kommunekode ? String(req.query.kommunekode).padStart(4,"0") : "0657";
    const anvKode  = req.query.anvKode || "120";
    sessData = {
      status: "generating",
      address: addressQuery, label: addressQuery,
      m2: m2Input, kommunekode: kvKode, anvKode,
      boligtypeLabel: bbrAnvendelseLabel(anvKode),
      ev: evOverride || 4000000,
      gv: null,
      postnr: req.query.postnr || null,
      forhold: req.query.forhold ? String(req.query.forhold).split(",") : [],
      createdAt: Date.now(),
    };
  } else {
    // Ingen adresse → brug testdata
    sessData = {
      status: "generating",
      address: "Testvej 1, 2100 København Ø",
      label:   "Testvej 1, 2100 København Ø",
      m2: 120, kommunekode: "0101", anvKode: "120",
      boligtypeLabel: "Fritliggende enfamilieshus",
      ev: evOverride || 4500000,
      gv: null, createdAt: Date.now(),
    };
  }

  const sessionId = crypto.randomUUID();
  // Only this admin-authenticated route may bypass payment for internal tests.
  sessData.testAuthorized = true;
  grantReportAccess(req, res, sessionId, sessData);
  SESSIONS.set(sessionId, sessData);
  try {
    await generateKlage(sessionId, sessData);
    res.json({
      sessionId,
      adresse:    sessData.label,
      status:     sessData.status,
      hasGrounds: sessData.hasGrounds ?? null,
      klageTekst: sessData.klageTekst || null,
      error:      sessData.error      || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Test UI ──────────────────────────────────────────────────
app.get("/test", requireAdminCookie, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test – Vurderingstjekket</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f4f6f9;color:#1a202c;min-height:100vh}
  header{background:#1e3a5f;color:#fff;padding:20px 24px}
  header h1{font-size:1.3rem;font-weight:700}
  header p{font-size:.85rem;opacity:.75;margin-top:4px}
  .badge{display:inline-block;background:#f59e0b;color:#000;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px;vertical-align:middle}
  main{max-width:700px;margin:32px auto;padding:0 16px;display:flex;flex-direction:column;gap:24px}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:24px}
  .card h2{font-size:1rem;font-weight:700;margin-bottom:16px;color:#1e3a5f}
  label{display:block;font-size:.85rem;font-weight:600;margin-bottom:6px;color:#374151}
  input[type=text],input[type=number]{width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.95rem;outline:none;transition:border .15s}
  input:focus{border-color:#1e3a5f}
  .suggestions{border:1.5px solid #d1d5db;border-top:none;border-radius:0 0 8px 8px;background:#fff;max-height:220px;overflow-y:auto;display:none;position:absolute;width:100%;z-index:10}
  .suggestions .s-item{padding:10px 14px;cursor:pointer;font-size:.9rem;border-bottom:1px solid #f3f4f6}
  .suggestions .s-item:hover{background:#f0f4ff}
  .addr-wrap{position:relative}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .info-box{background:#f0f4ff;border-radius:8px;padding:12px 16px;font-size:.88rem;display:none}
  .info-box span{font-weight:600}
  btn,.btn{display:inline-block;padding:12px 28px;border-radius:8px;font-size:.95rem;font-weight:700;cursor:pointer;border:none;transition:background .15s}
  .btn-primary{background:#1e3a5f;color:#fff;width:100%;margin-top:16px}
  .btn-primary:hover{background:#162d4a}
  .btn-primary:disabled{background:#9ca3af;cursor:not-allowed}
  #status{display:none;margin-top:12px;padding:14px;border-radius:8px;font-size:.9rem;text-align:center}
  #status.loading{background:#eff6ff;color:#1d4ed8}
  #status.error{background:#fef2f2;color:#dc2626}
  #result{display:none}
  #result h2{font-size:1rem;font-weight:700;color:#1e3a5f;margin-bottom:12px}
  #klage-text{white-space:pre-wrap;font-family:monospace;font-size:.82rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;max-height:500px;overflow-y:auto;line-height:1.6}
  .copy-btn{margin-top:12px;padding:9px 20px;background:#059669;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.9rem}
  .copy-btn:hover{background:#047857}
  .spinner{display:inline-block;width:18px;height:18px;border:3px solid #bfdbfe;border-top-color:#1d4ed8;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<header>
  <h1>Vurderingstjekket <span class="badge">TEST</span></h1>
  <p>Fuld gennemgang uden betaling — kun til intern test</p>
</header>
<main>

<div class="card">
  <h2>1. Søg din adresse</h2>
  <label>Adresse</label>
  <div class="addr-wrap">
    <input type="text" id="addr-input" placeholder="f.eks. Ishøj Store Torv 14, 2635 Ishøj" autocomplete="off">
    <div class="suggestions" id="suggestions"></div>
  </div>
  <div class="info-box" id="bbr-box">
    BBR: <span id="bbr-type">—</span> · <span id="bbr-m2">—</span> m²
  </div>
</div>

<div class="card">
  <h2>2. Boligoplysninger</h2>
  <div class="row">
    <div>
      <label>Ejendomsværdi kr (fra skat.dk)</label>
      <input type="number" id="ev-input" placeholder="f.eks. 4100000" min="100000" step="50000">
    </div>
    <div>
      <label>Boligareal m²</label>
      <input type="number" id="m2-input" placeholder="f.eks. 130" min="20" max="1000">
    </div>
  </div>
  <div class="row" style="margin-top:8px">
    <div>
      <label>Kommunekode (4 cifre)</label>
      <input type="text" id="kv-input" placeholder="f.eks. 0657 = Ishøj" maxlength="4">
    </div>
    <div style="font-size:.8rem;color:#6b7280;padding-top:22px">
      Find kommunekode på <a href="https://danmarksadresser.dk" target="_blank">danmarksadresser.dk</a><br>
      Ishøj=0657 · Kbh=0101 · Aarhus=0751
    </div>
  </div>
  <button class="btn btn-primary" id="gen-btn" disabled onclick="generer()">Generer klagetekst</button>
  <div id="status"></div>
</div>

<div class="card" id="result">
  <h2>Klagetekst</h2>
  <div id="klage-text"></div>
  <button class="copy-btn" onclick="kopier()">Kopiér tekst</button>
</div>

</main>
<script>
const addrInput   = document.getElementById('addr-input');
const suggestBox  = document.getElementById('suggestions');
const bbrBox      = document.getElementById('bbr-box');
const bbrType     = document.getElementById('bbr-type');
const bbrM2       = document.getElementById('bbr-m2');
const evInput     = document.getElementById('ev-input');
const genBtn      = document.getElementById('gen-btn');
const statusEl    = document.getElementById('status');
const resultEl    = document.getElementById('result');
const klageEl     = document.getElementById('klage-text');

let chosen = null;

addrInput.addEventListener('input', async () => {
  const q = addrInput.value.trim();
  chosen = null; checkBtn();
  if (q.length < 3) { suggestBox.style.display='none'; return; }
  try {
    const r = await fetch('/api/adresse?q='+encodeURIComponent(q));
    const d = await r.json();
    const items = d.suggestions || [];
    if (!items.length) { suggestBox.style.display='none'; return; }
    suggestBox.innerHTML = items.map((s,i) =>
      '<div class="s-item" data-i="'+i+'" onclick="pick('+i+')">'+s.label+'</div>'
    ).join('');
    suggestBox._items = items;
    suggestBox.style.display='block';
  } catch(e) { suggestBox.style.display='none'; }
});

document.addEventListener('click', e => {
  if (!addrInput.contains(e.target) && !suggestBox.contains(e.target))
    suggestBox.style.display='none';
});

async function pick(i) {
  const item = suggestBox._items[i];
  addrInput.value = item.label;
  suggestBox.style.display='none';
  chosen = item;
  // BBR
  if (item.husnummerId) {
    try {
      const r = await fetch('/api/bbr?husnummerId='+item.husnummerId+'&kommunekode='+item.kommunekode);
      const d = await r.json();
      if (d.found) {
        bbrType.textContent = d.boligtypeLabel;
        bbrM2.textContent   = d.m2;
        bbrBox.style.display='block';
        chosen._m2 = d.m2;
      }
    } catch(e) {}
  }
  checkBtn();
}

evInput.addEventListener('input', checkBtn);
document.getElementById('m2-input').addEventListener('input', checkBtn);
document.getElementById('kv-input').addEventListener('input', checkBtn);
function checkBtn() {
  genBtn.disabled = !(addrInput.value.trim().length > 3 && evInput.value > 0);
}

async function generer() {
  genBtn.disabled = true;
  resultEl.style.display='none';
  statusEl.className='loading'; statusEl.style.display='block';
  statusEl.innerHTML='<span class="spinner"></span>Henter data og genererer klagetekst… (30-60 sek)';
  try {
    const addrStr = chosen ? chosen.label : addrInput.value.trim();
    const m2Val = document.getElementById('m2-input').value || '130';
    const kvVal = document.getElementById('kv-input').value || '0657';
    const url = '/api/test-klage?key='+encodeURIComponent(new URLSearchParams(location.search).get('key')||'')+'&address='+encodeURIComponent(addrStr)+'&ev='+evInput.value+'&m2='+m2Val+'&kommunekode='+kvVal;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    statusEl.style.display='none';
    klageEl.textContent = d.klageTekst || '(ingen tekst)';
    resultEl.style.display='block';
  } catch(e) {
    statusEl.className='error'; statusEl.textContent='Fejl: '+e.message;
  } finally {
    genBtn.disabled=false;
  }
}

function kopier() {
  navigator.clipboard.writeText(klageEl.textContent).then(() => {
    const b = document.querySelector('.copy-btn');
    b.textContent='✓ Kopieret!'; setTimeout(()=>b.textContent='Kopiér tekst',2000);
  });
}
</script>
</body>
</html>`);
});

// ─── Månedlig låneovervågning (Cron) ─────────────────────────
// Kaldes af Railway Cron Job (eller manuelt med CRON_SECRET).
// Railway Cron opsætning (én gang i Railway-dashboard):
//   Service → New → Cron Job → Command: curl -X POST https://vurderingstjekket.dk/api/cron/monthly-monitoring -H "Authorization: Bearer $CRON_SECRET"
//   Schedule: 0 8 1 * * (kl. 08:00 den 1. i hver måned)
const CRON_SECRET = process.env.CRON_SECRET;

app.post("/api/cron/monthly-monitoring", async (req, res) => {
  const auth = req.headers.authorization || "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) return res.status(403).json({ error: "Uautoriseret" });

  const renter = await fetchLiveRenter().catch(() => ({}));
  let sendt = 0, fejl = 0, alerts = 0;

  for (const ab of ABONNENTER) {
    try {
      // Hent lokalt boligmarked (Boliga API — brug eksisterende fetchComps)
      let boligData = null;
      if (ab.postnr) {
        try {
          const raw = await getSoldCompsBoliga(ab.postnr, null);
          if (raw?.length) {
            const genm2 = Math.round(raw.reduce((s, c) => s + (c.sqmPrice || 0), 0) / raw.length);
            boligData = { antalHandler: raw.length, gennemsnitmKr: genm2 };
          }
        } catch { /* ikke kritisk */ }
      }

      const mail = buildMonthlyEmail(ab, renter, boligData);

      // Tjek om alert-mail skal sendes (og om den ikke allerede er sendt denne måned)
      const alertMaanedKey = new Date().toISOString().slice(0, 7); // "2026-11"
      if (mail.goOmlæg && mail.besparelse > 0 && ab.alertSentAt?.slice(0, 7) !== alertMaanedKey) {
        const alertMail = buildAlertEmail(ab, mail.besparelse);
        const ok = await sendEmail({ to: ab.email, ...alertMail });
        if (ok) { ab.alertSentAt = new Date().toISOString(); alerts++; }
      }

      // Send månedlig mail (max én per måned)
      const sidstMaaned = ab.lastSentAt?.slice(0, 7);
      const denneMaaned = new Date().toISOString().slice(0, 7);
      if (sidstMaaned !== denneMaaned) {
        const ok = await sendEmail({ to: ab.email, subject: mail.subject, html: mail.html, text: mail.text });
        if (ok) { ab.lastSentAt = new Date().toISOString(); sendt++; }
        else fejl++;
      }
    } catch (err) {
      console.error(`[cron] Fejl for ${ab.email}:`, err.message);
      fejl++;
    }
  }

  saveAbonnenter(ABONNENTER);
  const result = { sendt, fejl, alerts, total: ABONNENTER.length };
  logEvent("monthly_monitoring_cron", result);
  console.log("[cron] Månedlig overvågning færdig:", result);
  res.json({ ok: true, ...result });
});

// ─── Health check ─────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    stripe:       !!stripe,
    apify:        !!APIFY_TOKEN,
    resend:       !!RESEND_API_KEY,
    cron:         !!CRON_SECRET,
    abonnenter:   ABONNENTER.length,
    handler:      LAST_COMPS_FETCH,
    sessions:     SESSIONS.size,
  });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vurderingstjekket v3 🏡  http://localhost:${PORT}`));
