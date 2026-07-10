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

## Lokal AI

Vill du att allt ska stanna på din dator kör du både transkribering och
sammanfattning mot lokala, OpenAI-kompatibla servrar. referat pratar med dem över
vanliga `/v1`-endpoints — du behöver alltså två tjänster igång innan du väljer
**På den här datorn** i appen.

### 1. Transkribering (tal → text)

Enklast är [speaches](https://github.com/speaches-ai/speaches) (tidigare
faster-whisper-server) — en OpenAI-kompatibel Whisper-server som kan köra den
svenska [KB-Whisper](https://huggingface.co/KBLab)-modellen. Med Docker:

```bash
docker run --rm -p 8000:8000 ghcr.io/speaches-ai/speaches:latest
```

Servern svarar då på `http://localhost:8000/v1`. Vilken som helst annan
OpenAI-kompatibel Whisper-server fungerar lika bra. I appens inställningar:

- **Bas-URL**: `http://localhost:8000/v1`
- **Modell**: t.ex. `KBLab/kb-whisper-large` (eller den modell din server laddat)
- **Språk**: `sv`

### 2. Sammanfattning (text → protokoll)

Kör en språkmodell lokalt med [Ollama](https://ollama.com):

```bash
ollama pull llama3.1
ollama serve
```

Ollama exponerar ett OpenAI-kompatibelt API på `http://localhost:11434/v1`. I
appens inställningar:

- **API-typ**: OpenAI-kompatibel
- **Bas-URL**: `http://localhost:11434/v1`
- **Modell**: `llama3.1` (eller valfri modell du hämtat)

API-nyckel behövs inte för lokala servrar — lämna fältet tomt. När båda tjänsterna
svarar visar anslutningstestet i appen två gröna bockar.

## Licens

MIT © Lucas Skog
