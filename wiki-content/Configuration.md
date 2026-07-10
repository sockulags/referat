# Configuration

All settings live under **Settings** in the app. There are five groups: **Audio**,
**Transcription**, **Summarization**, **Speakers** and **Appearance**. This page explains
every field.

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

| Preset       | Base URL                                   | Model (default)          | API key |
| ------------ | ------------------------------------------ | ------------------------ | ------- |
| Local server | `http://localhost:8000/v1`                 | `KBLab/kb-whisper-large` | no      |
| OpenAI       | `https://api.openai.com/v1`                | `whisper-1`              | yes     |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/v1` | `whisper`           | yes     |
| Custom       | *(empty — enter your own)*                 | *(empty)*                | depends |

## Summarization

The service that turns the transcript into the actual minutes. Two API flavors are
supported: **OpenAI-compatible** chat completions and **Anthropic** messages.

**Fields**

- **Preset** — prefills the fields below.
- **API type** — `OpenAI-compatible` or `Anthropic`.
- **Base URL** — the chat endpoint root (`/chat/completions` is appended for the
  OpenAI-compatible flavor).
- **Model** — the model name.
- **API key** — optional for local servers, required for cloud providers.
- **Minutes template** (advanced) — see below.

**Presets**

| Preset       | API type          | Base URL                                        | Model (default)             | API key |
| ------------ | ----------------- | ----------------------------------------------- | --------------------------- | ------- |
| Local server | OpenAI-compatible | `http://localhost:11434/v1`                     | `llama3.1`                  | no      |
| OpenAI       | OpenAI-compatible | `https://api.openai.com/v1`                     | `gpt-4o-mini`               | yes     |
| Azure OpenAI | OpenAI-compatible | `https://<resource>.openai.azure.com/openai/v1` | `gpt-4o`                    | yes     |
| Anthropic    | Anthropic         | `https://api.anthropic.com`                     | `claude-3-5-sonnet-latest`  | yes     |
| Custom       | OpenAI-compatible | *(empty — enter your own)*                      | *(empty)*                   | depends |

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

The **minutes template** (under *Advanced*) is the prompt that shapes the output. It
contains a **`{{transcript}}`** placeholder, which referat replaces with the meeting
transcript before sending. (If you remove the placeholder, the transcript is appended to the
end of your prompt instead.)

The default template is in Swedish and asks the model for four sections — **Sammanfattning**
(summary), **Beslut** (decisions), **Actionpunkter** (action items with owner and deadline)
and **Öppna frågor** (open questions) — and instructs it to answer in the transcript's
language and to use only information present in the transcript. Edit it freely to change the
structure, language or tone; the default works without any changes.

> **Tip:** prefer a non-reasoning model. Reasoning-heavy models can return an empty answer,
> which referat surfaces as an error instead of saving empty minutes. See
> [Local AI Setup](Local-AI-Setup).

## Speakers

Optional speaker identification ("who said what") — transcript segments are labelled
**Talare 1**, **Talare 2**, … and the labels can be renamed; the names flow into the minutes
when the protocol is regenerated. Off by default. Requires the local companion server — see
[Speaker Diarization](Speaker-Diarization) for the full setup. In the app's Swedish UI the
group is called **Talare**.

**Fields**

- **Identify speakers** (*Identifiera talare*) — the on/off toggle. When off, meetings are
  processed exactly as before.
- **Server address** (*Serveradress*) — the diarization server's address. Default
  `http://localhost:8300`.
- **Test connection** (*Testa anslutning*) — checks the server's `/health` endpoint; a
  network error means the address is wrong or the server isn't running.
- **Recognize speakers across meetings** (*Känn igen talare mellan möten*) — optional
  sub-toggle, off by default; only shown when speaker identification is on. When on,
  renaming a speaker saves a local voiceprint, and in later meetings a matching voice is
  suggested with a question mark ("Anna?") for you to confirm or dismiss. Voiceprints are
  biometric data and everything is stored locally — see
  [Speaker Diarization](Speaker-Diarization) for details, data locations and the GDPR
  notes.
- **Saved voices** (*Sparade röster*) — the list of saved voice profiles, shown when
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
