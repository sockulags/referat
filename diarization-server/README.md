# diarization-server

Local speaker diarization ("who spoke when") companion server for the
**referat** app. Runs [pyannote.audio](https://github.com/pyannote/pyannote-audio)
behind a small HTTP API. Everything runs on your machine — the only network
access is the one-time model download from Hugging Face.

The referat app records meetings as webm/opus segments, sends them all in one
request, and merges the returned speaker turns into the transcript.

## Requirements

- Windows/Linux, Python 3.12 (managed by uv)
- [uv](https://docs.astral.sh/uv/)
- NVIDIA GPU strongly recommended (a ~1 hour meeting diarizes in well under a
  minute on a modern GPU). CPU works but is much slower.
- A Hugging Face account with access to the gated pyannote models (free, see below)

## Hugging Face model access (one-time)

The pyannote pipelines are gated: you must accept their conditions before the
server can download them.

1. Create/log in to a [Hugging Face](https://huggingface.co) account.
2. Visit each model page and accept the conditions:
   - https://huggingface.co/pyannote/speaker-diarization-community-1
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
3. Log in locally so the server can use your token:

   ```
   uv tool run "huggingface_hub[cli]" auth login
   ```

   (or `hf auth login` if you already have the Hugging Face CLI installed;
   a fine-grained token with "read access to gated repos" permission is enough)

## Install

```
cd diarization-server
uv sync
```

This downloads PyTorch with CUDA support (~3 GB) — the `pyproject.toml` pins
torch/torchaudio to the PyTorch cu128 index, which is required for recent
NVIDIA GPUs (RTX 50-series / Blackwell need cu128+ kernels).

**CPU-only machines**: the CUDA wheels also run fine on CPU, so `uv sync`
followed by `--device cpu` works as-is. To avoid the large CUDA download
entirely, edit `pyproject.toml` and change the index URL from
`https://download.pytorch.org/whl/cu128` to
`https://download.pytorch.org/whl/cpu`, then `uv sync`.

## Start

```
uv run diarization-server
```

First start downloads the model (a few hundred MB) and warms up the pipeline;
subsequent starts take ~10-30 s. Flags:

| Flag | Default | Description |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `8300` | Port |
| `--model` | `pyannote/speaker-diarization-community-1` | pyannote pipeline id |
| `--device` | `auto` | `auto` tries CUDA, falls back to CPU with a warning; or force `cuda`/`cpu` |

## API

### `GET /health`

```json
{ "status": "ok", "model": "pyannote/speaker-diarization-community-1", "device": "cuda" }
```

### `POST /diarize`

Multipart form:

- `files` — one or more audio files **in recording order**. webm/opus (from
  MediaRecorder), wav, ogg, mp3 — anything FFmpeg decodes.
- `num_speakers` — optional integer; fixes the number of speakers if known.
- `embeddings` — optional; `1` or `true` adds per-speaker voice embeddings to
  the response (default off).

All files are decoded to 16 kHz mono, concatenated into one waveform and
diarized in a single pipeline run — this is what makes speaker labels globally
consistent across files. Response:

```json
{
  "turns": [
    { "start": 0.51, "end": 4.28, "speaker": "S1" },
    { "start": 4.97, "end": 9.13, "speaker": "S2" }
  ],
  "speakers": 2
}
```

Times are seconds on the concatenated global timeline. Speakers are labeled
`S1`, `S2`, ... in order of first appearance.

With `embeddings=1` the response also contains one voice embedding
(voiceprint) per speaker:

```json
{
  "turns": [...],
  "speakers": 2,
  "embeddings": {
    "S1": [0.0132, -0.0308, ...],
    "S2": [0.0087, 0.0412, ...]
  }
}
```

Each vector is the pipeline's cluster centroid for that speaker (256
dimensions with the default model), **L2-normalized** so cosine similarity
between two voiceprints is a plain dot product. Voiceprints are only computed
and returned when explicitly requested; without the field the response is
unchanged. Embeddings from the same server/model are comparable across
requests (that is the point — recognizing a returning voice across meetings);
do not compare embeddings produced by different embedding models.

Errors: `400` with a JSON `detail` for undecodable input, `500` with `detail`
for anything else.

Example:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8300/diarize -Method Post -Form @{
  files = Get-Item recording-*.webm
}
```

## Using with the referat app

1. Start the server (see above).
2. In referat: **Inställningar → Talare**, enable speaker diarization and set
   the base URL to `http://127.0.0.1:8300`.
3. Click **Testa anslutning** — it should report the model and device.

## Model choice

Benchmarked on a synthetic two-speaker Swedish meeting dialogue (Piper TTS,
two distinct voices, ~63 s, 12 turns) on an RTX 5060 Ti. Error is the fraction
of ground-truth speech time not credited to the right speaker after optimal
label mapping; "confusion" is the part attributed to the *wrong* speaker (the
rest is missed silence padding inside turns, harmless for transcript merging).
See `scripts/benchmark.py`.

| Pipeline | Error | Confusion | Inference (GPU) | Speakers found |
| --- | --- | --- | --- | --- |
| `pyannote/speaker-diarization-community-1` | 15.2 % | 8.3 % | 1.8 s | 2 |
| `pyannote/speaker-diarization-3.1` | 16.2 % | 9.2 % | 1.5 s | 2 |

`pyannote/speaker-diarization-community-1` won on accuracy and is the default.
(TTS synthesis is nondeterministic, so exact numbers vary a little between
benchmark runs; community-1 came out ahead consistently.)

## Development

```
uv run python scripts/benchmark.py            # regenerate test audio + rerun benchmark
uv run python scripts/benchmark.py --skip-models   # only generate test audio
```
