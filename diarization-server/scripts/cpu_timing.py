"""Time the diarization pipeline on CPU, reusing the benchmark's test audio.

The full benchmark regenerates the dialogue with Piper and overwrites the
stored GPU results. This only answers the timing question: how long does the
default pipeline take per second of audio on this machine's CPU?

Usage (from diarization-server/):
    uv run python scripts/cpu_timing.py [--device cpu] [--wav PATH]

Prints the real-time factor and what it extrapolates to for a 30- and
60-minute meeting.
"""

from __future__ import annotations

import argparse
import time
import wave
from pathlib import Path

import numpy as np

DEFAULT_MODEL = "pyannote/speaker-diarization-community-1"
SAMPLE_RATE = 16_000


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != SAMPLE_RATE or wav.getnchannels() != 1:
            raise SystemExit(f"expected 16 kHz mono, got {wav.getframerate()} Hz / {wav.getnchannels()} ch")
        frames = wav.readframes(wav.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cpu")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--wav", type=Path, default=Path(__file__).parent / "out" / "test-meeting.wav")
    args = parser.parse_args()

    import torch
    from pyannote.audio import Pipeline

    waveform = read_wav(args.wav)
    audio_sec = len(waveform) / SAMPLE_RATE

    threads = torch.get_num_threads()
    print(f"{args.model} on {args.device} ({threads} torch threads), {audio_sec:.1f} s of audio")

    t0 = time.monotonic()
    pipeline = Pipeline.from_pretrained(args.model)
    pipeline.to(torch.device(args.device))
    load_s = time.monotonic() - t0

    tensor = torch.from_numpy(waveform).unsqueeze(0)
    t0 = time.monotonic()
    pipeline({"waveform": tensor, "sample_rate": SAMPLE_RATE})
    infer_s = time.monotonic() - t0

    rtf = infer_s / audio_sec
    print(f"  load       {load_s:.1f} s (once per server start)")
    print(f"  inference  {infer_s:.1f} s  ->  real-time factor {rtf:.3f}")
    for minutes in (30, 60):
        print(f"  {minutes:>3} min meeting  ~{rtf * minutes * 60 / 60:.1f} min of diarization")


if __name__ == "__main__":
    main()
