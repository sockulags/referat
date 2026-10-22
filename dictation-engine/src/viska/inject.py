"""Skriver in text i det fönster som har fokus.

Primär metod: klippbordet + Ctrl+V. Snabbast oavsett textlängd och helt
säkert för svenska tecken. Dikteringen märks med Windows undantagsformat
så att den varken hamnar i Win+V-historiken eller synkas till
molnklippbordet — texten ska aldrig lämna datorn. Det gamla klippbordet
återställs efteråt, även när det var en bild, filer eller formaterad text.

Reservmetod ("type" i config): pynput skriver tecken för tecken via
SendInput/KEYEVENTF_UNICODE — för appar där Ctrl+V inte fungerar
(vissa terminaler och TUI-program).
"""

import atexit
import ctypes
import logging
import threading
import time
from ctypes import wintypes

import win32api
import win32clipboard
import win32con
import win32gui
import win32process

log = logging.getLogger(__name__)

user32 = ctypes.WinDLL("user32", use_last_error=True)

_clipboard_lock = threading.Lock()

# -- SendInput: Ctrl+V med layoutriktiga scankoder -----------------------------

ULONG_PTR = ctypes.c_size_t

INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
MAPVK_VK_TO_VSC = 0

VK_SHIFT = 0x10
VK_CONTROL = 0x11
VK_MENU = 0x12  # Alt
VK_LWIN = 0x5B
VK_RWIN = 0x5C
VK_V = 0x56
VK_C = 0x43


class KEYBDINPUT(ctypes.Structure):
    _fields_ = (
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    )


class MOUSEINPUT(ctypes.Structure):
    _fields_ = (
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    )


class _INPUTUNION(ctypes.Union):
    _fields_ = (("ki", KEYBDINPUT), ("mi", MOUSEINPUT))


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = (("type", wintypes.DWORD), ("u", _INPUTUNION))


def _key_input(vk: int, up: bool, scancode: bool = True) -> INPUT:
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    flags = KEYEVENTF_KEYUP if up else 0
    if scancode:
        inp.ki = KEYBDINPUT(
            0, user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC),
            flags | KEYEVENTF_SCANCODE, 0, 0,
        )
    else:
        inp.ki = KEYBDINPUT(vk, 0, flags, 0, 0)
    return inp


def _send_inputs(inputs: list[INPUT]) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    sent = user32.SendInput(len(arr), arr, ctypes.sizeof(INPUT))
    if sent != len(inputs):
        log.warning("SendInput skickade %d av %d händelser", sent, len(inputs))


def _send_ctrl_combo(vk: int) -> None:
    # Fysiskt nedtryckta modifierare (t.ex. om dikteringstangenten är en
    # kombination) skulle förvandla genvägen till en annan — släpp dem.
    for held in (VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN):
        if user32.GetAsyncKeyState(held) & 0x8000:
            _send_inputs([_key_input(held, up=True, scancode=False)])
    _send_inputs(
        [
            _key_input(VK_CONTROL, up=False),
            _key_input(vk, up=False),
            _key_input(vk, up=True),
            _key_input(VK_CONTROL, up=True),
        ]
    )


def _send_ctrl_v() -> None:
    _send_ctrl_combo(VK_V)


# -- Klippbordet ----------------------------------------------------------------

# Microsoft-dokumenterade format som håller innehållet borta från
# Win+V-historiken och molnklippbordssynk.
_PRIVACY_FORMATS = (
    "ExcludeClipboardContentFromMonitorProcessing",
    "CanIncludeInClipboardHistory",
    "CanUploadToCloudClipboard",
)


def _open_clipboard(retries: int = 50, delay: float = 0.01) -> bool:
    # Klippbordet är delat; cbdhsvc och andra appar håller det låst ibland.
    for _ in range(retries):
        try:
            win32clipboard.OpenClipboard()
            return True
        except Exception:
            time.sleep(delay)
    return False


def _get_clipboard_text() -> str | None:
    if not _open_clipboard():
        return None
    try:
        if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        return None
    except Exception:
        return None
    finally:
        win32clipboard.CloseClipboard()


