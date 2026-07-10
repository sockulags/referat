# referat

> Mötesanteckningar som stannar hos dig.

Windows-desktopapp som spelar in möten (systemljud + mikrofon), transkriberar och
skriver ett färdigt mötesprotokoll — sammanfattning, beslut och actionpunkter.
Du väljer själv var AI:n kör: lokalt på datorn, på företagets server eller hos en
molnleverantör. Ingenting lämnar datorn utan att du valt det.

## Funktioner

- **En knapp**: starta inspelning, få ett färdigt protokoll när mötet är slut.
- **Systemljud + mikrofon**: fungerar med Teams, Zoom, Meet — utan bot i mötet.
- **Valfri AI-backend**: OpenAI-kompatibla endpoints (lokal server, intern server,
  OpenAI, Azure OpenAI) för transkribering; OpenAI-kompatibelt eller Anthropic för
  sammanfattning.
- **Lokalt först**: inspelningar och protokoll lagras på din dator. API-nycklar
  krypteras med Windows DPAPI (Electron safeStorage).
- **Export**: Markdown, Word (.docx) eller kopiera direkt.

## Utveckling

```bash
npm install
npm run dev        # utvecklingsläge med HMR
npm run typecheck  # typkontroll (node + web)
npm run lint
npm run build:win  # Windows-installer (NSIS) till release/
```

Stack: Electron + electron-vite, React 19, TypeScript, Tailwind CSS v4, Zustand.

Dokumentation: [produktspec](docs/produkt.md) · [arkitektur](docs/arkitektur.md) ·
[designbrief](docs/design.md)

Landningssidan ligger i [`site/`](site/) — statisk, deploybar till GitHub Pages.

## Licens

MIT © Lucas Skog
