"""FastAPI server + CLI entry point.

HTTP contract (see referat/docs/arkitektur.md, "Talardiarisering"):

  GET  /health   -> { "status": "ok", "model": "<id>", "device": "cuda"|"cpu" }
  POST /diarize  -> multipart form, repeated field `files` (audio files in
                    recording order), optional form fields `num_speakers` and
                    `embeddings` ("1"/"true" enables per-speaker voiceprints).
                    Response: { "turns": [{ "start", "end", "speaker" }],
                                "speakers": <count> }
                    plus, when embeddings are requested,
                    "embeddings": { "S1": [float, ...], ... } - one
                    L2-normalized voice embedding per speaker.

All files in one request are decoded to 16 kHz mono, concatenated into a
single waveform and diarized in one pipeline run - that is what makes speaker
labels globally consistent across files. Times are seconds on the concatenated
global timeline; labels are normalized to "S1", "S2", ... in order of first
appearance.
"""

from __future__ import annotations

import argparse
import logging
import threading
import time

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from diarization_server.audio import SAMPLE_RATE, DecodeError, concatenate, decode_to_mono_16k

DEFAULT_MODEL = "pyannote/speaker-diarization-community-1"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8300

log = logging.getLogger("diarization_server")


def load_pipeline(model: str, device: str):
    """Load the pyannote pipeline once and move it to the requested device.

    device: "auto" tries cuda first and falls back to cpu with a warning;
    "cuda"/"cpu" are used as-is. Returns (pipeline, actual_device).
    A short warmup run is done on the target device so CUDA problems (e.g.
    missing kernels for the GPU architecture) surface at startup, not on the
    first request.
    """
    import warnings

    # pyannote.audio 4.x warns at import time if torchcodec cannot find FFmpeg
    # DLLs. That only affects pyannote's built-in file decoding, which this
    # server never uses - all audio is decoded with PyAV and passed in-memory
    # as {"waveform", "sample_rate"} (the workaround the warning itself
    # recommends). Suppress the noise.
    warnings.filterwarnings("ignore", message="(?s).*torchcodec.*")
    from pyannote.audio import Pipeline

    t0 = time.monotonic()
    log.info("Loading pipeline %s ...", model)
    pipeline = Pipeline.from_pretrained(model)
    if pipeline is None:
        raise RuntimeError(
            f"Could not load {model}. Make sure you accepted the model's "
            "gated-access conditions on Hugging Face and are logged in "
            "(hf auth login). See README.md."
        )
    log.info("Pipeline loaded in %.1f s", time.monotonic() - t0)

    candidates = ["cuda", "cpu"] if device == "auto" else [device]
    last_error: Exception | None = None
    for dev in candidates:
        if dev == "cuda" and not torch.cuda.is_available():
            log.warning("CUDA requested but not available, falling back to CPU")
            last_error = RuntimeError("CUDA not available")
            continue
        try:
            t0 = time.monotonic()
            pipeline.to(torch.device(dev))
            # Warmup: 2 s of near-silence through the full pipeline.
            noise = torch.from_numpy(
                (np.random.default_rng(0).standard_normal(2 * SAMPLE_RATE) * 1e-4).astype(
                    np.float32
                )
            ).unsqueeze(0)
            pipeline({"waveform": noise, "sample_rate": SAMPLE_RATE})
            log.info(
                "Pipeline ready on %s (%s), warmup %.1f s",
                dev,
                torch.cuda.get_device_name(0) if dev == "cuda" else "CPU",
                time.monotonic() - t0,
            )
            return pipeline, dev
        except Exception as e:
            last_error = e
            if dev == "cuda" and device == "auto":
                log.warning("CUDA failed (%s), falling back to CPU", e)
            else:
                log.error("Could not initialize pipeline on %s: %s", dev, e)
    raise RuntimeError(f"Could not initialize pipeline on any device: {last_error}")


def annotation_of(result):
    """Return the pyannote Annotation from a pipeline result.

    pyannote.audio 4.x community pipelines return a structured output with a
    .speaker_diarization attribute; legacy pipelines (speaker-diarization-3.1)
    return the Annotation directly.
    """
    return getattr(result, "speaker_diarization", result)


def turns_from_annotation(annotation) -> tuple[list[dict], dict[str, str]]:
    """Convert an Annotation to normalized turns (S1, S2, ... by first appearance).

    Returns (turns, mapping) where mapping is original label -> normalized label.
    """
    mapping: dict[str, str] = {}
    turns: list[dict] = []
    # itertracks yields segments in chronological order.
    for segment, _track, label in annotation.itertracks(yield_label=True):
        if label not in mapping:
            mapping[label] = f"S{len(mapping) + 1}"
        turns.append(
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "speaker": mapping[label],
            }
        )
    return turns, mapping


