# Configuration

All settings live under **Settings** in the app. There are six groups: **Audio**,
**Transcription**, **Summarization**, **Ordlista** (glossary), **Speakers** and
**Appearance**. This page explains every field.

referat uses two independent providers: **transcription** (speech → text) and
**summarization** (text → minutes). You configure them separately, so you can mix modes —
for example transcribe locally and summarize in the cloud.

> **API keys never leave your machine in plaintext.** Keys are encrypted with Windows DPAPI
> via Electron `safeStorage` and stored as ciphertext in `%APPDATA%\referat\settings.json`.
> The plaintext key is never sent back to the app's interface, and referat refuses to store
> a key if OS encryption is unavailable rather than writing it in plaintext.

## Transcription

The service that writes out what was said. Any OpenAI-compatible
`/v1/audio/transcriptions` endpoint works.

**Fields**

- **Preset** — prefills the fields below for a known provider (see the table).
- **Base URL** — the provider's `/v1` root. referat appends `/audio/transcriptions`.
- **Model** — the transcription model name.
- **Language** — an ISO code such as `sv`. Leave empty to let the server auto-detect.
- **API key** — optional; leave empty for local servers.

**Presets**

| Preset               | Base URL                                        | Model (default)          | API key |
| -------------------- | ----------------------------------------------- | ------------------------ | ------- |
| Built-in local model | managed by referat                              | `KBLab/kb-whisper-small` | no      |
| Local server         | `http://localhost:8000/v1`                      | `KBLab/kb-whisper-large` | no      |
| OpenAI               | `https://api.openai.com/v1`                     | `whisper-1`              | yes     |
| Azure OpenAI         | `https://<resource>.openai.azure.com/openai/v1` | `whisper`                | yes     |
| Custom               | _(empty — enter your own)_                      | _(empty)_                | depends |

## Summarization

The service that turns the transcript into the actual minutes. HTTP providers support
**OpenAI-compatible** chat completions and **Anthropic** messages. The separate **Codex CLI**
preset can instead run the summarization through a locally installed Codex CLI.

**Fields**

- **Preset** — prefills the fields below.
- **API type** — `OpenAI-compatible` or `Anthropic`.
- **Base URL** — the chat endpoint root (`/chat/completions` is appended for the
  OpenAI-compatible flavor).
- **Model** — the model name.
- **API key** — optional for local servers, required for cloud providers.
- **Minutes template** (advanced) — see below.

**Presets**

| Preset       | API type          | Base URL                                        | Model (default)            | API key |
| ------------ | ----------------- | ----------------------------------------------- | -------------------------- | ------- |
| Local server | OpenAI-compatible | `http://localhost:11434/v1`                     | `llama3.1`                 | no      |
| OpenAI       | OpenAI-compatible | `https://api.openai.com/v1`                     | `gpt-4o-mini`              | yes     |
| Azure OpenAI | OpenAI-compatible | `https://<resource>.openai.azure.com/openai/v1` | `gpt-4o`                   | yes     |
| Anthropic    | Anthropic         | `https://api.anthropic.com`                     | `claude-3-5-sonnet-latest` | yes     |
| Codex CLI    | Codex CLI         | _(uses the installed CLI)_                      | _(CLI default)_            | no      |
| Custom       | OpenAI-compatible | _(empty — enter your own)_                      | _(empty)_                  | depends |

### Codex CLI preset

Choose **Codex CLI** when Codex CLI is installed and authenticated on the machine. Verify the
prerequisite in PowerShell:

```powershell
codex login status
codex exec --ephemeral --skip-git-repo-check "Svara endast OK"
```

referat sends the rendered minutes prompt through stdin and reads only the final message from
stdout. Each run is ephemeral and uses an empty temporary working directory. User config,
rules, shell commands, apps, plugins, web search and local Codex history are disabled for the
run. The temporary directory is removed afterwards. The CLI still sends the prompt and
transcript onward under its own login, subject to that account's policies and usage limits.

No API key is stored by referat for this preset. Keys previously saved for HTTP presets remain
encrypted so switching provider does not erase them, but they are never sent to Codex. Use
**Test Codex** in Settings to perform a small authenticated end-to-end request.