# -- Ögonblicksbild av hela klippbordet ----------------------------------------
#
# Användarens klippbord ska tillbaka efter en inklistring även när det inte
# var text: en bild, kopierade filer, formaterad text från Word. Alla format
# som är vanliga minnesblock kopieras som bytes och sätts tillbaka likadant.
# Format som är GDI-handtag (bitmappar, metafiler, paletter) eller privata
# handtag går inte att kopiera så; Windows skapar de vanliga av dem på nytt
# ur DIB-formatet.
#
# Vissa program (Excel, Word) skapar sina format först när någon läser dem,
# vilket kan ta tid för stora markeringar. Ögonblicksbilden tar därför text,
# filer och bilder först och slutar efter en tidsgräns; det som hann sparas
# läggs tillbaka. Det är aldrig mindre än den text som sparades förut.

_SNAPSHOT_BUDGET_S = 0.15
_SNAPSHOT_LIMIT_BYTES = 64 * 1024 * 1024
_FIRST_FORMATS = (
    win32con.CF_UNICODETEXT,
    win32con.CF_HDROP,
    17,  # CF_DIBV5
    win32con.CF_DIB,
)
_HANDLE_FORMATS = {
    win32con.CF_BITMAP,
    win32con.CF_METAFILEPICT,
    win32con.CF_PALETTE,
    win32con.CF_ENHMETAFILE,
    win32con.CF_OWNERDISPLAY,
    win32con.CF_DSPBITMAP,
    win32con.CF_DSPMETAFILEPICT,
    win32con.CF_DSPENHMETAFILE,
}
_GMEM_MOVEABLE = 0x0002

_cb = ctypes.WinDLL("user32", use_last_error=True)
_cb.EnumClipboardFormats.argtypes = (wintypes.UINT,)
_cb.EnumClipboardFormats.restype = wintypes.UINT
_cb.GetClipboardData.argtypes = (wintypes.UINT,)
_cb.GetClipboardData.restype = wintypes.HANDLE
_cb.SetClipboardData.argtypes = (wintypes.UINT, wintypes.HANDLE)
_cb.SetClipboardData.restype = wintypes.HANDLE
_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
_k32.GlobalSize.argtypes = (wintypes.HGLOBAL,)
_k32.GlobalSize.restype = ctypes.c_size_t
_k32.GlobalLock.argtypes = (wintypes.HGLOBAL,)
_k32.GlobalLock.restype = ctypes.c_void_p
_k32.GlobalUnlock.argtypes = (wintypes.HGLOBAL,)
_k32.GlobalUnlock.restype = wintypes.BOOL
_k32.GlobalAlloc.argtypes = (wintypes.UINT, ctypes.c_size_t)
_k32.GlobalAlloc.restype = wintypes.HGLOBAL
_k32.GlobalFree.argtypes = (wintypes.HGLOBAL,)
_k32.GlobalFree.restype = wintypes.HGLOBAL


class _Snapshot:
    """Klippbordets format som (format, bytes). Tom lista = tomt klippbord."""

    def __init__(self, items: list[tuple[int, bytes]], complete: bool = True):
        self.items = items
        self.complete = complete


def _copyable(fmt: int) -> bool:
    # 0x200–0x3FF är privata format och GDI-objekt: handtag, inte minne.
    return fmt not in _HANDLE_FORMATS and not 0x200 <= fmt <= 0x3FF


def _snapshot_clipboard() -> "_Snapshot | None":
    """Hela klippbordet, eller None om det inte gick att öppna."""
    if not _open_clipboard():
        return None
    try:
        formats = []
        fmt = 0
        while True:
            fmt = _cb.EnumClipboardFormats(fmt)
            if not fmt:
                break
            if _copyable(fmt):
                formats.append(fmt)
        formats.sort(key=lambda f: (f not in _FIRST_FORMATS, _rank(f)))
        deadline = time.monotonic() + _SNAPSHOT_BUDGET_S
        items, total = [], 0
        for fmt in formats:
            if items and time.monotonic() > deadline:
                log.info(
                    "Klippbordet sparades bara delvis (%d av %d format): tidsgräns",
                    len(items), len(formats),
                )
                return _Snapshot(items, complete=False)
            data = _read_format(fmt)
            if data is None:
                continue
            total += len(data)
            if total > _SNAPSHOT_LIMIT_BYTES:
                log.info("Klippbordet är för stort för att sparas helt")
                return _Snapshot(items, complete=False)
            items.append((fmt, data))
        return _Snapshot(items)
    finally:
        win32clipboard.CloseClipboard()


def _rank(fmt: int) -> int:
    return _FIRST_FORMATS.index(fmt) if fmt in _FIRST_FORMATS else 0


