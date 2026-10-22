"""Mötesljud till samma modell som dikteringen.

Referat skriver ut möten genom att skicka ljudfiler till en
OpenAI-kompatibel /v1/audio/transcriptions. Med dikteringen igång finns
redan en varm Whisper-modell i motorn; den här servern låter Referat använda
den i stället för att starta en egen. Mötesljudet skrivs ut i bitar med låg
prioritet (se gate.py), så att en diktering aldrig fastnar bakom ett möte.

Lyssnar bara på 127.0.0.1.
"""

import io
import json
import logging
import threading
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from viska.transcribe import transcribe_long

log = logging.getLogger(__name__)

SAMPLE_RATE = 16000
# Ett tiominutersavsnitt i webm/opus är några MB; det här stoppar bara
# uppenbart fel anrop.
MAX_BODY_BYTES = 500 * 1024 * 1024


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    """Fälten i ett multipart/form-data-anrop, som bytes per namn."""
    message = BytesParser(policy=policy.HTTP).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body
    )
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields[name] = part.get_payload(decode=True) or b""
    return fields


def verbose_json(segments: list[dict], language: str, duration: float) -> dict:
    return {
        "language": language,
        "duration": duration,
        "text": " ".join(seg["text"] for seg in segments),
        "segments": [
            {"id": i, "start": seg["start"], "end": seg["end"], "text": seg["text"]}
            for i, seg in enumerate(segments)
        ],
    }


class TranscriptionServer:
    def __init__(self, engine, host: str = "127.0.0.1", port: int = 0):
        self.engine = engine
        self._server = ThreadingHTTPServer((host, port), self._handler())
        self._server.daemon_threads = True
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def start(self) -> int:
        self._thread = threading.Thread(
            target=self._server.serve_forever, daemon=True, name="viska-transcription"
        )
        self._thread.start()
        log.info("Transkriberingsservern lyssnar på 127.0.0.1:%d", self.port)
        return self.port

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def transcribe(self, audio_bytes: bytes, language: str) -> dict:
        from faster_whisper import decode_audio

        audio = decode_audio(io.BytesIO(audio_bytes), sampling_rate=SAMPLE_RATE)
        transcriber = self.engine.transcriber_for(language or self.engine.language)
        segments = transcribe_long(transcriber, audio, language or None)
        return verbose_json(
            segments, language or self.engine.language, len(audio) / SAMPLE_RATE
        )

    def _handler(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                log.debug("http: " + fmt, *args)

            def _send(self, status: int, body, content_type="application/json"):
                data = (
                    json.dumps(body, ensure_ascii=False).encode("utf-8")
                    if content_type == "application/json"
                    else str(body).encode("utf-8")
                )
                self.send_response(status)
                self.send_header("Content-Type", f"{content_type}; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path.rstrip("/") == "/health":
                    self._send(200, {"ok": True})
                elif self.path.rstrip("/") in ("/v1/models", "/models"):
                    names = [t.model_name for t in server.engine.transcribers.values()]
                    self._send(200, {"data": [{"id": name} for name in names]})
                else:
                    self._send(404, {"error": "finns inte"})

            def do_POST(self):
                if self.path.rstrip("/") not in (
                    "/v1/audio/transcriptions",
                    "/audio/transcriptions",
                ):
                    self._send(404, {"error": "finns inte"})
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY_BYTES:
                    self._send(413, {"error": "ljudfilen saknas eller är för stor"})
                    return
                fields = parse_multipart(
                    self.headers.get("Content-Type", ""), self.rfile.read(length)
                )
                if not fields.get("file"):
                    self._send(400, {"error": "fältet file saknas"})
                    return
                language = fields.get("language", b"").decode("utf-8").strip()
                try:
                    result = server.transcribe(fields["file"], language)
                except Exception as e:  # noqa: BLE001
                    log.exception("Transkriberingen misslyckades")
                    self._send(500, {"error": str(e)})
                    return
                fmt = fields.get("response_format", b"json").decode("utf-8")
                if fmt == "text":
                    self._send(200, result["text"], "text/plain")
                elif fmt == "verbose_json":
                    self._send(200, result)
                else:
                    self._send(200, {"text": result["text"]})

        return Handler
