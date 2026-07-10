# referat

> Meeting notes that stay on your machine.

**referat** is a Windows desktop app that records your meetings (system audio + microphone),
transcribes them and writes finished meeting minutes — a summary, decisions and action
items. You decide where the AI runs: locally on your machine, on your company's internal
server, or with a cloud provider. Nothing leaves your machine unless you choose it.

## Why referat

- **Privacy by design.** Audio, transcripts and minutes are stored locally. The only thing
  sent out is text, to the AI service you chose yourself. There is no telemetry.
- **You choose where the AI runs.** Point transcription and summarization at any
  OpenAI-compatible endpoint — a local server, your company's internal server, OpenAI or
  Azure OpenAI. Anthropic is also supported for the minutes.
- **Simple.** One button starts the recording; the app transcribes and summarizes
  automatically when you stop. No terminal, no jargon.
- **Works with any meeting tool.** referat records your computer's system audio, so it works
  with Teams, Zoom, Google Meet or an in-person meeting — no bot joins the call.

## Download

- **Installer**: [latest release](https://github.com/sockulags/referat/releases/latest) —
  Windows 10/11.
- **Landing page**: https://sockulags.github.io/referat/

## Documentation

- **[Installation](Installation)** — download, the SmartScreen note and the first-run
  walkthrough.
- **[Local AI Setup](Local-AI-Setup)** — run everything on your own machine with speaches
  and Ollama.
- **[Configuration](Configuration)** — every setting explained: provider presets, base URLs,
  models, the minutes template and more.
- **[FAQ](FAQ)** — cost, storage location, supported services, privacy.
- **[Architecture](Architecture)** — how referat is built, and its security hardening.
- **[Roadmap](Roadmap)** — what's planned next.

## A note on language

The app interface is currently Swedish, and the default minutes template produces Swedish
minutes. The transcription itself follows the spoken language. An English UI is on the
[Roadmap](Roadmap). This wiki and the landing page are in English.