def _read_format(fmt: int) -> bytes | None:
    """Anropas med klippbordet öppet."""
    handle = _cb.GetClipboardData(fmt)
    if not handle:
        return None
    size = _k32.GlobalSize(handle)
    if not size:
        return None
    ptr = _k32.GlobalLock(handle)
    if not ptr:
        return None
    try:
        return ctypes.string_at(ptr, size)
    finally:
        _k32.GlobalUnlock(handle)


def _restore_snapshot(snapshot: "_Snapshot") -> None:
    if not _open_clipboard():
        log.warning("Kunde inte öppna klippbordet för att återställa det")
        return
    try:
        win32clipboard.EmptyClipboard()
        for fmt, data in snapshot.items:
            handle = _k32.GlobalAlloc(_GMEM_MOVEABLE, max(len(data), 1))
            if not handle:
                continue
            ptr = _k32.GlobalLock(handle)
            if not ptr:
                _k32.GlobalFree(handle)
                continue
            ctypes.memmove(ptr, data, len(data))
            _k32.GlobalUnlock(handle)
            # Lyckas SetClipboardData äger Windows minnet; annars gör vi det.
            if not _cb.SetClipboardData(fmt, handle):
                _k32.GlobalFree(handle)
    finally:
        win32clipboard.CloseClipboard()


def _clear_clipboard() -> None:
    if not _open_clipboard():
        return
    try:
        win32clipboard.EmptyClipboard()
    finally:
        win32clipboard.CloseClipboard()


def _set_clipboard_text(text: str, private: bool = False) -> bool:
    if not _open_clipboard():
        log.warning("Kunde inte öppna klippbordet")
        return False
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
        if private:
            _mark_private()
        return True
    finally:
        win32clipboard.CloseClipboard()


def _mark_private() -> None:
    """Anropas med klippbordet öppet."""
    zero = (0).to_bytes(4, "little")
    for fmt in _PRIVACY_FORMATS:
        try:
            fmt_id = win32clipboard.RegisterClipboardFormat(fmt)
            win32clipboard.SetClipboardData(fmt_id, zero)
        except Exception:
            pass  # bäst ansträngning; inklistringen påverkas inte


def _foreground_pid() -> int | None:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    try:
        return win32process.GetWindowThreadProcessId(hwnd)[1]
    except Exception:
        return None


def _open_clipboard_as(hwnd, retries: int = 50, delay: float = 0.01) -> bool:
    for _ in range(retries):
        try:
            win32clipboard.OpenClipboard(hwnd)
            return True
        except Exception:
            time.sleep(delay)
    return False


# -- Fördröjd rendering: vet när målprogrammet har läst ----------------------
#
# Långsamma program (Electron, RDP) läser klippbordet en stund efter Ctrl+V.
# Skrivs det över innan dess klistras fel text in, så nästa inklistring och
# återställningen har fått vänta en fast marginal. Med fördröjd rendering
# lägger vi bara ut ett löfte om text; Windows ber oss om den
# (WM_RENDERFORMAT) när någon läser, och klippbordets fönster i det
# ögonblicket är läsarens. Läser programmet i förgrunden vet vi att
# inklistringen är hämtad och behöver inte vänta längre.
#
# Bara FÖRSTA läsningen syns: en klippbordsövervakare som läser före
# målprogrammet (fjärrskrivbordets klippbordsdelning, Ditto) får texten
# renderad åt sig, och målprogrammet läser sedan utan att vi märker det. Då
# återstår den fasta marginalen — aldrig sämre än utan fördröjd rendering.


class _Offer:
    """En utlagd text och vilken process som väntas läsa den."""

    def __init__(self, text: str, target_pid: int | None):
        self.text = text
        self.target_pid = target_pid
        self.rendered_by: int | None = None  # första läsaren, för loggen
        self.read_by_target = threading.Event()

    def rendered_for(self, reader_pid: int | None) -> None:
        if self.rendered_by is None:
            self.rendered_by = reader_pid
        if reader_pid is not None and reader_pid == self.target_pid:
            self.read_by_target.set()


