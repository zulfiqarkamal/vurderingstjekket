# Vurderingstjekket — Chrome Extension

Enkel Chrome-extension der åbner vurderingstjekket.dk-flows direkte fra browserens toolbar.

## Indhold

```
chrome-extension/
  manifest.json   — Chrome Manifest V3
  popup.html      — Popup-vindue med 3 knapper
  popup.js        — Åbner valgt side i ny fane
  icons/          — Ikoner (skal tilføjes, se nedenfor)
  README.md       — Denne fil
```

## Installation (lokal udvikling)

1. Åbn Chrome og gå til `chrome://extensions/`
2. Aktiver **Udviklertilstand** (øverst til højre)
3. Klik **Indlæs upakket**
4. Vælg mappen `chrome-extension/` fra dette repo

## Ikoner

Extensionen kræver tre PNG-ikoner i `icons/`-mappen:

| Fil           | Størrelse |
|---------------|-----------|
| `icon16.png`  | 16×16 px  |
| `icon48.png`  | 48×48 px  |
| `icon128.png` | 128×128 px |

Brug ⌂-symbolet (hus) i farven `#a8c5a0` på mørk baggrund `#1a1f1a`.

### Hurtig løsning uden designer

Du kan generere ikonerne med et online SVG→PNG-værktøj, eller brug denne SVG som udgangspunkt og eksporter i de tre størrelser:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1a1f1a"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-size="72" fill="#a8c5a0">⌂</text>
</svg>
```

## Publicering i Chrome Web Store (valgfrit)

1. Pak `chrome-extension/`-mappen som ZIP (uden README og screenshots)
2. Gå til [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Upload ZIP, udfyld beskrivelse og screenshots
4. Betaling: engangsgebyr på $5 for udviklerkonto
