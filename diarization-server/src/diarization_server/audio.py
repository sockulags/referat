"""Audio decoding with PyAV: any container/codec FFmpeg handles (webm/opus,
wav, ogg, mp3, ...) to 16 kHz mono float32, without an external ffmpeg binary.
"""

from __future__ import annotations

import io

import av
import numpy as np

SAMPLE_RATE = 16_000


class DecodeError(Exception):
    """Raised when the input bytes cannot be decoded as audio."""


def decode_to_mono_16k(data: bytes) -> np.ndarray:
    """Decode audio bytes to a 16 kHz mono float32 numpy array.

    Raises DecodeError for anything FFmpeg cannot open or that contains no
    audio stream.
    """
    if not data:
        raise DecodeError("empty file")
    chunks: list[np.ndarray] = []
    try:
        with av.open(io.BytesIO(data)) as container:
            audio_streams = [s for s in container.streams if s.type == "audio"]
            if not audio_streams:
                raise DecodeError("no audio stream found")
            stream = audio_streams[0]
            # "flt" = packed float32; mono output means shape (1, n) frames.
            resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
            for frame in container.decode(stream):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            # Flush the resampler's internal buffer.
            for out in resampler.resample(None):
                chunks.append(out.to_ndarray().reshape(-1))
    except DecodeError:
        raise
    except Exception as e:  # av raises many error types; all mean "bad input" here
        raise DecodeError(str(e)) from e
    if not chunks:
        raise DecodeError("decoded zero audio samples")
    return np.concatenate(chunks).astype(np.float32, copy=False)


def concatenate(waveforms: list[np.ndarray]) -> np.ndarray:
    """Join per-file waveforms into one global timeline (recording order)."""
    if len(waveforms) == 1:
        return waveforms[0]
    return np.concatenate(waveforms)
