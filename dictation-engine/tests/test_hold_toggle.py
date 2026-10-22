"""Håll- och växlingslogiken för dikteringstangenten.

Håll inne längre än tröskeln: inspelningen stoppar när tangenten släpps.
Kort tryck: inspelningen fortsätter tills nästa tryck. Tangenten är en
låtsad tangent, så testerna rör aldrig det riktiga tangentbordet.
"""

import threading
import time

from viska.hotkey import _HoldToggle

THRESHOLD = 0.1


class FakeKey(_HoldToggle):
    def __init__(self, start_result=True, mode="auto"):
        self.starts = 0
        self.stops = 0
        self.down = False
        self._start_result = start_result
        self.stopped = threading.Event()
        super().__init__(0x78, THRESHOLD, self._start, self._stop, mode)

    def _start(self):
        self.starts += 1
        return self._start_result

    def _stop(self):
        self.stops += 1
        self.stopped.set()

    def _is_down(self):
        return self.down

    def press(self):
        self.down = True
        self._on_trigger_down()

    def release(self):
        self.down = False


def test_hall_inne_stoppar_vid_slapp():
    key = FakeKey()
    key.press()
    time.sleep(THRESHOLD * 2)
    key.release()
    assert key.stopped.wait(1)
    assert (key.starts, key.stops) == (1, 1)


def test_kort_tryck_vaxlar_och_nasta_tryck_stoppar():
    key = FakeKey()
    key.press()
    key.release()
    time.sleep(THRESHOLD * 2)
    assert key.stops == 0  # inspelningen fortsätter
    key.press()
    key.release()
    assert (key.starts, key.stops) == (1, 1)


def test_hall_lage_stoppar_aven_efter_kort_tryck():
    key = FakeKey(mode="hold")
    key.press()
    key.release()
    assert key.stopped.wait(1)
    assert (key.starts, key.stops) == (1, 1)


def test_klicklage_fortsatter_hur_lange_knappen_an_halls():
    key = FakeKey(mode="toggle")
    key.press()
    time.sleep(THRESHOLD * 2)
    key.release()
    time.sleep(THRESHOLD)
    assert key.stops == 0  # släppet stoppar inte
    key.press()
    key.release()
    assert (key.starts, key.stops) == (1, 1)


def test_okant_lage_blir_auto():
    assert FakeKey(mode="dansa").mode == "auto"


def test_misslyckad_start_gor_nasta_tryck_till_ett_nytt_forsok():
    key = FakeKey(start_result=False)
    key.press()
    key.release()
    key.press()
    key.release()
    assert (key.starts, key.stops) == (2, 0)


def test_maxtid_tar_over_stoppet_en_gang():
    key = FakeKey()
    key.press()
    assert key.force_stop() is True  # anroparen äger nu stoppet
    assert key.force_stop() is False
    time.sleep(THRESHOLD * 2)
    key.release()
    time.sleep(0.1)
    assert key.stops == 0  # släppet stoppar inte en gång till


def test_stopp_och_start_far_aldrig_byta_ordning():
    """Nytt tryck medan ett stopp pågår: stoppet hinner klart först."""
    order = []
    in_stop = threading.Event()

    class SlowStop(FakeKey):
        def _stop(self):
            order.append("stopp börjar")
            in_stop.set()
            time.sleep(0.1)
            order.append("stopp klart")

        def _start(self):
            order.append("start")
            return True

    key = SlowStop()
    key.press()
    key.release()  # växlingsläge
    stopper = threading.Thread(target=key.press)
    stopper.start()
    in_stop.wait(1)
    key.press()  # tredje trycket, medan stoppet pågår
    stopper.join()
    assert order == ["start", "stopp börjar", "stopp klart", "start"]
