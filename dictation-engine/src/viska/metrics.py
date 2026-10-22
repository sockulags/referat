"""Mätning av hur lång tid en diktering faktiskt tar.

Hela poängen med Viska är att den ska kännas snabb, och utan siffror går
det bara att gissa. Varje avslutad diktering loggas som en rad i
viska.log och läggs i en liten ring i minnet som Inställningar visar
medianen ur. Inget skrivs till disk utöver loggraden, och mätningen
innehåller bara tider och teckenantal — aldrig texten.
"""

import logging
import threading
import time
from collections import deque

log = logging.getLogger(__name__)

# Så många dikteringar ligger kvar i minnet för medianen. Nog för att en
# enstaka kall modelladdning inte ska färga siffran, litet nog att vara gratis.
WINDOW = 30

_lock = threading.Lock()
_runs: deque[dict] = deque(maxlen=WINDOW)


class Timer:
    """Stoppur i millisekunder. `with Timer() as t: ...` och sedan t.ms."""

    def __init__(self):
        self.ms = 0.0
        self._t0 = 0.0

    def __enter__(self) -> "Timer":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *_exc) -> None:
        self.ms = (time.perf_counter() - self._t0) * 1000

    def lap(self) -> float:
        """Millisekunder sedan starten, utan att stoppa."""
        return (time.perf_counter() - self._t0) * 1000


def record(
    audio_s: float,
    transcribe_ms: float,
    inject_ms: float,
    total_ms: float,
    chars: int,
    polish_ms: float = 0.0,
    live: bool = False,
    flow: bool = False,
) -> None:
    """total_ms mäts från att dikteringen stoppades till att texten står i
    appen — det är den väntan användaren upplever."""
    run = {
        "audio_s": audio_s,
        "transcribe_ms": transcribe_ms,
        "polish_ms": polish_ms,
        "inject_ms": inject_ms,
        "total_ms": total_ms,
        "chars": chars,
        "live": live,
        "flow": flow,
    }
    with _lock:
        _runs.append(run)
    log.info(
        "Diktering klar: %.1f s ljud → %d tecken på %.0f ms "
        "(transkribering %.0f ms, polering %.0f ms, inskrivning %.0f ms%s%s)",
        audio_s, chars, total_ms, transcribe_ms, polish_ms, inject_ms,
        ", live" if live else "", ", flow" if flow else "",
    )


def runs() -> list[dict]:
    with _lock:
        return list(_runs)


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def summary() -> str:
    """En rad för Inställningar. Tom sträng innan något mätts."""
    data = runs()
    if not data:
        return ""
    total = _sekunder(_median([r["total_ms"] for r in data]))
    trans = _sekunder(_median([r["transcribe_ms"] for r in data]))
    text = (
        f"{len(data)} dikteringar mätta: median {total} s från stopp till "
        f"text (varav {trans} s transkribering"
    )
    polished = [r["polish_ms"] for r in data if r["polish_ms"] > 0]
    if polished:
        text += f", {_sekunder(_median(polished))} s polering"
    return text + ")"


def _sekunder(ms: float) -> str:
    return f"{ms / 1000:.1f}".replace(".", ",")


def reset() -> None:
    with _lock:
        _runs.clear()
