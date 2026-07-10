# referat — arkitektur

## Stack

- **Electron** + **electron-vite** + **React 19** + **TypeScript** (strict).
- **Tailwind CSS v4** för styling. Inga tunga komponentbibliotek — egna komponenter
  enligt `docs/design.md`. Radix-primitives OK för dialog/dropdown/tooltip (headless).
- **Zustand** för renderer-state.
- Inga native Node-moduler (ingen node-gyp) — allt ljud sker i renderer via webb-API:er.

## Processansvar

### Main-process (`src/main/`)
- Fönster- och traylivscykel, IPC-registrering.
- **Storage**: app-datamapp (`app.getPath('userData')/meetings/`). En mapp per möte:
  `<id>/meta.json`, `<id>/audio.webm`, `<id>/transcript.json`, `<id>/protocol.md`.
  Index byggs genom att lista mappar — ingen databas.
- **Pipeline-runner**: kö som kör transkribering → sammanfattning per möte, med
  status persisterad i meta.json (`recorded | transcribing | summarizing | done | error`).
  Överlever appomstart: oavslutade jobb återupptas vid start.
- **Provider-klienter** (`src/main/providers/`): fetch-baserade klienter för
  OpenAI-kompatibel transkribering (multipart till `/v1/audio/transcriptions`),
  OpenAI-kompatibel chat completions, Anthropic messages. Gemensamt interface:
  `TranscriptionProvider { transcribe(file, opts): Promise<Transcript> }`,
  `SummaryProvider { summarize(transcript, template): Promise<string> }`.
  Även `testConnection(): Promise<{ok, message}>` per provider.
- **Settings**: JSON i userData; API-nycklar krypteras med `safeStorage` och lagras
  som base64-ciphertext. Klartextnyckel exponeras aldrig till renderer — renderer
  skickar nyckel EN gång vid spar, main krypterar.

### Preload (`src/preload/`)
Typad `contextBridge`-API-yta: `window.api.*`. contextIsolation på, nodeIntegration av.
All IPC har TypeScript-typer delade via `src/shared/types.ts`.

### Renderer (`src/renderer/`)
- **Ljudinfångst**: mikrofon via `getUserMedia`; systemljud via `desktopCapturer`
  (Electron stöder WASAPI loopback-audio på Windows via `setDisplayMediaRequestHandler`
  i main med `audio: 'loopback'`). Två `MediaStream`s mixas med WebAudio
  (`AudioContext` + `MediaStreamAudioDestinationNode`) till en ström som spelas in med
  `MediaRecorder` (webm/opus). Chunks streamas via IPC till fil (inte i minnet).
  Nivåmätare per källa via `AnalyserNode`.
- **Vyer**: Hem (mötesliste + starta), Inspelning, Mötesdetalj (Protokoll/Transkript),
  Inställningar, Onboarding-wizard. Enkel egen router (zustand-state), ingen react-router.

## Ljudformat och providers

MediaRecorder ger webm/opus. OpenAI:s transcriptions-API accepterar webm direkt.
Skicka webm som default. Chunka långa möten (>ca 20 MB) i segment vid transkribering
(spela in i segment om N minuter redan från början — förenklar och gör pipelinen robust).

## Talardiarisering ("vem sa vad")

Diarisering är en **valfri provider** vid sidan av transkriberingen, avstängd som
default. Den körs av en lokal följeslagarserver (`diarization-server/`, Python +
pyannote.audio via uv, GPU med CPU-fallback) som appen pratar med över HTTP —
samma modell som speaches/Ollama: användaren (eller IT) startar servern, appen
konfigureras med en bas-URL och en "Testa anslutning"-knapp.

- **HTTP-kontrakt**: `GET /health` (status/modell/enhet) och `POST /diarize` med
  ljudfilerna som multipart (`files`, i inspelningsordning). Servern avkodar och
  konkatenerar segmenten till en gemensam tidslinje och svarar med
  `{ turns: [{ start, end, speaker: "S1" }] }` — talaretiketter är globalt
  konsekventa över alla filer och normaliserade till `S1`, `S2`, … i
  förstagångsordning. Att skicka alla segmentfiler i EN request är det som gör
  etiketterna konsekventa; klientvis per-fil-diarisering hade gett olika
  talarrymder per fil.
- **Pipeline-steg**: `transcribing → diarizing → summarizing`. Diarisering körs
  bara när den är påslagen i inställningarna. Ett fel i steget degraderar mjukt:
  mötet får en `warning` i meta.json (klarspråk + rå detalj) och pipelinen går
  vidare till sammanfattningen — protokollet kommer alltid fram. Avbrutna
  `diarizing`-jobb återupptas vid appstart (transkript finns → kör om
  diarisering + sammanfattning).
- **Merge-logik** (`src/main/diarize.ts`, ren och enhetstestad): varje
  transkriptsegment tilldelas talaren med störst tidsöverlapp; segment utan
  överlapp faller tillbaka på närmaste tur. Transkript-typen utökas additivt:
  segment får valfritt `speaker`-id och `Transcript` får en valfri
  `speakers`-karta (id → visningsnamn, default "Talare N"). Möten utan
  diarisering är byte-identiska i beteende.
- **Namnbyten**: klick på en talaretikett i transkriptfliken byter visningsnamn;
  det persisteras i transcript.json och används i protokollmallen vid
  omsammanfattning (transkripttexten blir talarattribuerad: "Anna: …").
- **Tidslinjedrift**: transkriptets multi-fil-offsets bygger på sista
  segment-slutet per fil medan diariseringen använder verklig ljudlängd; den
  lilla driften vid filgränser hanteras av överlappsmatchningen i stället för
  exakta gränser.

## Export

- Markdown: skriv protocol.md rakt av.
- Word: generera .docx med `docx`-paketet (ren JS).
- Kopiera: klippbordet via Electron clipboard.

## Bygg & distribution

- `npm run dev` — electron-vite dev med HMR.
- `npm run build` + `electron-builder` → NSIS-installer (`release/`).
- CI senare; MVP byggs lokalt.

## Kodstandard

- Svenska i UI-strängar, engelska i kod/kommentarer/commits.
- Commits som `Lucas Skog <lucasskog@gmail.com>`, inga Co-Authored-By-trailers,
  inga AI-omnämnanden i commit-meddelanden.
- UI-strängar centraliserade i `src/renderer/src/strings.ts` (förbereder engelska).