**If the test reports that the CLI was not found** while `codex` works in your terminal, the
app was started with an environment that does not carry the Codex directory on `PATH` — a
shortcut or launcher created before the install, for instance. referat therefore also looks in
the standard install locations (`%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, `~/.codex/bin`, the
global npm directory, and Homebrew on macOS). The error detail lists every location tried. For
an install outside those, set `REFERAT_CODEX_PATH` to the full path of the executable.

### Azure OpenAI specifics

referat targets Azure's **OpenAI-compatible v1 endpoint**, whose base URL is shaped:

```
https://<resource>.openai.azure.com/openai/v1
```

Replace `<resource>` with your Azure OpenAI resource name. Enter your Azure key in the API
key field. referat sends the key both as an `Authorization: Bearer` header and as an
`api-key` header, so it works whether the endpoint expects the OpenAI or the Azure header
shape. Use your **deployment name** as the model.

### Anthropic flavor

With **API type: Anthropic**, referat posts to `<base>/v1/messages` using the `x-api-key`
header and `anthropic-version: 2023-06-01`. If your base URL already ends in `/v1`, referat
strips it so the path doesn't become `/v1/v1/messages`. Leave the base URL as
`https://api.anthropic.com` unless you use a proxy.

### The minutes template

The **minutes template** (under _Advanced_) is the prompt that shapes the output. It
contains a **`{{transcript}}`** placeholder, which referat replaces with the meeting
transcript before sending. (If you remove the placeholder, the transcript is appended to the
end of your prompt instead.)

A second placeholder, **`{{ordlista}}`**, is replaced with your [glossary](#glossary) — the
correct spellings, so the model does not turn an unfamiliar product name back into a word it
recognizes. It resolves to nothing when the glossary is empty. If your template does not use
it, the block is placed ahead of the template instead.

The default template is in Swedish and asks the model for four sections — **Sammanfattning**
(summary), **Beslut** (decisions), **Actionpunkter** (action items with owner and deadline)
and **Öppna frågor** (open questions) — and instructs it to answer in the transcript's
language and to use only information present in the transcript. Edit it freely to change the
structure, language or tone; the default works without any changes.

> **Tip:** prefer a non-reasoning model. Reasoning-heavy models can return an empty answer,
> which referat surfaces as an error instead of saving empty minutes. See
> [Local AI Setup](Local-AI-Setup).

## Glossary

Speech recognition mangles technical vocabulary, product names and workplace-specific words,
and Swedish models do it more often because many of these terms are not Swedish words at all.
The glossary maps every misheard form back to one correct spelling.

**Filling it.** Open a meeting's **Transkript** tab, select the word that came out wrong, and
choose **Lägg till i ordlistan**. The selection is prefilled as the misheard form; you type
the correct spelling, or pick a term you already have. The transcript is corrected on the
spot, and the banner offers to rebuild the minutes with the corrected text.

**One term, several variants.** The same word comes out differently depending on who is
speaking, so a term holds a list of forms — all of them map to the one correct spelling. Add
variants as you meet them; the list is global and applies to every meeting, past and future.

**Matching** is literal, not fuzzy: only the forms you entered, case-insensitively, and
tolerant of the word splits the transcriber introduces (`kubber nätes` also catches
`kubber-nätes`). A term never matches inside a longer word. Fuzzy matching is deliberately
absent — a wrong correction in the minutes is worse than a missed one.

**Corrections are reversible.** referat keeps what the provider actually returned and
re-derives the corrected text from it, so every apply starts from the original. Removing a
term un-corrects the transcript on the next run; corrected words carry a dotted underline in
the transcript so a correction is visible rather than silent.

**Editing the list.** **Settings → Ordlista** lists every term. Open one to fix the spelling,
add or remove variants (one per line), or delete the term. The glossary lives in
`%APPDATA%\referat\glossary.json`.

## Speakers

Optional speaker identification ("who said what") — transcript segments are labelled
**Talare 1**, **Talare 2**, … and the labels can be renamed; the names flow into the minutes
when the protocol is regenerated. Off by default. Install the managed CPU or NVIDIA component
in Settings, or use an external companion server. The managed component asks you to accept the
Pyannote model conditions and paste a read-enabled Hugging Face token; the token is encrypted
with Windows DPAPI. See
[Speaker Diarization](Speaker-Diarization) for the full setup. In the app's Swedish UI the
group is called **Talare**.

**Fields**

- **Identify speakers** (_Identifiera talare_) — the on/off toggle. When off, meetings are
  processed exactly as before.
- **Run speaker identification** — choose the managed component or an external server.
- **Server address** (_Serveradress_) — the external diarization server's address. Default
  `http://localhost:8300`.
- **Test connection** (_Testa anslutning_) — checks the server's `/health` endpoint; a
  network error means the address is wrong or the server isn't running.
- **Recognize speakers across meetings** (_Känn igen talare mellan möten_) — optional
  sub-toggle, off by default; only shown when speaker identification is on. When on,
  renaming a speaker saves a local voiceprint, and in later meetings a matching voice is
  suggested with a question mark ("Anna?") for you to confirm or dismiss. Voiceprints are
  biometric data and everything is stored locally — see
  [Speaker Diarization](Speaker-Diarization) for details, data locations and the GDPR
  notes.
- **Saved voices** (_Sparade röster_) — the list of saved voice profiles, shown when
  recognition is on. Each entry has a **"Glöm rösten"** button that removes that voice;
  **"Glöm alla röster"** removes all of them (with a confirmation — it can't be undone).
  Names already written in transcripts are unaffected.

A diarization failure never blocks the minutes: the meeting gets a warning note and the
protocol is still produced, just without speaker labels.

## Audio

- **Microphone** — which input device is recorded.
- **Record system audio** — capture what plays on the computer (for example other people in
  a video call). This is what lets referat work with Teams, Zoom and Meet without a bot. On
  when possible; if system audio can't be captured, referat records the microphone only and
  tells you.

## Appearance

- **Theme** — `Follow the system`, `Light` or `Dark`.

## Re-running onboarding

**Settings** includes an option to run the setup guide again, which re-walks the provider
choice, connection test and microphone test.

## Related pages

- **[Local AI Setup](Local-AI-Setup)** — concrete local values and the Docker command.
- **[Speaker Diarization](Speaker-Diarization)** — the optional speaker server in detail.
- **[Architecture](Architecture)** — how keys and settings are stored.
- **[FAQ](FAQ)** — common questions.
