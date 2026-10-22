"""Liveläget: vilka fraser som skrivs in under dikteringen och vilka som
bara förhandsvisas. En fras får skrivas in först när den följs av verklig
tystnad i ljudet, eftersom inskriven text aldrig kan ändras."""

from dataclasses import dataclass

import numpy as np

from viska.audio import SAMPLE_RATE
from viska.stream import LiveWorker


@dataclass
class Segment:
    text: str
    start: float
    end: float


def speech(seconds: float) -> np.ndarray:
    rng = np.random.default_rng(1)
    return (rng.standard_normal(int(seconds * SAMPLE_RATE)) * 0.05).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


class FakeRecorder:
    def __init__(self, audio: np.ndarray):
        self.audio = audio
        self.asked_from = []

    def snapshot(self, start_frame: int = 0) -> np.ndarray:
        self.asked_from.append(start_frame)
        return self.audio[start_frame:]


class FakeTranscriber:
    def __init__(self, segments, on_call=None):
        self.segments = segments
        self.on_call = on_call

    def transcribe_segments(self, audio, language, initial_prompt=None, beam_size=None):
        if self.on_call:
            self.on_call()
        return self.segments


def worker(audio, segments, **kwargs):
    commits, partials = [], []
    w = LiveWorker(
        FakeTranscriber(segments),
        FakeRecorder(audio),
        "sv",
        on_commit=commits.append,
        on_partial=partials.append,
        commit_silence_s=0.45,
        **kwargs,
    )
    return w, commits, partials


def test_fras_som_foljs_av_tystnad_skrivs_in():
    audio = np.concatenate([speech(1.0), silence(0.6), speech(0.8)])
    segments = [Segment(" hej Anna", 0.0, 1.0), Segment(" och sen", 1.6, 2.4)]
    w, commits, partials = worker(audio, segments)
    w._pass()
    assert commits == ["hej Anna"]
    assert w.committed_frames == SAMPLE_RATE
    assert partials == ["och sen"]


def test_fras_utan_paus_forhandsvisas_bara():
    audio = np.concatenate([speech(1.0), silence(0.2), speech(0.5)])
    w, commits, partials = worker(audio, [Segment("hej Anna", 0.0, 1.0)])
    w._pass()
    assert commits == []
    assert w.committed_frames == 0
    assert partials == ["hej Anna"]


def test_meningsslut_racker_med_kortare_paus():
    audio = np.concatenate([speech(1.0), silence(0.32), speech(0.5)])
    w, commits, _ = worker(audio, [Segment("Klart.", 0.0, 1.0)])
    w._pass()
    assert commits == ["Klart."]


def test_flodeslaget_skriver_aldrig_in():
    audio = np.concatenate([speech(1.0), silence(0.8)])
    w, commits, partials = worker(
        audio, [Segment("hej", 0.0, 1.0)], preview_only=True
    )
    w._pass()
    assert commits == []
    assert partials == ["hej"]


def test_stopp_under_transkriberingen_kastar_resultatet():
    audio = np.concatenate([speech(1.0), silence(0.8)])
    commits = []
    w = LiveWorker(
        None, FakeRecorder(audio), "sv", on_commit=commits.append,
        on_partial=lambda _p: None,
    )
    w.transcriber = FakeTranscriber(
        [Segment("hej", 0.0, 1.0)], on_call=w._stop.set
    )
    w._pass()
    assert commits == []
    assert w.committed_frames == 0


def test_misslyckad_inskrivning_skrivs_inte_in_igen():
    audio = np.concatenate([speech(1.0), silence(0.8)])

    def boom(_text):
        raise RuntimeError("inklistringen misslyckades")

    w = LiveWorker(
        FakeTranscriber([Segment("hej", 0.0, 1.0)]),
        FakeRecorder(audio),
        "sv",
        on_commit=boom,
        on_partial=lambda _p: None,
    )
    w._pass()
    assert w.committed_frames == SAMPLE_RATE  # ljudet räknas som förbrukat
    w._pass()
    assert w.recorder.asked_from[-1] == SAMPLE_RATE


def test_lang_monolog_utan_paus_skrivs_inte_in():
    audio = np.concatenate([speech(19.0), silence(1.0)])
    w, commits, partials = worker(audio, [Segment("lång text", 0.0, 11.0)])
    w._pass()
    assert commits == []
    assert partials == ["… lång text"]


def test_kort_eller_tyst_ljud_hoppas_over():
    w, commits, partials = worker(speech(0.4), [Segment("x", 0.0, 0.4)])
    w._pass()
    w2, commits2, partials2 = worker(silence(2.0), [Segment("x", 0.0, 1.0)])
    w2._pass()
    assert commits == partials == commits2 == partials2 == []
