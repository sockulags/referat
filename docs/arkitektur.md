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