class _DelayedClipboard:
    _CLASS = "ViskaClipboardOwner"

    def __init__(self):
        self._hwnd = None
        self._ready = threading.Event()
        self._start_lock = threading.Lock()
        self._offer_lock = threading.Lock()
        self._offer: _Offer | None = None
        self._set_data = None

    def _ensure_window(self) -> bool:
        with self._start_lock:
            if not self._ready.is_set():
                threading.Thread(
                    target=self._pump, daemon=True, name="viska-clipboard"
                ).start()
                self._ready.wait(2)
        return self._hwnd is not None

    def _pump(self) -> None:
        try:
            # pywin32 tolkar SetClipboardData(fmt, NULL) som ett fel, men
            # NULL är just hur fördröjd rendering begärs.
            set_data = ctypes.WinDLL("user32").SetClipboardData
            set_data.argtypes = (wintypes.UINT, wintypes.HANDLE)
            set_data.restype = wintypes.HANDLE
            self._set_data = set_data
            wc = win32gui.WNDCLASS()
            wc.lpfnWndProc = self._wndproc
            wc.lpszClassName = self._CLASS
            wc.hInstance = win32api.GetModuleHandle(None)
            try:
                win32gui.RegisterClass(wc)
            except Exception:
                pass  # redan registrerad (tester skapar flera ägare)
            self._hwnd = win32gui.CreateWindow(
                self._CLASS, "", 0, 0, 0, 0, 0,
                win32con.HWND_MESSAGE, 0, wc.hInstance, None,
            )
        except Exception:
            log.exception("Fördröjd klippbordsrendering är inte tillgänglig")
            self._hwnd = None
        finally:
            self._ready.set()
        if self._hwnd is not None:
            win32gui.PumpMessages()

    def offer(self, text: str, target_pid: int | None) -> "_Offer | None":
        """Lägger ut texten som ett löfte. None om det inte gick; anroparen
        sätter då texten direkt som förut."""
        if not self._ensure_window():
            return None
        if not _open_clipboard_as(self._hwnd):
            return None
        offer = _Offer(text, target_pid)
        try:
            win32clipboard.EmptyClipboard()  # gör vårt fönster till ägare
            with self._offer_lock:
                self._offer = offer
            self._set_data(win32con.CF_UNICODETEXT, None)
            _mark_private()
        finally:
            win32clipboard.CloseClipboard()
        return offer

    def flush(self) -> None:
        """Rendera ett obesvarat löfte innan processen avslutas, så att
        texten finns kvar för en inklistring som ännu inte hunnit läsa."""
        with self._offer_lock:
            offer = self._offer
        if offer is None or self._hwnd is None:
            return
        if not _open_clipboard_as(self._hwnd):
            return
        try:
            if win32clipboard.GetClipboardOwner() == self._hwnd:
                win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, offer.text)
        finally:
            win32clipboard.CloseClipboard()

    def _wndproc(self, hwnd, msg, wparam, lparam):
        if msg == win32con.WM_RENDERFORMAT:
            with self._offer_lock:
                offer = self._offer
            if offer is not None and wparam == win32con.CF_UNICODETEXT:
                # Läsaren har klippbordet öppet; datan sätts utan att vi
                # öppnar det själva. Den MÅSTE sättas — annars blir
                # inklistringen tom — så vem som läste är bara bonus.
                pid = None
                try:
                    reader = win32clipboard.GetOpenClipboardWindow()
                    pid = win32process.GetWindowThreadProcessId(reader)[1]
                except Exception:
                    pass
                try:
                    win32clipboard.SetClipboardData(
                        win32con.CF_UNICODETEXT, offer.text
                    )
                except Exception:
                    log.exception("Kunde inte rendera texten till klippbordet")
                offer.rendered_for(pid)
            return 0
        if msg == win32con.WM_RENDERALLFORMATS:
            self.flush()
            return 0
        if msg == win32con.WM_DESTROYCLIPBOARD:
            # Någon annan (eller vi själva) tog över klippbordet: löftet
            # gäller inte längre, och ingen ska vänta på det.
            with self._offer_lock:
                offer, self._offer = self._offer, None
            if offer is not None:
                offer.read_by_target.set()
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)


_delayed = _DelayedClipboard()
atexit.register(_delayed.flush)


# Generationsräknare för klippbordsåterställning: vid snabba dikteringar
# i följd ska bara den SISTA väntande återställningen köras, och den ska
# återställa användarens ursprungliga klippbord (sparat en gång) — inte en
# tidigare diktering.
_generation = 0
_saved_previous: "_Snapshot | None" = None
# Minsta tid mellan klippbordsskrivningar: långsamma appar (Electron, RDP)
# läser klippbordet asynkront efter Ctrl+V — skrivs det över för snabbt
# klistras fel text in. Samma marginal som återställningen använder.
_PASTE_SPACING_S = 0.8
_last_paste_t = 0.0
_last_offer: _Offer | None = None


# Osynlig avskiljare (U+2063) — dyker aldrig upp i riktig text.
_SENTINEL = "⁣viska-markering⁣"


