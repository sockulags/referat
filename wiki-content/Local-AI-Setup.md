# Local AI Setup

referat can record first and process the saved audio later. Local transcription and speaker
identification are installed from inside the app; Python, Docker and administrator access are not
required.

## Local transcription

1. Open **Settings → Transcription**.
2. Choose **Built-in local model**.
3. Click **Install**.

referat downloads a version-matched Windows runtime, verifies its SHA-256 checksum and installs it
under `%LOCALAPPDATA%\referat\local-ai`. KB-Whisper Small is downloaded on first start and cached under
`local-ai\models`. The default runtime uses CPU with int8 quantization. It does not need to keep up
with the meeting in real time: recordings remain available and failed processing can be retried.

## Local speaker identification

Speaker identification is optional and substantially heavier than transcription.

1. Open **Settings → Speakers** and enable **Identify speakers**.
2. Choose **On this computer**.
3. Install either **CPU** or **NVIDIA GPU**.
4. Save and click **Test connection**. The first test warms the model and can take a minute.

There is no account and no token: the pyannote weights ship inside the component, which runs
offline once installed. Managed Pyannote starts with telemetry disabled. The CPU package is
smaller but slower — budget roughly a quarter of the meeting's length — while the NVIDIA package
is several gigabytes and turns the same work into seconds.

## Local minutes generation

Transcription and minutes generation are independent. For minutes you can use an authenticated
Codex CLI, an internal endpoint, a cloud provider, or a local OpenAI-compatible server such as
Ollama. To use Ollama:

```bash
ollama pull llama3.1
ollama serve
```

Choose **Local server** under **Settings → Summarization**, with base URL
`http://localhost:11434/v1` and model `llama3.1`.

## Advanced: external transcription server

The managed component is the normal path. To reuse an existing server, choose **Local server** or
**Custom** under transcription. Any OpenAI-compatible `/v1/audio/transcriptions` endpoint works,
including Speaches at `http://localhost:8000/v1`.

External speaker servers remain supported under **Speakers → Own server** and use the existing
`GET /health` plus `POST /diarize` contract.
