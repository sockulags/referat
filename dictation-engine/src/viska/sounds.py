"""Korta ljudsignaler för start/stopp/fel.

winsound.Beep blockerar anropande tråd, så i stället genereras små
wav-filer en gång (i konfigmappen) och spelas asynkront med PlaySound.
"""

import math
import struct
import wave

import winsound

from viska.config import CONFIG_DIR

_RATE = 22050


def _ensure_wav(path, freq_from: float, freq_to: float, ms: int = 130) -> None:
    if path.exists():
        return
    n = int(_RATE * ms / 1000)
    frames = bytearray()
    for i in range(n):
        freq = freq_from + (freq_to - freq_from) * i / n
        envelope = math.sin(math.pi * i / n)  # mjuk in- och uttoning
        sample = int(32767 * 0.4 * envelope * math.sin(2 * math.pi * freq * i / _RATE))
        frames += struct.pack("<h", sample)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(_RATE)
        w.writeframes(bytes(frames))


class Sounds:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self._start = CONFIG_DIR / "start.wav"
        self._stop = CONFIG_DIR / "stop.wav"
        self._error = CONFIG_DIR / "error.wav"
        _ensure_wav(self._start, 660, 990)
        _ensure_wav(self._stop, 990, 660)
        _ensure_wav(self._error, 330, 220, ms=250)

    def start(self) -> None:
        self._play(self._start)

    def stop(self) -> None:
        self._play(self._stop)

    def error(self) -> None:
        self._play(self._error)

    def _play(self, path) -> None:
        if not self.enabled:
            return
        try:
            winsound.PlaySound(
                str(path),
                winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT,
            )
        except RuntimeError:
            pass