def embeddings_from_result(result, mapping: dict[str, str]) -> dict[str, list[float]]:
    """Extract one L2-normalized voice embedding per normalized speaker label.

    pyannote.audio 4.x community pipelines return a structured output whose
    `speaker_embeddings` is a (num_speakers, dimension) array of cluster
    centroids, ordered like `speaker_diarization.labels()`. L2-normalizing
    here means the client can compare voiceprints with a plain dot product
    (equal to cosine similarity).

    Raises RuntimeError if the pipeline result does not carry embeddings
    (e.g. a legacy pipeline that returns a bare Annotation).
    """
    vectors = getattr(result, "speaker_embeddings", None)
    if vectors is None:
        raise RuntimeError(
            "The loaded pipeline does not expose speaker embeddings; "
            "use pyannote/speaker-diarization-community-1 (pyannote.audio >= 4)."
        )
    labels = annotation_of(result).labels()
    embeddings: dict[str, list[float]] = {}
    for index, label in enumerate(labels):
        vector = np.asarray(vectors[index], dtype=np.float64)
        norm = float(np.linalg.norm(vector))
        if norm > 0.0:
            vector = vector / norm
        # A zero vector can occur for a speaker the clustering step could not
        # give a centroid (rare edge case); it is returned as-is and yields
        # cosine similarity 0 against everything, i.e. "no match".
        embeddings[mapping[label]] = [float(x) for x in vector]
    return embeddings


def create_app(pipeline, model: str, device: str) -> FastAPI:
    app = FastAPI(title="diarization-server", version="0.1.0")
    # The pipeline is not thread-safe; requests are serialized. FastAPI runs
    # these sync endpoints in a threadpool, so the lock matters.
    pipeline_lock = threading.Lock()

    @app.get("/health")
    def health():
        return {"status": "ok", "model": model, "device": device}

    @app.post("/diarize")
    def diarize(
        files: list[UploadFile] = File(...),
        num_speakers: int | None = Form(default=None),
        embeddings: str | None = Form(default=None),
    ):
        want_embeddings = (embeddings or "").strip().lower() in {"1", "true", "yes", "on"}
        waveforms: list[np.ndarray] = []
        for f in files:
            data = f.file.read()
            try:
                waveforms.append(decode_to_mono_16k(data))
            except DecodeError as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not decode '{f.filename}' as audio: {e}",
                )
        waveform = concatenate(waveforms)
        duration = len(waveform) / SAMPLE_RATE
        tensor = torch.from_numpy(waveform).unsqueeze(0)
        kwargs = {}
        if num_speakers is not None:
            if num_speakers < 1:
                raise HTTPException(status_code=400, detail="num_speakers must be >= 1")
            kwargs["num_speakers"] = num_speakers
        t0 = time.monotonic()
        try:
            with pipeline_lock:
                result = pipeline({"waveform": tensor, "sample_rate": SAMPLE_RATE}, **kwargs)
        except Exception as e:
            log.exception("Diarization failed")
            raise HTTPException(status_code=500, detail=f"Diarization failed: {e}")
        turns, mapping = turns_from_annotation(annotation_of(result))
        speakers = len(mapping)
        response = {"turns": turns, "speakers": speakers}
        if want_embeddings:
            try:
                response["embeddings"] = embeddings_from_result(result, mapping)
            except Exception as e:
                log.exception("Embedding extraction failed")
                raise HTTPException(
                    status_code=500, detail=f"Embedding extraction failed: {e}"
                )
        log.info(
            "Diarized %d file(s), %.1f s audio, %d turns, %d speaker(s)%s in %.1f s",
            len(files),
            duration,
            len(turns),
            speakers,
            " + embeddings" if want_embeddings else "",
            time.monotonic() - t0,
        )
        return response

    return app


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="diarization-server",
        description="Local speaker diarization server (pyannote.audio) for the referat app.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"bind address (default {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port (default {DEFAULT_PORT})")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"pyannote pipeline id (default {DEFAULT_MODEL})")
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="auto tries cuda and falls back to cpu (default auto)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    pipeline, device = load_pipeline(args.model, args.device)
    app = create_app(pipeline, args.model, device)

    import uvicorn

    log.info("Serving on http://%s:%d (model=%s, device=%s)", args.host, args.port, args.model, device)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
