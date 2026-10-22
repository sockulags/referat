"""En modell, två slags arbete: diktering går före mötesljud.

Whisper-modellen kan bara göra en sak i taget, och ett anrop går inte att
avbryta halvvägs. Mötesljud skrivs därför ut i bitar på en halv minut, och
mellan bitarna släpps modellen till en diktering som väntar. En diktering
väntar då som mest på den bit som redan pågår.
"""

import threading
from contextlib import contextmanager


class PriorityGate:
    def __init__(self):
        self._cond = threading.Condition()
        self._busy = False
        self._high_waiting = 0

    @contextmanager
    def high(self):
        """Diktering: först in när modellen blir ledig."""
        with self._cond:
            self._high_waiting += 1
            try:
                while self._busy:
                    self._cond.wait()
            finally:
                self._high_waiting -= 1
            self._busy = True
        try:
            yield
        finally:
            self._release()

    @contextmanager
    def low(self):
        """Mötesljud: väntar så länge en diktering väntar eller pågår."""
        with self._cond:
            while self._busy or self._high_waiting:
                self._cond.wait()
            self._busy = True
        try:
            yield
        finally:
            self._release()

    def _release(self) -> None:
        with self._cond:
            self._busy = False
            self._cond.notify_all()
