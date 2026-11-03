# Juridisk QA af Vurderingstjekket — 3. november 2026

## Konklusion og beslutningsgrænse

Gennemgangen omfatter de tre faktisk implementerede produkter, markedsføring, beregnings- og leveringsflow, checkout, mails og persondataflow i GitHub-projektet `zulfiqarkamal/vurderingstjekket`. Udgangspunkt: main efter PR96, b6f8ba363e7f7767a94cc5a8213bc1d666bf7540. Rettelser på `codex/legal-review`.

Der er fundet og rettet konkrete misvisende formuleringer. En generel disclaimer gør ikke en faktisk reguleret aktivitet tilladelsesfri. Gennemgangen er en dokumenteret risikovurdering, ikke en advokatudtalelse eller myndighedsgodkendelse.

**Funktionerne er bevaret:** beregnere, navngiven udbydersammenligning, bankpakke, personlige beregninger, månedsovervågning, betaling og eksisterende adgang. Ingen livebetalinger eller abonnementer er pauset eller ændret. Det er ejerens udtrykkelige ønske. Det betyder ikke, at nye salg hermed er juridisk godkendt.

## Dækning og evidens

| Produkt / grænse | Status | Omfang / begrænsning |
|---|---|---|
| Forside og alle public HTML-sider | INSPECTED | Faktiske budskaber, priser, fodnoter og produktløfter |
| BoligLånsRadar, reference- og udbydersammenligning | INSPECTED + MOCKED | Kode og eksisterende sikre regressionstests; ingen personlig bankrådgivning eller kreditgodkendelse udført |
| Bankpakke, PDF, budget og månedlige mails | INSPECTED + MOCKED | Beregnede og personaliserede outputs; ingen nye kundemails sendt i denne gennemgang |
| EV gratisberegning og betalt klageudkast | INSPECTED + MOCKED | Historisk 2022-grundlag, køb/adgang og udkast; myndighedens afgørelse er ikke prøvet |
| Selvsalg, gratis kladde og købt materiale | INSPECTED + MOCKED | Annonce-/brochureudkast, dokumentkort, lokal billedbehandling og adgang |
| Lokal regression og footer-/informationsside | EXECUTED | Se verificeringsafsnit nedenfor; softwaretest er ikke juridisk godkendelse |
| Faktisk Stripe-indhold/fortrydelsesbehandling og eksterne leverandøraftaler | NOT TESTED | Ingen betaling, refundering, credentials eller kontraktaccept udført |
| n8n-workflows | NOT TESTED | Læsesøgning blev afvist med HTTP429; der kan ikke udledes noget om eksisterende workflows |
| Eventuel ekstern legacy Cloudflare Worker | NOT TESTED | Ikke en del af den inspicerede kode; kun reference-test findes i repo |
| Finanstilsynets/Forbrugerombudsmandens klassifikation | NOT TESTED | Ingen myndighed eller ekstern jurist er kontaktet |

## Rettet i denne ændring

- Ny `/vigtig-information` med forklaring af beregningsgrundlag, kilde-/prognoseusikkerhed, bankens kreditgodkendelse, EV-/selvsalgsgrænser og ufravigelige rettigheder. Link nederst på alle offentlige produktsider, kontosiden og relevante mails. Siden er produktinformation, ikke fulde handelsvilkår eller privatlivspolitik.
- Fjernet synlige personlige handlingsråd som PERSONLIG ANBEFALING, prioritér at nedbringe til80%, vent på større rentestigninger og sikre udsagn om hvornår omlægning betaler sig. Beregninger og muligheder er bevaret.
- Rettet udsagnet om, at banker kontakter kunden inden2–3hverdage. Bankpakken leveres til kunden, der selv kontakter banken.
- Rettet generelle påstande om obligatorisk elrapport og lovpligtig tilstandsrapport. Huseftersynsordningen beskrives som frivillig med betingelser; eksterne fagydelser indgår ikke i pakken. Rettet henvisning til Sikkerhedsstyrelsen og fjernet ubekræftet fordeling af advokatudgifter.
- Fjernet uunderbygget 'inkl.moms'-mærkning ved selvsalg; samme samlede199kr-pris bevares. Momsstatus skal afklares før fakturering.
- Rettet absolutte løfter om ingen tredjepartsbehandling. Uploadfeltet oplyser om Anthropic-billedanalyse og mulighed for manuel indtastning; produktinformationen beskriver Stripe og Resend. Det erstatter ikke en fuld GDPR-oplysningspligt.
- EV-siden viser nu, at analysen bruger1.januar2022/historiske handler; ingen blanketklagevejledning for foreløbige/indekserede2024-vurderinger. Frist henviser til den konkrete afgørelse. Beregningsmotorens historiske sammenligninger er ikke udskiftet med dagens markedspriser.
- Gratis EV-mail brugte fejlagtigt velkomstmailen til betalt BoligLånsRadar uden at oprette abonnement. Registreringen bevares og har nu sin egen kvittering med linket; succes vises kun ved bekræftet mailafsendelse. Formuleringen lover ikke adgang til kundens Digital Post eller automatisk personlig vurderingsovervågning. Et evt. eksternt EV-notifikationsflow er ikke verificeret.

