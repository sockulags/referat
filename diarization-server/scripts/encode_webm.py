"""Encode a wav file to webm/opus with PyAV (mimics MediaRecorder output).

Usage: uv run python scripts/encode_webm.py input.wav output.webm
"""

from __future__ import annotations

import sys
import wave
from fractions import Fraction

import av
import numpy as np


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    with wave.open(src, "rb") as w:
        rate = w.getframerate()
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)

    with av.open(dst, "w", format="webm") as container:
        stream = container.add_stream("libopus", rate=48000)
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = rate
        frame.time_base = Fraction(1, rate)
        frame.pts = 0
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
