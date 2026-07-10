# Local AI Setup

This guide sets up referat so **nothing leaves your machine**. You run two local,
OpenAI-compatible services — one for transcription, one for the minutes — and point the app
at them. referat talks to both over standard `/v1` endpoints.

You need two services running before you choose **On this computer** in the app:

1. A transcription server (speech → text).
2. A language model server (text → minutes).

## 1. Transcription with speaches + KB-Whisper

[speaches](https://github.com/speaches-ai/speaches) (formerly faster-whisper-server) is an
OpenAI-compatible Whisper server. It can run the Swedish
[KB-Whisper](https://huggingface.co/KBLab) models, which are tuned for Swedish speech.

Run it with Docker:

```bash
docker run --rm -p 8000:8000 ghcr.io/speaches-ai/speaches:latest
```

The server then answers on `http://localhost:8000/v1`. Any other OpenAI-compatible Whisper
server works just as well.

In **Settings → Transcription**, choose the **Local server** preset and set:

| Field    | Value                                            |
| -------- | ------------------------------------------------ |
| Base URL | `http://localhost:8000/v1`                       |
| Model    | `KBLab/kb-whisper-large` (or the model you load) |
| Language | `sv` for Swedish (leave empty to auto-detect)    |
| API key  | leave empty — not needed for local servers       |

The first transcription pulls the model, which can take a while; later runs are fast.
For a non-Swedish meeting, use a general Whisper model (e.g. `Systran/faster-whisper-large-v3`)
and set the language accordingly, or leave it empty for auto-detection.

## 2. Minutes with Ollama

[Ollama](https://ollama.com) runs a language model locally and exposes an OpenAI-compatible
API. Pull a model and start the server:

```bash
ollama pull llama3.1
ollama serve
```

Ollama listens on `http://localhost:11434/v1`.

In **Settings → Summarization**, choose the **Local server** preset and set:

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| API type | OpenAI-compatible                            |
| Base URL | `http://localhost:11434/v1`                  |
| Model    | `llama3.1` (or another model you pulled)     |
| API key  | leave empty                                  |

### Choose a non-reasoning model

Prefer a straightforward instruction-following model such as **llama3.1** or a **gemma**
variant. Reasoning-heavy models can spend their whole context budget "thinking" and return
an **empty answer**. referat detects an empty response and surfaces it as an error —
*"The model returned an empty answer. Try a different model in settings"* — rather than
saving empty minutes marked as done. If you hit this, switch to a non-reasoning model.

## 3. Verify with the connection test

Both the onboarding flow and **Settings** have a **Test connection** button for each
provider. referat sends a small real request that exercises the address, the model and (if
set) the API key:

- **Transcription** — reachable server → green check. A `401/403` means a wrong or missing
  API key; a network error means the address is wrong or the server isn't running.
- **Summarization** — a minimal chat request that confirms the model responds.

When both show green, you're ready. Pick **On this computer** and record your first meeting.

## Optional: speaker identification ("who said what")

A third, optional local service can label the transcript per speaker — **Talare 1**,
**Talare 2**, … — with names you can edit that flow into the minutes. It is off by default
and runs as a companion server that ships in the repository (`diarization-server/`,
Python + pyannote.audio, installed and started with uv). An NVIDIA GPU is strongly
recommended; CPU works but is many times slower than realtime.

Setup is a separate guide: **[Speaker Diarization](Speaker-Diarization)** — Hugging Face
account, install, and pointing the app at the server under **Settings → Speakers**.

## Troubleshooting

- **"The server isn't responding — check the address."** The service isn't running, or the
  base URL/port is wrong. Confirm the Docker container / `ollama serve` is up and the port
  matches.
- **"The model wasn't found — check the model name."** The model name doesn't match one the
  server has loaded. For Ollama, run `ollama list`; for speaches, use the model id you
  configured it to load.
- **Empty minutes / empty-answer error.** See *Choose a non-reasoning model* above.
- **Long meetings.** referat records in ~10-minute segments and transcribes them in order,
  so meeting length isn't a problem for a local server — see [Architecture](Architecture).

## Related pages

- **[Configuration](Configuration)** — every setting field in detail.
- **[Speaker Diarization](Speaker-Diarization)** — the optional "who said what" service.
- **[Installation](Installation)** — first-run walkthrough.
- **[FAQ](FAQ)** — common questions.