## Åbne forhold før juridisk/commerciel godkendelse

### 1. Klassifikation af boligkreditaktiviteten — høj prioritet

Den faktiske funktion bruger kundens restgæld, boligværdi, løbetid og eksisterende lån til at sammenligne og sortere navngivne udbyderprodukter, udarbejde bankforberedelse og sende mulighedsbeskeder. At kunden selv kontakter banken udelukker ikke enhver form for boligkreditformidling eller rådgivning.

Relevante kodeområder: `mortgage-market-comparison.js` funktionen `compareMortgageMarket` (inputs, rangering og beregnet personligt resultat), `mortgage-monitoring.js` `buildMonitoringEvents`, `bank-package.js` `buildCustomerBankPackage`, og køb/levering i `server.js`.

[LBK1537 af18.11.2025](https://www.retsinformation.dk/eli/lta/2025/1537/pdf), §§2–3, og [Finanstilsynets vejledning](https://www.finanstilsynet.dk/ansoeg-og-indberet/ansoegningsskemaer/ansoegning-boligkreditformidler) skal anvendes på de faktiske aktiviteter. Den tidligere generelle tilladelse som finansiel rådgiver er afskaffet; det fritager ikke automatisk boligkreditaktivitet. Senere ændringer: [LOV1638/2025 §12](https://www.retsinformation.dk/eli/lta/2025/1638/pdf) og [LOV764/2026 §10](https://www.retsinformation.dk/eli/lta/2026/764/pdf). Hvis virksomheden omfattes, er [BEK1443/2025 om god skik for boligkredit](https://www.retsinformation.dk/eli/lta/2025/1443/pdf), bl.a.§§12 og16, relevante. De skal ikke uden klassifikation påstås gældende for enhver beregner.

**Afklaring:** Forelæg den faktiske løsning for Finanstilsynet eller en jurist med boligkreditkompetence. Målet er at bevare funktionerne og afklare, om struktur, tilladelse eller andre krav er nødvendige. Ordændringer alene er ikke et svar.

### 2. EV-klageudkast som juridisk ydelse — høj prioritet

Betalt analyse genererer konkrete klageargumenter/udkast i `server.js` `generateKlage`. Hvis ydelsen overvejende har juridisk karakter, kan regler om erhvervsmæssig juridisk rådgivning gælde, selv om teksten er AI-genereret og kunden indsender selv. [Forbrugerombudsmandens vejledning](https://forbrugerombudsmanden.dk/alle-emner/andre-brancher/juridisk-raadgivning) og [BEK1720/2023](https://www.retsinformation.dk/eli/lta/2023/1720) beskriver bl.a. aftale, uddannelse, honorar og særskilte forsikringsoplysninger.

**Afklaring:** Klassificér det faktiske betalte produkt; offentliggør ikke en opdigtet forsikrings-/rådgiverstatus. Analysen er fortsat2022-specifik; serveren har ikke et generelt vurderingsårsvalg. [Skatteankestyrelsen](https://skatteankestyrelsen.dk/ejendomsvurdering/ejerbolig) beskriver bl.a.2024-indeksering og klagemuligheder. Klagefrist og gebyr skal følge kundens afgørelse.

### 3. Sælger, handelsvilkår og fortrydelse — høj prioritet

Ejer har endnu ikke bekræftet juridisk sælgernavn, offentlig adresse og kundeservice-mail. Et domænenavn erstatter ikke sælgeridentitet. CVR skal oplyses, hvis registreret; fravær af CVR afgør ikke alene retten til at drive virksomhed. [Forbrugerombudsmanden om e-handelsloven](https://forbrugerombudsmanden.dk/alle-emner/anden-lovgivning/e-handelsloven).

De fire betalingsflows i `server.js` — `/api/create-payment`, `/api/laanovervagning/start`, `/api/bankpakke/start` og `/api/selvsalg/checkout` — er bevaret. Købsoplysninger, versionerede vilkår, bekræftelse på varigt medium og produktspecifik fortrydelses-/leveringshåndtering er ikke færdiggjort. Dette er et åbent forhold, ikke løst af informationssiden.

Onlinefortrydelse er ikke samme funktion som `/afmeld`, der stopper fremtidig abonnementsfornyelse gennem Stripe. Den nye§20a gælder fra19.juni2026 efter [LOV723/2025](https://www.retsinformation.dk/eli/lta/2025/723/pdf); se også [vedtagne L185](https://www.ft.dk/samling/20241/lovforslag/L185/index.htm). Der skal efter anvendelsesområdet være en tydelig funktion til at fortryde online med bekræftelse og varig kvittering.

En engangspakke og et løbende abonnement må ikke få samme blanketregel om ingen refundering. Undtagelser for digitalt indhold kræver relevante forudgående samtykker/erkendelser og bekræftelse. En tjeneste er ikke fuldt leveret, fordi første abonnementsmail er sendt. Reklamations-/mangelrettigheder bortfalder ikke ved en disclaimer. [Forbrug.dk](https://forbrug.dk/regler/opslagsvaerk-forbrugerleksikon/forbrugeraftaleloven), [Forbrugerombudsmandens Net-tjek](https://forbrugerombudsmanden.dk/media/18319/nettjek.pdf).

**Næste arbejde:** Med faktisk sælgeridentitet og afklaret produktkategori færdiggøres købsvilkår, elektronisk fortrydelse, kundekvittering og supportproces. Der er ikke indført en ny betalingspause eller en automatisk ansvarsfraskrivelse i denne ændring.

### 4. Personoplysninger og leverandører — høj prioritet

Anthropic modtager lånebilleder til aflæsning; Stripe modtager betalings- og abonnementsmetadata, herunder bolig-/lånetal; Resend leverer mails. Lokale dokumentlister/brochurebilleder og serveruploads er forskellige flows. Databehandleraftaler, overførselsgrundlag, slettefrister, adgang/rettighedsproces og komplet oplysning om dataansvarlig er ikke dokumenteret i gennemgangen.

[Datatilsynets vejledning om registreredes rettigheder](https://www.datatilsynet.dk/Media/C/0/Registreredes%20rettigheder.pdf) og GDPR kræver en korrekt oplysningspligt. Samtykke er ikke automatisk behandlingsgrundlag for enhver databehandler. Der må ikke opfindes generelle slettefrister eller et grundlag, der ikke passer til driften. Cookie-/local-storage-formål skal kortlægges; en blanketbanner er ikke i sig selv bevis på samtykke eller nødvendighed.

### 5. Markedsføring, moms og selvsalg — fortsat kontrol

Rettede budskaber skal holdes ens på landingssider, checkout, mails/PDF og evt. eksterne workflows. [Forbrugerombudsmanden om vildledning](https://forbrugerombudsmanden.dk/alle-emner/forbud-mod-vildledning). Momsregistrering/fakturaindhold skal afklares: [SKATs fakturavejledning](https://info.skat.dk/data.aspx?oid=2068787), [SKAT om PMV](https://skat.dk/erhverv/egen-virksomhed/er-en-personligt-ejet-mindre-virksomhed-noget-for-dig). PMV-omsætning vurderes pr.kalenderår, ikke automatisk rullende12måneder.

Selvsalgsproduktets faktiske rolle er digitale udkast og kundens eget salgsarbejde. Ikke fundet køberformidling/forhandling på kundens vegne; sådan udvidelse skal vurderes igen. Huseftersynsordningen: [Forbrug.dk](https://forbrug.dk/emner/penge-og-forsikring/forsikring/ejerskifteforsikring-hvad-daekker-den), [Boligejer.dk](https://boligejer.dk/4-huseftersynsordningen-selvsalg). Myndighedskrav til energimærke, skat og afgifter skal kontrolleres i den konkrete sag, ikke erstattes af en fast pris-/kravliste.

## Klar beskrivelse til myndighed/jurist — ikke afsendt

Vi driver et dansk digitalt boligværktøj. BoligLånsRadar modtager kundens oplyste boligværdi/markedsestimat, restgæld, rente, ydelse, løbetid og lånetype. Det viser modelscenarier og sammenligner offentligt tilgængelige priser fra navngivne långivere på ensartede antagelser. Produkter sorteres efter beregnede nøgletal. Kunden kan købe en bankforberedelsespakke med beregninger, budget og spørgsmål eller løbende månedlige status-/mulighedsmails. Priserne er99kr for pakken,49kr/md eller399kr/år for overvågning. Der er ikke fundet långiverprovision i det inspicerede flow; eventuelle andre aftaler skal oplyses af ejer. Vi indsender ikke låneansøgninger, kontakter ikke banken og indgår ikke låneaftaler på kundens vegne.

**Spørgsmål:** Kan kundespecifik udbydersammenligning/sortering, bankforberedelse og mulighedsalarmer udgøre rådgivning, præsentation eller andet forberedende arbejde om boligkredit efter§§2–3, selv om kunden selv indhenter tilbud? Hvilke krav gælder, hvis hele denne funktionalitet bevares? Vedlæg eksempler på faktiske skærme, mails og beregningsforudsætninger; undlad private kundedata. For EV-produktet stilles særskilt spørgsmål om automatiske, betalte individuelle klageudkast og regler om juridisk rådgivning.

Intet er sendt til myndigheder eller andre eksterne modtagere.

## Genbrugelig legal-agent

Installeret personlig agent `legal-qa` og skill `$legal-qa` i ejerens Codex-profil. Agenten undersøger aktuel jurisdiktion, faktisk funktionalitet, markedsføring, køb, data og leverancer med primærkilder og datomæssig kontrol. Den kan genbruges på andre projekter og udsteder ikke automatiske lovligheds-/tilladelsesfrihedsgarantier. Den kører kun ved brug; der er ikke oprettet en betalt planlagt rutine.

TOML og skillstruktur er kontrolleret. Det medfølgende Python-valideringsværktøj mangler lokalt PyYAML og kunne derfor ikke gennemføres; ingen pakke er installeret. Skillen blev efter oprettelse synlig i værtsmiljøet. En uafhængig agent anvendte den på en realistisk launch-anmodning og fandt både boligkreditklassifikation, sælgerproblemet og2026-fortrydelsesændringen; ingen væsentlig instruktionsmangel fundet.

## Verificering

- Sikre lokale regressionstests:333 i alt,324bestået,0fejl,9eksisterende skips. Stripe/provider/mail-grænser simuleres; ingen rigtige køb eller kundemails i denne gennemgang.
- Ny EV-mailregression sikrer korrekt produktbesked, escaping af adresse, ingen fejlagtig betalt lånetilmelding eller falsk afmeldingsplaceholder, og fejl ved mislykket maillevering.
- Eksisterende beregnings-, betalings-, adgangs-, selvsalgs-, PDF-, forecast-, rate-limit- og overvågningstests er bevaret.
- Lokal HTML-visning, linkdækning og produktindhold kontrolleres før publicering. Browservisning afklarer ikke regulatorisk klassifikation eller fulde forbrugerrettigheder.

## Sporbare kodehenvisninger efter rettelser

| Fil og linje | Funktion / kontrolleret punkt |
|---|---|
| `mortgage-market-comparison.js:116` | `export function compareMortgageMarket` |
| `mortgage-monitoring.js:68` | `export function buildMonitoringEvents` |
| `bank-package.js:23` | `export function buildCustomerBankPackage` |
| `server.js:1438` | `app.post("/api/create-payment"` |
| `server.js:2284` | `app.post("/api/bankpakke/start"` |
| `server.js:2366` | `app.post("/api/selvsalg/checkout"` |
| `server.js:1936` | `async function generateKlage` |
| `server.js:2129` | `app.post("/api/analyze-screenshot"` |
| `server.js:2400` | `app.post("/api/notify-signup"` |
| `public/ejendomsvurdering.html:267` | `Vurderingsår:</strong>` |
| `public/selvsalg-sag.html:231` | `Ikke generelt obligatorisk ved boligsalg` |
| `public/index.html:141` | `Nødvendige oplysninger behandles` |
| `public/boliglaanstjek-preview.html:2233` | `⊙ ILLUSTRATIV BEREGNING` |
