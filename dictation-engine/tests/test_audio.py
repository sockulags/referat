"""Mikrofoninspelningen mot en falsk ljudström: inget ljudkort behövs.

Den falska strömmen levererar ett block i taget från en egen tråd, precis
som PortAudio, och varje block bär sitt löpnummer som samplevärde så att
testerna kan se exakt vilka block som kom med i inspelningen.
"""

import threading
import time

import numpy as np
import pytest

from viska import audio


class FakeStream:
    """Levererar block i realtidstakt tills den stoppas."""

    instances: list["FakeStream"] = []
    silent = False  # ett headset som byter läge levererar tystnad

    def __init__(self, *, callback, blocksize, **_kwargs):
        self._callback = callback
        self._blocksize = blocksize
        self._running = threading.Event()
        self._thread = None
        self.sent = 0
        FakeStream.instances.append(self)

    def start(self):
        self._running.set()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        period = self._blocksize / audio.SAMPLE_RATE
        while self._running.is_set():
            time.sleep(period)
            if not self._running.is_set():
                break
            self.sent += 1
            value = 0.0 if FakeStream.silent else float(self.sent)
            block = np.full((self._blocksize, 1), value, dtype=np.float32)
            self._callback(block, self._blocksize, None, None)

    def stop(self):
        self._running.clear()
        if self._thread is not None:
            self._thread.join(timeout=1)

    def close(self):
        pass


@pytest.fixture(autouse=True)
def fake_stream(monkeypatch):
    FakeStream.instances.clear()
    FakeStream.silent = False
    monkeypatch.setattr(audio.sd, "InputStream", FakeStream)
    yield
    for stream in FakeStream.instances:
        stream.stop()


def _block_numbers(samples: np.ndarray) -> list[int]:
    return [int(v) for v in samples[:: audio.BLOCK]]


def test_stopp_tar_med_svansen_efter_slappet():
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0.12)
    rec.start()
    time.sleep(0.3)
    stream = FakeStream.instances[-1]
    released_at = stream.sent
    samples = rec.stop()

    numbers = _block_numbers(samples)
    assert numbers == list(range(1, len(numbers) + 1)), "inga block får tappas"
    tail_blocks = numbers[-1] - released_at
    # 0,12 s efter släppet är minst två 50 ms-block till.
    assert tail_blocks >= 2


def test_stopp_utan_svans_tar_bara_det_som_kommit():
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    rec.start()
    time.sleep(0.2)
    stream = FakeStream.instances[-1]
    released_at = stream.sent
    samples = rec.stop()
    assert _block_numbers(samples)[-1] <= released_at + 1


def test_tyst_strom_hanger_inte_stoppet():
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0.12)
    rec.start()
    time.sleep(0.1)
    FakeStream.instances[-1].stop()  # enheten försvann
    started = time.monotonic()
    rec.stop()
    assert time.monotonic() - started < 0.5


def test_closed_stanger_strommen_efter_stopp():
    rec = audio.Recorder(mode=audio.CLOSED)
    rec.start()
    assert rec.stream_open
    rec.stop()
    assert not rec.stream_open


def test_on_demand_haller_strommen_oppen_tills_tiden_gatt():
    rec = audio.Recorder(mode=audio.ON_DEMAND, idle_close_s=0.2, tail_s=0)
    rec.start()
    rec.stop()
    assert rec.stream_open
    time.sleep(0.4)
    assert not rec.stream_open


def test_forstart_finns_bara_nar_strommen_redan_var_oppen():
    rec = audio.Recorder(mode=audio.ALWAYS, preroll_s=0.25, tail_s=0)
    time.sleep(0.4)
    stream = FakeStream.instances[-1]
    before = stream.sent
    rec.start()
    samples = rec.stop()
    rec.close()
    numbers = _block_numbers(samples)
    # Förstarten är block som kom före start() — högst 0,25 s bakåt.
    assert numbers[0] <= before
    assert before - numbers[0] < round(0.25 * audio.SAMPLE_RATE / audio.BLOCK)


def test_start_talar_om_nar_strommen_just_oppnades():
    rec = audio.Recorder(mode=audio.ON_DEMAND, idle_close_s=5, tail_s=0)
    assert rec.start() is True
    rec.stop()
    assert rec.start() is False  # fortfarande varm
    rec.stop()
    rec.close()


def test_headset_stangs_direkt_aven_i_on_demand():
    rec = audio.Recorder(
        mode=audio.ON_DEMAND, idle_close_s=5, tail_s=0, close_now=lambda: True
    )
    rec.start()
    rec.stop()
    assert not rec.stream_open


def test_vantar_pa_riktigt_ljud():
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    rec.start()
    assert rec.wait_for_audio(1.0)
    rec.stop()


def test_tystnad_fran_headsetet_ger_tidsgrans():
    FakeStream.silent = True
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    rec.start()
    started = time.monotonic()
    assert not rec.wait_for_audio(0.3)
    assert time.monotonic() - started < 0.6
    rec.stop()


def test_ny_mikrofon_laser_in_enheterna_pa_nytt(monkeypatch):
    signatures = iter([("a",), ("a",), ("a", "headset")])
    monkeypatch.setattr(audio.mics, "endpoint_signature", lambda: next(signatures))
    resets = []
    monkeypatch.setattr(audio.Recorder, "_reset_portaudio", staticmethod(lambda: resets.append(1)))
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    for _ in range(3):
        rec.start()
        rec.stop()
    assert resets == [1]  # bara när headsetet dök upp


def test_wasapi_far_gora_om_ljudet_till_16_khz(monkeypatch):
    # AUDCLNT_E_UNSUPPORTED_FORMAT kommer först när strömmen startar.
    opened = []

    class PickyStream(FakeStream):
        def __init__(self, **kwargs):
            opened.append("extra_settings" in kwargs)
            self._auto = "extra_settings" in kwargs
            super().__init__(**kwargs)

        def start(self):
            if not self._auto:
                raise audio.sd.PortAudioError("AUDCLNT_E_UNSUPPORTED_FORMAT")
            super().start()

    monkeypatch.setattr(audio.sd, "InputStream", PickyStream)
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    rec.start()
    rec.stop()
    assert opened == [True]


def test_standardenheten_oppnas_utan_wasapi_installning(monkeypatch):
    opened = []

    class MmeStream(FakeStream):
        def __init__(self, **kwargs):
            opened.append("extra_settings" in kwargs)
            if "extra_settings" in kwargs:
                raise audio.sd.PortAudioError("Incompatible host API specific stream info")
            super().__init__(**kwargs)

    monkeypatch.setattr(audio.sd, "InputStream", MmeStream)
    rec = audio.Recorder(mode=audio.CLOSED, tail_s=0)
    rec.start()
    rec.stop()
    assert opened == [True, False]


def test_misslyckad_oppning_laser_in_enheterna_och_forsoker_igen(monkeypatch):
    resets = []
    monkeypatch.setattr(
        audio.Recorder, "_reset_portaudio", staticmethod(lambda: resets.append(1))
    )
    devices = iter([7, 9])
    tried = []

    class StaleStream(FakeStream):
        def __init__(self, *, device=None, **kwargs):
            tried.append(device)
            if not resets:
                raise ValueError("Multiple input devices found")
            super().__init__(**kwargs)

    monkeypatch.setattr(audio.sd, "InputStream", StaleStream)
    rec = audio.Recorder(input_device=lambda: next(devices), mode=audio.CLOSED, tail_s=0)
    rec.start()
    rec.stop()
    assert resets == [1]
    assert tried == [7, 7, 9]  # båda försöken med gamla listan, sedan ny enhet
