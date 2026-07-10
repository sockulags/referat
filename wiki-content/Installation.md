# Installation

referat runs on Windows 10 and 11. Installing takes a minute or two.

## 1. Download the installer

Download the latest installer from the
[releases page](https://github.com/sockulags/referat/releases/latest):

`referat-setup.exe`

The direct link is also on the [landing page](https://sockulags.github.io/referat/).

## 2. Run it — and the SmartScreen warning

The 0.1 build is signed with a **self-signed certificate**, which Windows does not
trust by default, so when you run the installer SmartScreen will most likely show
a blue dialog:

> *Windows protected your PC*

This is expected for a new app from an independent developer without a CA-issued
certificate — it is not a sign that anything is wrong. To continue:

1. Click **More info**.
2. Click **Run anyway**.

The installer then runs normally. CA-issued signing is on the [Roadmap](Roadmap); once
in place, this warning will disappear.

**For organizations:** the public certificate (`referat-codesign.cer`) is attached to
each [release](https://github.com/sockulags/referat/releases). Deploying it to
**Trusted Publishers** via GPO or Intune removes the warning across your fleet, and you
can verify every binary's signature (subject `CN=Lucas Skog, O=referat`) before rollout.

## 3. First-run onboarding

The first time you open referat, a short setup guide walks you through four steps. You can
skip it and return to it later from **Settings**.

### Step 1 — Welcome

A brief description of what the app does. No configuration here — just click **Get started**.

### Step 2 — Where should the AI run?

This is the key choice. It decides where your audio and text are sent. You can change it
any time in Settings. Three options:

- **On this computer** — nothing leaves your machine. Requires a local AI server running on
  your computer. See **[Local AI Setup](Local-AI-Setup)** for the full guide.
- **On the company server** — your IT department gives you an address (a base URL) and, if
  needed, an API key to paste in.
- **Cloud service** — use OpenAI or Azure OpenAI by entering your API key.

referat configures **transcription** and **summarization** as two independent providers, so
you can, for example, transcribe locally and summarize in the cloud. See
**[Configuration](Configuration)** for the details of each field.

### Step 3 — Connection test

referat runs a real request against both the transcription and summarization providers and
shows a green check for each, or a plain-language explanation if one fails (for example
"wrong or missing API key" or "the server isn't responding — check the address"). You can
**Continue anyway** if you want to finish setup and fix a provider later.

### Step 4 — Microphone test

Pick your microphone and speak — the level meter should move. This confirms referat can
hear you before your first real recording.

When you finish, you land on the home screen with a big **Start recording** button.

## Where your data lives

Recordings, transcripts and minutes are stored under:

```
%APPDATA%\referat\meetings
```

One folder per meeting. API keys are stored encrypted (Windows DPAPI) in
`%APPDATA%\referat\settings.json`. See **[Configuration](Configuration)** and
**[Architecture](Architecture)** for more.

## Next steps

- Running everything locally? → **[Local AI Setup](Local-AI-Setup)**
- Tuning providers or the minutes template? → **[Configuration](Configuration)**
- Questions? → **[FAQ](FAQ)**
