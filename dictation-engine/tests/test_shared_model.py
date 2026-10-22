"""En modell för diktering och möten: dikteringen går före, mötesljud skrivs
ut i bitar, och servern svarar som en OpenAI-kompatibel transkribering."""

import io
import json
import threading
import time
import urllib.request
import wave
from dataclasses import dataclass

import numpy as np

from viska import transcribe as transcribe_module
from viska.gate import PriorityGate
from viska.transcription_server import TranscriptionServer, parse_multipart

RATE = 16000


def test_diktering_gar_fore_mötesljud_som_väntar():
    gate = PriorityGate()
    order = []
    with gate.low():
        meeting = threading.Thread(target=lambda: _hold(gate.low, order, "möte"))
        meeting.start()
        time.sleep(0.05)
        dictation = threading.Thread(target=lambda: _hold(gate.high, order, "diktering"))
        dictation.start()
        time.sleep(0.05)
    meeting.join(2)
    dictation.join(2)
    assert order == ["diktering", "möte"]


def _hold(enter, order, name):
    with enter():
        order.append(name)


def _speech_with_pause(seconds: float, pause_at: float) -> np.ndarray:
    rng = np.random.default_rng(0)
    audio = (rng.standard_normal(int(seconds * RATE)) * 0.05).astype(np.float32)
    start = int(pause_at * RATE)
    audio[start : start + RATE // 2] = 0
    return audio


def test_langt_ljud_delas_i_tystnaden_nara_gransen():
    audio = _speech_with_pause(70, pause_at=32.0)
    bounds = transcribe_module.chunk_bounds(audio)
    assert bounds[0][0] == 0 and bounds[-1][1] == len(audio)
    assert all(a[1] == b[0] for a, b in zip(bounds, bounds[1:])), "inga glapp"
    first_cut = bounds[0][1] / RATE
    assert 32.0 <= first_cut <= 32.5


def test_kort_ljud_blir_en_bit():
    assert transcribe_module.chunk_bounds(np.zeros(20 * RATE, np.float32)) == [(0, 20 * RATE)]


@dataclass
class Seg:
    start: float
    end: float
    text: str


class FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append(len(audio))
        return iter([Seg(1.0, 2.0, f"  bit {len(self.calls)} ")]), None


class FakeTranscriber:
    def __init__(self):
        self.gate = PriorityGate()
        self._model = FakeModel()
        self.beam_size = 5
        self.initial_prompt = ""
        self.model_name = "KBLab/kb-whisper-large"


def test_tidsstamplarna_raknas_fran_mötets_borjan():
    audio = _speech_with_pause(70, pause_at=32.0)
    segments = transcribe_module.transcribe_long(FakeTranscriber(), audio, "sv")
    bounds = transcribe_module.chunk_bounds(audio)
    assert [s["text"] for s in segments] == [f"bit {i + 1}" for i in range(len(bounds))]
    assert segments[1]["start"] == bounds[1][0] / RATE + 1.0


def test_multipart_tolkas():
    body = (
        b"--x\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nsv\r\n"
        b"--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.webm\"\r\n"
        b"Content-Type: audio/webm\r\n\r\n\x00\x01ljud\r\n--x--\r\n"
    )
    fields = parse_multipart("multipart/form-data; boundary=x", body)
    assert fields["language"] == b"sv"
    assert fields["file"] == b"\x00\x01ljud"


class FakeEngine:
    language = "sv"

    def __init__(self):
        self.transcriber = FakeTranscriber()
        self.transcribers = {"sv": self.transcriber}

    def transcriber_for(self, lang):
        return self.transcriber


def _wav(seconds: float) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        tone = (np.sin(np.arange(int(seconds * RATE)) * 0.05) * 8000).astype(np.int16)
        w.writeframes(tone.tobytes())
    return buffer.getvalue()


def test_servern_svarar_som_en_openai_transkribering():
    server = TranscriptionServer(FakeEngine())
    port = server.start()
    try:
        boundary = "grans"
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\n"
            f"verbose_json\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        ).encode("utf-8") + _wav(3) + f"\r\n--{boundary}--\r\n".encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/audio/transcriptions",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.loads(response.read())
        assert result["text"] == "bit 1"
        assert result["segments"][0] == {"id": 0, "start": 1.0, "end": 2.0, "text": "bit 1"}
        assert abs(result["duration"] - 3.0) < 0.05
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as response:
            assert json.loads(response.read()) == {"ok": True}
    finally:
        server.stop()