def grab_selection(timeout_s: float = 0.6) -> str | None:
    """Hämtar markerad text i fokuserat fönster via Ctrl+C.

    Klippbordet sätts först till en vaktpost; ändras den inte inom
    tidsgränsen fanns ingen markering (originalet läggs då tillbaka
    direkt). Användarens ursprungliga klippbord sparas för den vanliga
    fördröjda återställningen efter inklistring.
    """
    global _generation, _saved_previous
    with _clipboard_lock:
        if _saved_previous is None:
            _saved_previous = _snapshot_clipboard()
        _generation += 1
        if not _set_clipboard_text(_SENTINEL, private=True):
            return None
        time.sleep(0.05)
        _send_ctrl_combo(VK_C)
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            time.sleep(0.05)
            text = _get_clipboard_text()
            if text is not None and text != _SENTINEL:
                return text
        # Ingen markering: lägg tillbaka det SPARADE originalet — inte
        # ögonblicksbilden från nyss, som kan vara en diktering vars
        # fördröjda återställning vi just avbröt via generationsräknaren.
        previous, _saved_previous = _saved_previous, None
        if previous is not None:
            _restore_snapshot(previous)
        else:
            _clear_clipboard()  # lämna aldrig kvar vaktposten
        return None


def restore_original_clipboard() -> None:
    """Läggs originalet tillbaka direkt (poleringen misslyckades)."""
    global _saved_previous
    with _clipboard_lock:
        previous, _saved_previous = _saved_previous, None
        if previous is not None:
            _restore_snapshot(previous)


def copy_to_clipboard(text: str) -> None:
    """Vanlig kopiering (traymenyns "Kopiera senaste diktering")."""
    global _generation, _saved_previous
    if text:
        with _clipboard_lock:
            _generation += 1  # avbryt väntande återställning
            _saved_previous = None
            _set_clipboard_text(text)


# -- Publikt API ------------------------------------------------------------------

def inject(text: str, mode: str = "paste", restore_clipboard: bool = True) -> None:
    if not text:
        return
    if mode == "type":
        _type(text)
        # Poleringen kan ha sparat originalet via grab_selection — typläget
        # rör inte klippbordet så det ska tillbaka nu (annars "återställer"
        # en senare diktering ett urgammalt värde). No-op vid diktering.
        restore_original_clipboard()
    else:
        _paste(text, restore_clipboard)


def _paste(text: str, restore: bool) -> None:
    global _generation, _saved_previous, _last_paste_t, _last_offer
    with _clipboard_lock:
        wait = _last_paste_t + _PASTE_SPACING_S - time.monotonic()
        if wait > 0:
            _wait_until_read(_last_offer, wait)
        _generation += 1
        generation = _generation
        if restore and _saved_previous is None:
            _saved_previous = _snapshot_clipboard()
        offer = _delayed.offer(text, _foreground_pid())
        _last_offer = offer
        if offer is None and not _set_clipboard_text(text, private=True):
            _type(text)  # klippbordet gick inte att ta – skriv i stället
            # Inklistringen uteblev: konsumera ev. sparat original direkt
            # (inuti låset — anropa inte restore_original_clipboard här).
            previous, _saved_previous = _saved_previous, None
            if previous is not None:
                _restore_snapshot(previous)
            return
        time.sleep(0.05)  # låt klippbordet sätta sig innan Ctrl+V
        _send_ctrl_v()
        _last_paste_t = time.monotonic()
    if restore:
        threading.Thread(
            target=_restore_later, args=(generation, offer), daemon=True
        ).start()


def _wait_until_read(offer: "_Offer | None", timeout: float) -> None:
    """Väntar tills målprogrammet har hämtat texten, högst timeout."""
    if offer is None:
        time.sleep(timeout)
    else:
        offer.read_by_target.wait(timeout)


def _restore_later(generation: int, offer: "_Offer | None" = None) -> None:
    global _saved_previous
    # Återställs klippbordet för tidigt hinner långsamma appar (Electron,
    # RDP) inte läsa det och inklistringen blir tom — vänta tills
    # målprogrammet har läst, eller rejält om det inte går att se.
    _wait_until_read(offer, _PASTE_SPACING_S)
    with _clipboard_lock:
        if generation != _generation:
            return  # en nyare diktering äger klippbordet nu
        previous, _saved_previous = _saved_previous, None
        if previous is not None:
            _restore_snapshot(previous)


def _type(text: str) -> None:
    # SendInput med KEYEVENTF_UNICODE via pynput: layoutoberoende, klarar åäö.
    from pynput.keyboard import Controller

    Controller().type(text)
