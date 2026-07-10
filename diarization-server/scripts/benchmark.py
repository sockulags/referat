"""Benchmark pyannote diarization pipelines on a synthetic Swedish meeting.

Generates a two-speaker dialogue with Piper TTS (one voice model, two distinct
speakers: B gets a different length scale plus a ~18 % pitch shift via sample
rate reinterpretation), keeps the ground-truth turn boundaries, then runs the
candidate pipelines and scores them.

Metric: fraction of ground-truth speech time attributed to the wrong speaker
after optimal 2-speaker label mapping (missed speech counts as wrong).

Usage:
    uv run python scripts/benchmark.py [--out-dir DIR] [--device cuda|cpu]

Outputs in --out-dir (default scripts/out):
    test-meeting.wav          16 kHz mono test audio
    test-meeting-truth.json   ground-truth turns {start, end, speaker}
    test-meeting-script.json  the dialogue script [{speaker, text}]
    benchmark-results.json    per-model error and wall-clock time
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

PIPER_EXE = Path(r"C:\Users\lucas\Code\kontenta\tools\piper\piper.exe")
PIPER_VOICE = Path(r"C:\Users\lucas\Code\kontenta\models\sv_SE-nst-medium.onnx")

SAMPLE_RATE = 16_000
PAUSE_SEC = 0.7
# Speaker B: slower speech rate from Piper, then pitch-shifted up ~18 % by
# reinterpreting the sample rate (which also speeds it back up a bit).
B_LENGTH_SCALE = 1.25
B_PITCH_FACTOR = 1.18

MODELS = [
    "pyannote/speaker-diarization-community-1",
    "pyannote/speaker-diarization-3.1",
]

DIALOGUE = [
    ("S1", "God morgon allihopa, då kör vi igång dagens avstämning."),
    ("S2", "Tack. Jag kan börja med en kort lägesrapport från utvecklingsteamet."),
    ("S1", "Gärna det. Hur ligger vi till med releasen?"),
    ("S2", "Vi är nästan klara. Två buggar återstår, men båda har kända lösningar."),
    ("S1", "Bra. Hinner vi testa klart innan fredag, tror du?"),
    ("S2", "Ja, om ingenting oväntat dyker upp så är testningen klar på torsdag."),
    ("S1", "Perfekt. Då tar jag med det till styrgruppen i eftermiddag."),
    ("S2", "En sak till: vi behöver besluta om budgeten för nästa kvartal."),
    ("S1", "Det stämmer. Jag föreslår att vi bokar ett separat möte om det på måndag."),
    ("S2", "Det låter rimligt. Jag skickar en kallelse direkt efter det här mötet."),
    ("S1", "Toppen. Har någon övriga frågor innan vi avslutar?"),
    ("S2", "Ingenting från min sida. Tack allihopa, vi hörs på måndag."),
]


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        n = w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype=np.int16)
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels()).mean(axis=1).astype(np.int16)
    return data.astype(np.float32) / 32768.0, rate


def write_wav(path: Path, samples: np.ndarray, rate: int = SAMPLE_RATE) -> None:
    ints = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(ints.tobytes())


def piper_say(text: str, out_wav: Path, length_scale: float | None = None) -> None:
    cmd = [str(PIPER_EXE), "--model", str(PIPER_VOICE), "--output_file", str(out_wav)]
    if length_scale is not None:
        cmd += ["--length_scale", str(length_scale)]
    subprocess.run(
        cmd,
        input=text.encode("utf-8"),
        check=True,
        capture_output=True,
    )


def resample_linear(samples: np.ndarray, src_rate: float, dst_rate: int) -> np.ndarray:
    n_out = int(round(len(samples) * dst_rate / src_rate))
    src_pos = np.arange(n_out) * (src_rate / dst_rate)
    return np.interp(src_pos, np.arange(len(samples)), samples).astype(np.float32)


def trim_silence(samples: np.ndarray, rate: int, threshold: float = 3e-3) -> np.ndarray:
    """Trim leading/trailing near-silence so ground-truth turns hug the speech."""
    loud = np.flatnonzero(np.abs(samples) > threshold)
    if len(loud) == 0:
        return samples
    margin = int(0.05 * rate)
    start = max(0, loud[0] - margin)
    end = min(len(samples), loud[-1] + margin)
    return samples[start:end]


def synthesize_utterance(speaker: str, text: str, tmp: Path) -> np.ndarray:
    """Return a 16 kHz mono float32 utterance for the given speaker."""
    out = tmp / "utt.wav"
    if speaker == "S1":
        piper_say(text, out)
        samples, rate = read_wav(out)
        samples = resample_linear(samples, rate, SAMPLE_RATE)
    else:
        piper_say(text, out, length_scale=B_LENGTH_SCALE)
        samples, rate = read_wav(out)
        # Pitch shift: pretend the audio was recorded at a higher rate, then
        # resample to 16 kHz. Raises pitch (and speeds up) by B_PITCH_FACTOR.
        samples = resample_linear(samples, rate * B_PITCH_FACTOR, SAMPLE_RATE)
    return trim_silence(samples, SAMPLE_RATE)


def build_test_audio(out_dir: Path) -> tuple[np.ndarray, list[dict]]:
    """Synthesize the dialogue; return (waveform, ground-truth turns)."""
    pieces: list[np.ndarray] = []
    truth: list[dict] = []
    pause = np.zeros(int(PAUSE_SEC * SAMPLE_RATE), dtype=np.float32)
    cursor = 0.0
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        for speaker, text in DIALOGUE:
            samples = synthesize_utterance(speaker, text, tmp)
            dur = len(samples) / SAMPLE_RATE
            truth.append({"start": round(cursor, 3), "end": round(cursor + dur, 3), "speaker": speaker})
            pieces.append(samples)
            pieces.append(pause)
            cursor += dur + PAUSE_SEC
    waveform = np.concatenate(pieces)
    write_wav(out_dir / "test-meeting.wav", waveform)
    (out_dir / "test-meeting-truth.json").write_text(
        json.dumps({"turns": truth, "speakers": 2}, indent=2), encoding="utf-8"
    )
    (out_dir / "test-meeting-script.json").write_text(
        json.dumps([{"speaker": s, "text": t} for s, t in DIALOGUE], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return waveform, truth


FRAME = 0.01  # 10 ms scoring resolution


def frame_labels(turns: list[dict], total: float) -> np.ndarray:
    """Rasterize turns to per-frame integer labels (0 = no speech)."""
    labels = sorted({t["speaker"] for t in turns})
    index = {lab: i + 1 for i, lab in enumerate(labels)}
    arr = np.zeros(int(np.ceil(total / FRAME)), dtype=np.int32)
    for t in turns:
        a, b = int(round(t["start"] / FRAME)), int(round(t["end"] / FRAME))
        arr[a:b] = index[t["speaker"]]
    return arr


def wrong_speaker_fraction(truth: list[dict], hyp: list[dict], total: float) -> dict:
    """Score hypothesis turns against ground truth on 10 ms frames.

    Returns fractions of ground-truth speech time:
      error     - not credited to the right speaker (miss + confusion)
      miss      - no hypothesis speaker at all (mostly silence padding inside
                  ground-truth turns; harmless for transcript merging)
      confusion - credited to the WRONG speaker after optimal label mapping
                  (the number that actually hurts "who said what")
    """
    gt = frame_labels(truth, total)
    hy = frame_labels(hyp, total)
    n = min(len(gt), len(hy))
    gt, hy = gt[:n], hy[:n]
    speech = gt > 0
    gt_ids = sorted(set(gt[speech].tolist()))
    hy_ids = sorted(set(hy[hy > 0].tolist()))
    # Optimal injective mapping hyp -> truth, brute force (both sets are tiny).
    from itertools import permutations

    best_correct = 0
    k = len(gt_ids)
    candidates = hy_ids + [0] * k  # allow leaving truth speakers unmatched
    for perm in set(permutations(candidates, k)):
        correct = 0
        for gt_id, hy_id in zip(gt_ids, perm):
            if hy_id:
                correct += int(np.sum(speech & (gt == gt_id) & (hy == hy_id)))
        best_correct = max(best_correct, correct)
    total_speech = int(np.sum(speech))
    if not total_speech:
        return {"error": 0.0, "miss": 0.0, "confusion": 0.0}
    miss = int(np.sum(speech & (hy == 0)))
    error = 1.0 - best_correct / total_speech
    return {
        "error": error,
        "miss": miss / total_speech,
        "confusion": error - miss / total_speech,
    }


def run_model(model: str, waveform: np.ndarray, device: str) -> tuple[list[dict], float, float]:
    """Return (turns, load_seconds, inference_seconds)."""
    import torch
    from pyannote.audio import Pipeline

    t0 = time.monotonic()
    pipeline = Pipeline.from_pretrained(model)
    pipeline.to(torch.device(device))
    load_s = time.monotonic() - t0

    tensor = torch.from_numpy(waveform).unsqueeze(0)
    t0 = time.monotonic()
    result = pipeline({"waveform": tensor, "sample_rate": SAMPLE_RATE})
    infer_s = time.monotonic() - t0

    annotation = getattr(result, "speaker_diarization", result)
    mapping: dict[str, str] = {}
    turns = []
    for segment, _track, label in annotation.itertracks(yield_label=True):
        if label not in mapping:
            mapping[label] = f"S{len(mapping) + 1}"
        turns.append(
            {"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "speaker": mapping[label]}
        )
    del pipeline
    if device == "cuda":
        torch.cuda.empty_cache()
    return turns, load_s, infer_s


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).parent / "out")
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--skip-models", action="store_true", help="only generate the test audio")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print("Synthesizing test dialogue with Piper ...")
    waveform, truth = build_test_audio(args.out_dir)
    total = len(waveform) / SAMPLE_RATE
    print(f"  {len(DIALOGUE)} utterances, {total:.1f} s -> {args.out_dir / 'test-meeting.wav'}")
    if args.skip_models:
        return

    results = {}
    for model in MODELS:
        print(f"\nRunning {model} on {args.device} ...")
        turns, load_s, infer_s = run_model(model, waveform, args.device)
        score = wrong_speaker_fraction(truth, turns, total)
        speakers = len({t["speaker"] for t in turns})
        results[model] = {
            "error_pct": round(score["error"] * 100, 2),
            "miss_pct": round(score["miss"] * 100, 2),
            "confusion_pct": round(score["confusion"] * 100, 2),
            "inference_seconds": round(infer_s, 2),
            "load_seconds": round(load_s, 2),
            "speakers_found": speakers,
            "turns": len(turns),
            "hypothesis": turns,
        }
        print(
            f"  error {score['error'] * 100:.2f} % "
            f"(miss {score['miss'] * 100:.2f} %, confusion {score['confusion'] * 100:.2f} %) | "
            f"inference {infer_s:.2f} s (load {load_s:.1f} s) | "
            f"{speakers} speakers, {len(turns)} turns"
        )

    (args.out_dir / "benchmark-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults written to {args.out_dir / 'benchmark-results.json'}")
    winner = min(
        results,
        key=lambda m: (results[m]["confusion_pct"], results[m]["error_pct"], results[m]["inference_seconds"]),
    )
    print(f"Winner: {winner}")


if __name__ == "__main__":
    main()
