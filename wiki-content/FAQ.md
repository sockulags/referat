# FAQ

## Does it cost anything?

The app is free to download and use. If you run the AI locally or against your company's own
server, there are no extra costs. If you use a cloud service such as OpenAI, Azure OpenAI or
Anthropic, you pay that provider's usual usage fee directly to them — referat doesn't add
anything on top and has no subscription.

## Where are recordings stored?

Locally, under:

```
%APPDATA%\referat\meetings
```

There is one folder per meeting containing the audio, transcript and minutes. Nothing is
uploaded automatically — the only thing sent out is text, to the AI service you chose for
transcription and summarization. See [Architecture](Architecture) for the exact file layout.

## Which AI services work?

Any **OpenAI-compatible** endpoint for transcription and chat, plus **Anthropic** for the
minutes. That covers:

- Local servers such as [speaches](https://github.com/speaches-ai/speaches) (transcription)
  and [Ollama](https://ollama.com) (minutes).
- Your company's internal endpoint.
- OpenAI and Azure OpenAI.
- Anthropic (for the minutes).

Transcription and summarization are configured separately. See
[Configuration](Configuration).

## Does it work with Teams, Zoom and Meet?

Yes. referat records your computer's **system audio**, so it works with any meeting tool —
Microsoft Teams, Zoom, Google Meet — or an in-person meeting in the room. **No bot joins the
call** and no plugin or integration is required. It records what your computer plays plus
your microphone.

## What language is the app in?

The interface is currently **Swedish**, and the default minutes template produces Swedish
minutes. The transcription follows the spoken language. An **English UI is on the
[Roadmap](Roadmap)**. This wiki and the landing page are in English. You can also edit the
minutes template to output another language — see [Configuration](Configuration).

## Is there any telemetry or tracking?

No. The app doesn't phone home. Outbound network traffic goes only to the transcription and
summarization endpoints you configure yourself. There is no analytics, no account and no
usage reporting.

## Are my API keys safe?

Yes. Keys are encrypted with **Windows DPAPI** (via Electron `safeStorage`) and stored as
ciphertext. The plaintext key is never written to disk and never sent back to the app's
interface. If OS encryption isn't available, referat refuses to store the key rather than
saving it in plaintext.

## How are long meetings handled?

referat records in **~10-minute segments**. Each segment is an independently decodable file,
kept under provider size limits (OpenAI rejects files over 25 MB). At transcription time the
segments are processed in order and stitched back together with correct timestamps, so
meeting length isn't a problem.

## What happens if transcription or summarization fails?

The meeting is marked **Error** with a plain-language message (for example "wrong or missing
API key" or "the server isn't responding"). Nothing is lost — press **Try again** and the
pipeline **resumes from the failed step**: if the transcript already exists it only re-runs
the summarization. If the app is closed mid-processing, the job resumes automatically on the
next launch.

## Can I close the app while it's working?

Yes. Transcription and summarization run in the background and are saved to disk as they
progress. If you close the app, the work resumes the next time you open it.

## Related pages

- **[Installation](Installation)** · **[Local AI Setup](Local-AI-Setup)** ·
  **[Configuration](Configuration)** · **[Architecture](Architecture)** · **[Roadmap](Roadmap)**
