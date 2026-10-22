"""Inklistringens klippbordshantering.

De första testerna är ren logik. De sista använder Windows riktiga
klippbord med en separat läsarprocess och lägger tillbaka det som låg där
före testet.
"""

import subprocess
import sys
import threading
import time

import pytest
import win32clipboard
import win32con

from viska import inject

READER = (
    "import sys, win32clipboard as w, win32con\n"
    "sys.stdin.readline()\n"
    "w.OpenClipboard()\n"
    "try:\n"
    "    text = w.GetClipboardData(win32con.CF_UNICODETEXT)\n"
    "finally:\n"
    "    w.CloseClipboard()\n"
    "sys.stdout.buffer.write(text.encode('utf-8'))\n"
)


# -- Logik ---------------------------------------------------------------------


def test_bara_malprogrammets_lasning_raknas():
    offer = inject._Offer("hej", target_pid=42)
    offer.rendered_for(7)  # en klippbordsövervakare hann först
    assert not offer.read_by_target.is_set()
    assert offer.rendered_by == 7
    offer.rendered_for(42)
    assert offer.read_by_target.is_set()
    assert offer.rendered_by == 7


def test_okant_mal_raknas_aldrig_som_last():
    offer = inject._Offer("hej", target_pid=None)
    offer.rendered_for(None)
    assert not offer.read_by_target.is_set()


def test_vantan_slutar_nar_malet_har_last():
    offer = inject._Offer("hej", target_pid=1)
    threading.Timer(0.05, offer.rendered_for, args=(1,)).start()
    started = time.monotonic()
    inject._wait_until_read(offer, 2.0)
    assert time.monotonic() - started < 0.5


def test_utan_lofte_vantar_hela_marginalen():
    # perf_counter: time.monotonic går i steg om ~16 ms på Windows.
    started = time.perf_counter()
    inject._wait_until_read(None, 0.2)
    assert time.perf_counter() - started >= 0.19


# -- Riktiga klippbordet --------------------------------------------------------


def _read_text() -> str | None:
    # Andra program håller klippbordet en kort stund ibland; försök igen
    # som Viska själv gör i stället för att fallera på första försöket.
    assert inject._open_clipboard(), "klippbordet var upptaget i 0,5 s"
    try:
        if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        return None
    finally:
        win32clipboard.CloseClipboard()


@pytest.fixture
def saved_clipboard():
    before = inject._snapshot_clipboard()
    yield
    if before is not None:
        inject._restore_snapshot(before)


def _start_reader():
    return subprocess.Popen(
        [sys.executable, "-c", READER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )


def test_fordrojd_text_kommer_fram_till_lasaren(saved_clipboard):
    reader = _start_reader()
    offer = inject._delayed.offer("Hej från Viska – åäö", reader.pid)
    assert offer is not None
    out, _ = reader.communicate(b"\n", timeout=10)
    assert out.decode("utf-8") == "Hej från Viska – åäö"


def test_malprogrammets_lasning_syns(saved_clipboard):
    reader = _start_reader()
    offer = inject._delayed.offer("signal", reader.pid)
    assert offer is not None
    time.sleep(0.2)  # ge en eventuell klippbordsövervakare tid att läsa först
    reader.communicate(b"\n", timeout=10)
    if offer.rendered_by not in (None, reader.pid):
        pytest.skip(
            f"en klippbordsövervakare (pid {offer.rendered_by}) läste först; "
            "då återstår den fasta marginalen"
        )
    assert offer.read_by_target.wait(2)


def test_nytt_innehall_slapper_vantan(saved_clipboard):
    offer = inject._delayed.offer("gammalt", target_pid=None)
    assert offer is not None
    inject._set_clipboard_text("nytt")
    assert offer.read_by_target.wait(1)
    assert _read_text() == "nytt"


# -- Ögonblicksbild av hela klippbordet ------------------------------------------


def _set_formats(items):
    assert inject._open_clipboard()
    try:
        win32clipboard.EmptyClipboard()
        for fmt, data in items:
            win32clipboard.SetClipboardData(fmt, data)
    finally:
        win32clipboard.CloseClipboard()


def _formats_now() -> dict[int, bytes]:
    snap = inject._snapshot_clipboard()
    return dict(snap.items)


def test_bild_och_eget_format_kommer_tillbaka(saved_clipboard):
    custom = win32clipboard.RegisterClipboardFormat("Viska Testformat")
    # En liten men giltig DIB: BITMAPINFOHEADER för 1×1 px, 32 bitar.
    header = (40).to_bytes(4, "little") + (1).to_bytes(4, "little") * 2
    header += (1).to_bytes(2, "little") + (32).to_bytes(2, "little")
    header += bytes(24)
    dib = header + bytes([0x10, 0x20, 0x30, 0x00])
    _set_formats([(win32con.CF_DIB, dib), (custom, b"hemligt innehall")])

    snap = inject._snapshot_clipboard()
    assert snap.complete
    inject._set_clipboard_text("dikterad text")
    inject._restore_snapshot(snap)

    now = _formats_now()
    assert now[custom].startswith(b"hemligt innehall")
    assert now[win32con.CF_DIB].startswith(dib)
    assert _read_text() is None  # ingen dikterad text kvar


def test_tomt_klippbord_blir_tomt_igen(saved_clipboard):
    _set_formats([])
    snap = inject._snapshot_clipboard()
    assert snap.items == []
    inject._set_clipboard_text("dikterad text")
    inject._restore_snapshot(snap)
    assert _read_text() is None


def test_text_sparas_forst_nar_tiden_tar_slut(saved_clipboard, monkeypatch):
    custom = win32clipboard.RegisterClipboardFormat("Viska Langsamt format")
    _set_formats([(custom, b"stort"), (win32con.CF_UNICODETEXT, "viktig text")])
    real_read = inject._read_format

    def slow_read(fmt):
        time.sleep(inject._SNAPSHOT_BUDGET_S + 0.05)
        return real_read(fmt)

    monkeypatch.setattr(inject, "_read_format", slow_read)
    snap = inject._snapshot_clipboard()
    assert not snap.complete
    assert [fmt for fmt, _ in snap.items] == [win32con.CF_UNICODETEXT]
