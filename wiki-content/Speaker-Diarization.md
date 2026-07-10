# Speaker Diarization

Speaker diarization answers **"who said what"**. When enabled, referat labels each
transcript segment with a speaker — **Talare 1**, **Talare 2**, and so on — after
transcription. Click a label in the transcript tab to rename it (for example to *Anna*);
the name is saved with the meeting, and when the minutes are regenerated the transcript sent
to the summarization model is speaker-attributed (`Anna: …`), so the minutes can reflect who
raised each point.

The feature is **optional and off by default**. It requires a local companion server that
ships in the repository (`diarization-server/`) — Python with
[pyannote.audio](https://github.com/pyannote/pyannote-audio), served over HTTP on
`localhost`. The app talks to it the same way it talks to speaches or Ollama: you start the
server, paste an address into settings and press **Test connection**.

Diarization is deliberately non-blocking: **a diarization failure never stops the minutes**.
If the server is down or errors mid-processing, the meeting gets a plain-language warning
note and the protocol is still produced — just without speaker labels.

## Requirements — read this first

Be honest with your expectations here:

- **An NVIDIA GPU is strongly recommended.** The server runs on CPU too, but CPU
  diarization is many times slower than realtime — a one-hour meeting can take several
  hours. With a GPU it is fast.
- **Recent GPUs need recent CUDA-enabled PyTorch.** The project's uv setup handles this for
  you; you don't pick PyTorch versions by hand.
- **Disk space.** The first install downloads a Python environment of several gigabytes,
  and the first server start downloads the model weights. Both are cached locally —
  after that, everything runs offline.
- **A Hugging Face account** (free) — the models are gated, see below.

## 1. One-time Hugging Face setup

The pyannote models are **gated**: they are free, but you must accept their conditions
once, while logged in to a [Hugging Face](https://huggingface.co) account.

1. Create a Hugging Face account (or log in).
2. Open each of these model pages and accept the conditions on all three (the second and
   third are dependencies and benchmark alternatives of the first):
   - [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1)
   - [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0)
   - [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
3. Create an access token (huggingface.co → *Settings → Access Tokens*, a **read** token is
   enough) and log in locally:

```powershell
hf auth login
```

The model weights download on the server's first start and are cached. Hugging Face is only
contacted for that download — afterwards the server runs fully offline.

## 2. Install and start the server

The server lives in the `diarization-server/` folder of the
[referat repository](https://github.com/sockulags/referat) and is managed with
[uv](https://docs.astral.sh/uv/) (which also provides the right Python — nothing else to
install first).

```powershell
cd referat\diarization-server
uv sync
uv run diarization-server
```

`uv sync` creates the environment (the several-GB download happens here). The server then
answers on **`http://localhost:8300`**. A quick sanity check: open
`http://localhost:8300/health` in a browser — it reports the server status, the loaded
model and whether it is running on GPU or CPU.

## 3. Point referat at the server

In **Settings → Speakers** (the app's Swedish UI calls the group **Talare**):

| Field                                      | Value                                       |
| ------------------------------------------ | ------------------------------------------- |
| **Identify speakers** (*Identifiera talare*) | on                                        |
| **Server address** (*Serveradress*)        | `http://localhost:8300`                     |

Press **Test connection** (*Testa anslutning*) — a green check means referat can reach the
server. From then on, every new meeting runs
`transcribe → identify speakers → summarize`, and the transcript tab shows the labels.

## Renaming speakers

The server can't know anyone's name — it only tells voices apart, so labels start as
**Talare 1**, **Talare 2**, … in order of first appearance. In the meeting's transcript tab,
**click a label to rename it**. Names are saved with the meeting. Minutes that already exist
aren't rewritten automatically: regenerate the protocol and the summarization model receives
the speaker-attributed transcript with your names.

## Troubleshooting

- **Test connection fails.** The server isn't running, or the address/port is wrong. Check
  that `uv run diarization-server` is up and that the address matches
  (`http://localhost:8300` by default).
- **A meeting finished with a warning note.** The diarization server was unreachable or
  failed during processing. This is by design: the minutes are still produced, just without
  speaker labels. Fix the server (start it, check its terminal output) — it will be used
  for subsequent meetings.
- **The server fails on first start with an authorization error.** You haven't accepted the
  gated-model conditions on all three model pages above, or you aren't logged in — run
  `hf auth login` and try again.
- **`/health` says CPU even though you have an NVIDIA GPU.** Check that a current NVIDIA
  driver is installed, then re-run `uv sync` so the CUDA-enabled PyTorch is picked up. CPU
  mode still works — it's just many times slower than realtime.
- **It's very slow.** That's CPU mode. See the requirements section — for regular use with
  long meetings, a GPU is the realistic option.

## Privacy

The privacy story doesn't change. The diarization server is a **local** service; referat
only ever talks to endpoints you configured yourself. Your meeting audio goes to the
address in the *Server address* field — `localhost` in the default setup — and nowhere
else. The only time the machine talks to the internet on the feature's behalf is the
one-time model download from Hugging Face; after that, diarization runs fully offline.

## Related pages

- **[Local AI Setup](Local-AI-Setup)** — the fully local transcription and minutes setup.
- **[Configuration](Configuration)** — every settings field, including the Speakers group.
- **[FAQ](FAQ)** — privacy and data-handling questions.
