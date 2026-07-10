# Architecture

This page is for the technically curious — an IT reviewer deciding whether referat is
trustworthy on a corporate machine. It describes how the app is built and, specifically, how
it is hardened.

## Stack

Electron + electron-vite, React 19, TypeScript (strict), Tailwind CSS v4, Zustand for
renderer state. There are **no native Node modules** — all audio capture happens in the
renderer via web APIs. Minutes export to `.docx` uses the pure-JS `docx` package.

## Process split

referat follows Electron's standard main/renderer separation.

### Main process (`src/main/`)

- Window and tray lifecycle, and IPC registration.
- **Storage** — one folder per meeting under `app.getPath('userData')/meetings/`.
- **Pipeline runner** — a queue that transcribes then summarizes, one meeting at a time,
  with status persisted to disk.
- **Provider clients** (`src/main/providers/`) — `fetch`-based clients for
  OpenAI-compatible transcription, OpenAI-compatible chat completions and Anthropic
  messages, plus a per-provider connection test.
- **Settings** — JSON in `userData`; API keys encrypted with `safeStorage`.

### Preload (`src/preload/`)

A typed `contextBridge` surface exposed as `window.api.*`. **`contextIsolation` is on and
`nodeIntegration` is off**; the renderer never gets Node or Electron internals directly.
IPC payloads are typed via `src/shared/types.ts`, shared between processes.

### Renderer (`src/renderer/`)

- **Audio capture** — microphone via `getUserMedia`; system audio via WASAPI loopback
  (`setDisplayMediaRequestHandler` with `audio: 'loopback'`). The two `MediaStream`s are
  mixed with WebAudio and recorded with `MediaRecorder` (webm/opus). Chunks are streamed to
  disk over IPC — **never buffered in memory** — and per-source level meters use
  `AnalyserNode`.
- **Views** — Home (meeting list + start), Recording, Meeting detail (Minutes / Transcript),
  Settings, and the onboarding wizard. A small Zustand-based router; no react-router.

## IPC contract

The renderer never touches the filesystem or the network directly. Everything crosses a
typed IPC boundary:

- `window.api.appendAudioChunk(meetingId, chunk, segmentIndex)` — stream one audio chunk to
  the meeting's current segment file.
- Meeting CRUD, settings get/save, provider connection tests, and export are all IPC calls.
- The pipeline pushes progress events (`pipelineProgress`) back to every open window.

API keys are a one-way street: the renderer sends a plaintext key **once** on save; the main
process encrypts it and stores ciphertext. The plaintext key is never sent back.

## Storage layout

The folder listing *is* the index — there is no database. Each meeting is one folder:

```
%APPDATA%\referat\meetings\<id>\
  meta.json         status, title, createdAt, durationSec, error
  audio.webm        first ~10-min segment
  audio-1.webm      subsequent segments (audio-2.webm, ...)
  transcript.json   language + timestamped segments + full text
  protocol.md       the finished minutes (Markdown)
```

Meeting ids are timestamp-based with a random suffix (`YYYYMMDDhhmmss-<rand>`), so they sort
chronologically. `meta.json` is written **atomically** (write a temp file, then rename) so a
crash mid-write can't truncate it and make the meeting vanish from the index.

## Recording and the pipeline

- **Segmented recording.** The recorder rotates to a fresh `MediaRecorder` every 10 minutes.
  Each segment is independently decodable and stays under provider upload caps (OpenAI
  rejects files over 25 MB). At transcription time the segments are processed in order and
  concatenated, offsetting each segment's timestamps by the cumulative duration.
- **Sequential pipeline.** A single-flight queue runs `transcribe → summarize` for one
  meeting at a time. Status transitions
  (`recording → recorded → transcribing → summarizing → done`, or `error`) are persisted to
  `meta.json` and broadcast to the interface.
- **Crash recovery.** On startup the app inspects every meeting: a meeting left in
  `recording` (app killed mid-capture) is marked `error`; `recorded`/`transcribing` are
  re-queued for the full pipeline; `summarizing` resumes at summarization if a transcript
  already exists, otherwise re-runs fully.
- **Per-step retry.** After an error, **Try again** resumes from the failed step — if the
  transcript exists it only re-summarizes.
- **Empty-answer guard.** If the summarization model returns an empty string (common with
  reasoning-heavy models that exhaust their budget "thinking"), the pipeline raises an error
  instead of saving blank minutes marked as done.

## Security hardening

Honest and specific:

- **Sandboxed renderer.** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
  The renderer runs untrusted-by-default and reaches the OS only through the typed preload
  API.
- **No in-app navigation.** The app is a single local page. Any main-frame navigation is
  cancelled (`will-navigate` is prevented), and `setWindowOpenHandler` **denies** all
  window opens.
- **External-link scheme allowlist.** Links that do open externally are routed through a
  helper that **only permits `http:`, `https:` and `mailto:`** schemes; anything else
  (`file:`, custom protocol handlers that could launch local programs) is rejected.
- **No redirect following with auth headers.** The provider `fetch` wrapper uses
  `redirect: 'manual'` and throws on any 3xx. Node's `fetch` does **not** strip custom auth
  headers (like `x-api-key`) across a redirect, so a redirecting endpoint is treated as a
  configuration error rather than silently leaking credentials to the redirect target.
- **Meeting-id validation.** Every id arriving over IPC is checked against a strict regex
  (`^[0-9]{14}-[a-z0-9]{1,12}$`) before it touches the filesystem, and segment indices are
  range-checked. This blocks path traversal into file writes and deletes.
- **Encrypted keys.** API keys are encrypted with Windows DPAPI via `safeStorage` and stored
  as base64 ciphertext. If OS encryption is unavailable, the app refuses to store the key
  rather than falling back to plaintext.

## Related pages

- **[Configuration](Configuration)** — the settings that drive the providers.
- **[Local AI Setup](Local-AI-Setup)** — a fully local deployment.
- **[FAQ](FAQ)** — privacy and data-handling questions.
