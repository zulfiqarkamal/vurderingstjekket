# Salgsplan — vurderingstjekket.dk

**Version:** 1.0 · Oktober 2026

---

## 1. Produktoversigt og prissætning

| Produkt | Pris | Type | Målgruppe |
|---|---|---|---|
| Ejendomsvurderingklage (AI-check) | 350 kr | Engangsbetaling | Boligejere med høj/usikker ejendomsvurdering |
| Boliglånsovervågning | 49 kr/md · 399 kr/år | Abonnement | Boligejere med variabelt lån eller høj ydelse |
| Bankpakke (hvad banken ikke fortæller dig) | 299 kr | Engangsbetaling | Boligejere med fastforrentet lån der overvejer omlægning |

**Differentiering:** Automatisk, datadrevet analyse på 30 sekunder — ingen advokatmøde, ingen ventetid. Konkurrenter kræver enten manuel rådgivning (2.000–10.000 kr) eller ingen handling overhovedet.

---

## 2. Målgruppe

**Primær:** Danske boligejere 30–60 år med:
- Nylig offentlig ejendomsvurdering fra SKAT (vurderingsstyrelsen)
- Høj restgæld (>2 mio. kr.) eller høj ydelse relativt til indkomst
- Variabelt lån (F1/F3/F5) der ikke er blevet gennemgået siden rentestigningerne 2022–2024

**Sekundær:** Førstegangskøbere og boligejere der overvejer at sælge.

**Størrelse:** Ca. 1,4 mio. parcelhuse og ejerlejligheder i DK. SKAT udsender ~400.000 nye vurderinger om året.

---

## 3. Kanaler og prioritering

### TikTok (primær vækstkanal)
- Gratis organisk reach via hooks om "hvad SKAT ikke fortæller dig"
- Kort video (30–60 sek) med skærm-demonstration af tjekket
- CTA: "Link i bio → grat is tjek på vurderingstjekket.dk"
- Bedste tidspunkter: tirsdag–torsdag 18–21

### Facebook (retargeting + lokalgrupper)
- Organisk: Del i boligejer-grupper ("Ejerlejlighed i København", "Parcelhusejere DK")
- Betalt: Retarget besøgende der ikke konverterede (Facebook Pixel på site)
- Leadsannoncer: "Tjek din ejendomsvurdering gratis" med e-mailfelt

### Email (fastholde og upsell)
- Alle der laver et gratis tjek → tilmeld til nyhedsbrev
- Månedlig mail: "Renten er faldet X% — se om det kan betale sig at omlægge"
- Upsell: Brugere med rød vurdering → opfordr til klage-pakken

### SEO (langsigtet)
- Landingssider for "ejendomsvurdering for høj", "klage over ejendomsvurdering", "boliglån omlægge"
- Gratis tjek er stærkt lead-magnet for organisk søgetrafik

---

## 4. Konverteringstragt

```
Video på TikTok/Facebook
        ↓
Klik → vurderingstjekket.dk (gratis tjek)
        ↓
Rød/Orange resultat → "Din vurdering kan være for høj"
        ↓
Køb klagepakke (350 kr) ELLER
Tilmeld boliglånsovervågning (49 kr/md)
        ↓
E-mailbekræftelse → månedlig rapport / øjeblikkelig alert
```

**Konverteringsoptimering:**
- Gratis tjek sænker barriæren maksimalt — ingen kreditkort kræves
- Resultatssiden viser tabt potentiale i kroner ("Du kan spare op til 28.000 kr")
- Exit-intent popup: "Få resultatet på e-mail" (bygger liste)

---

## 5. Content-strategi og videoformater

### Hook-typer der virker til denne niche

**Format A — Chok-tal:**
"Jeg tjekker 5 tilfældige danske boliger live... SKAT har sat 3 af dem for højt [skærm-demo]"

**Format B — "Hemmelighed"-angle:**
"Din bank ønsker IKKE at du ved dette om dit boliglån [1 minut forklaring]"

**Format C — Before/After:**
"Fra 4.200 kr/md til 3.100 kr/md — sådan ændrede vi vores lån på 2 uger"

**Format D — Nyhedshook (triggerbaseret):**
"SKAT har netop sendt nye vurderinger ud — gør DET inden fristen udløber"

### Indholdskalender (måned 1)

| Uge | TikTok/Facebook content | Trigger |
|---|---|---|
| 1 | Intro: "Hvad er vurderingstjekket?" — 60 sek demo | Lancering |
| 2 | "Jeg tjekker min nabos hus live" | Engagement-drevet |
| 3 | "3 tegn på at dit boliglån er for dyrt" | Generisk |
| 4 | Testimonial-format + social proof | Konvertering |

---

## 6. KPI-mål

### Første 30 dage
| KPI | Mål |
|---|---|
| Gratis tjek | 500 |
| Betalende kunder | 25 (5% konvertering af røde/orange) |
| Omsætning | ~10.000 kr |
| E-mail-liste | 200 tilmeldte |
| TikTok følgere | 500 |

### Første 90 dage
| KPI | Mål |
|---|---|
| Gratis tjek | 3.000 |
| Betalende kunder | 200 |
| Omsætning | ~75.000 kr |
| Abonnenter (overvågning) | 100 (4.900 kr MRR) |
| E-mail-liste | 1.500 tilmeldte |

---

## 7. Prioriterede handlinger (første uge)

1. **DNS-fix:** Sørg for at `www.vurderingstjekket.dk` peger på Railway (ikke gamle Cloudflare Worker) — KRITISK, ingen marketing virker uden dette
2. **Pixel:** Installer Facebook Pixel og Google Analytics på sitet
3. **TikTok-konto:** Opret `@vurderingstjekket` — post første video inden dag 3
4. **Exit-intent:** Tilføj popup "Få resultatet på e-mail" til alle ikke-betalende besøgende
5. **Stripe live-mode:** Skift fra test til live-mode (kræver Zulfiqars godkendelse)
6. **Første Facebook-annonce:** 200–500 kr budget mod interesse "boliglån", "ejendomsvurdering", "SKAT"

---

## 8. Gamma til videoer

[Gamma](https://gamma.app) er et AI-præsentationsværktøj der kan eksportere til video. Til Vurderingstjekket-marketing:

1. Lav en kort præsentation (5–8 slides) med nøgletal og hooks
2. Eksporter som video eller GIF til TikTok/Facebook
3. Brug til "explainer"-videoer: "Sådan virker ejendomsvurderingen"

Alternativt: Brug skærm-optagelse direkte (OBS eller TikTok's eget kamera) — det performer typisk bedst organisk fordi det virker autentisk.
