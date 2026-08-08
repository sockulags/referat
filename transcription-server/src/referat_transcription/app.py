from __future__ import annotations

import argparse
import logging
import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

DEFAULT_MODEL = "KBLab/kb-whisper-small"
log = logging.getLogger("referat_transcription")


def create_app(model: WhisperModel, model_name: str, device: str) -> FastAPI:
    app = FastAPI(title="referat-transcription", version="0.1.0")
    model_lock = threading.Lock()

    @app.get("/health")
    def health():
        return {"status": "ok", "model": model_name, "device": device}

    @app.get("/v1/models")
    def models():
        return {"data": [{"id": model_name, "object": "model"}], "object": "list"}

    @app.post("/v1/audio/transcriptions")
    def transcribe(
        file: UploadFile = File(...),
        model_id: str = Form(default="", alias="model"),
        language: str | None = Form(default=None),
        response_format: str = Form(default="verbose_json"),
    ):
        del model_id
        suffix = Path(file.filename or "audio.webm").suffix or ".webm"
        temp_path = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
                temp.write(file.file.read())
                temp_path = temp.name
            with model_lock:
                segments_iter, info = model.transcribe(
                    temp_path,
                    language=language or None,
                    beam_size=2 if device == "cpu" else 5,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 400},
                    condition_on_previous_text=False,
                )
                segments = list(segments_iter)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            if response_format == "text":
                return text
            return {
                "language": info.language or language or "sv",
                "duration": info.duration,
                "text": text,
                "segments": [
                    {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
                    for segment in segments
                ],
            }
        except Exception as error:
            log.exception("Transcription failed")
            raise HTTPException(status_code=500, detail=f"Transcription failed: {error}")
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8310)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--device", choices=["cpu", "cuda", "auto"], default="cpu")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    devices = ["cuda", "cpu"] if args.device == "auto" else [args.device]
    loaded = None
    actual_device = ""
    last_error: Exception | None = None
    for device in devices:
        try:
            loaded = WhisperModel(
                args.model,
                device=device,
                compute_type="float16" if device == "cuda" else "int8",
            )
            actual_device = device
            break
        except Exception as error:
            last_error = error
            log.warning("Could not load model on %s: %s", device, error)
    if loaded is None:
        raise RuntimeError(f"Could not load transcription model: {last_error}")

    import uvicorn

    uvicorn.run(create_app(loaded, args.model, actual_device), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
