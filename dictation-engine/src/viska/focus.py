"""Vilken app har fokus? Används av per-app-profilerna: ordlista och
inskrivningssätt väljs utifrån programmet som ska ta emot texten.
Avläses vid inspelningsstart — det är dit texten kommer att skrivas.
"""

import logging

import win32api
import win32con
import win32gui
import win32process

log = logging.getLogger(__name__)


# Cache: processnamn (gemener) → visningsnamn (programmets FileDescription,
# eller processnamnet självt som fallback). Fylls när körande fönster räknas
# upp (running_apps) så inga upprepade versionsinfo-diskslag sker.
_NAME_CACHE: dict[str, str] = {}


def _windowed_processes() -> dict[str, str]:
    """Synliga, titelförsedda fönster mappade till {processnamn (gemener):
    exe-sökväg}. Deduplicerat på processnamn (första fönstret vinner). Viska
    själv utesluten. Nekad insyn (upphöjda fönster m.m.) hoppas bara över."""
    found: dict[str, str] = {}

    def cb(hwnd, _):
        try:
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
                handle = win32api.OpenProcess(
                    win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid
                )
                try:
                    path = win32process.GetModuleFileNameEx(handle, 0)
                finally:
                    win32api.CloseHandle(handle)
                found.setdefault(path.rsplit("\\", 1)[-1].lower(), path)
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(cb, None)
    except Exception:
        pass
    found.pop("viska.exe", None)
    return found


def _file_description(path: str) -> str | None:
    """Programmets FileDescription ur exe:ns versionsinfo, eller None när den
    saknas eller inte kan läsas. Kraschar aldrig."""
    try:
        lang, codepage = win32api.GetFileVersionInfo(
            path, "\\VarFileInfo\\Translation"
        )[0]
        key = "\\StringFileInfo\\%04x%04x\\FileDescription" % (lang, codepage)
        desc = (win32api.GetFileVersionInfo(path, key) or "").strip()
        return desc or None
    except Exception:
        return None


def _display_name_for_path(path: str) -> str:
    """Visningsnamn för en exe-sökväg: FileDescription, annars filnamnet."""
    return _file_description(path) or path.rsplit("\\", 1)[-1]


def visible_apps() -> list[str]:
    """Processnamn (gemener) för alla synliga fönster — manuell profilväljare."""
    return sorted(_windowed_processes())


def running_apps() -> list[tuple[str, str]]:
    """(processnamn, visningsnamn) för program med synliga fönster, sorterat på
    visningsnamn. Fyller namncachen på köpet så senare display_name-uppslag för
    samma appar blir gratis (inga upprepade diskslag)."""
    result = []
    for proc, path in _windowed_processes().items():
        name = _display_name_for_path(path)
        _NAME_CACHE[proc] = name
        result.append((proc, name))
    return sorted(result, key=lambda t: t[1].lower())


def display_name(process: str) -> str:
    """Användarvänligt namn för ett processnamn (t.ex. "code.exe" → "Visual
    Studio Code"), för visning där config annars visar det råa processnamnet.
    Config förblir nycklad på processnamnet — det här är bara presentation.

    Läser namncachen (fylld av running_apps); en miss faller tillbaka på
    processnamnet. Kraschar aldrig."""
    key = (process or "").strip().lower()
    return _NAME_CACHE.get(key) or process


# Fönsterklasser för konsoler: Ctrl+C utan markering blir SIGINT där och
# kan döda användarens körande process — poleringen vägrar hellre.
_TERMINAL_CLASSES = {"ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"}
_TERMINAL_APPS = {"mintty.exe", "alacritty.exe", "wezterm-gui.exe", "hyper.exe"}


def foreground_is_terminal() -> bool:
    try:
        hwnd = win32gui.GetForegroundWindow()
        if hwnd and win32gui.GetClassName(hwnd) in _TERMINAL_CLASSES:
            return True
    except Exception:
        pass
    return (foreground_app() or "") in _TERMINAL_APPS


def foreground_app() -> str | None:
    """Processnamn i gemener för fokuserat fönster, t.ex. "code.exe"."""
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        handle = win32api.OpenProcess(
            win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        try:
            path = win32process.GetModuleFileNameEx(handle, 0)
        finally:
            win32api.CloseHandle(handle)
        return path.rsplit("\\", 1)[-1].lower()
    except Exception:
        # Upphöjda fönster m.m. kan neka insyn — profilen hoppar då bara över.
        return None


def window_app_name(hwnd: int | None) -> str | None:
    """Visningsnamnet för programmet som äger fönstret ("Microsoft Outlook"),
    för historiken. None om fönstret är borta eller inte går att läsa."""
    if not hwnd:
        return None
    try:
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        handle = win32api.OpenProcess(
            win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        try:
            path = win32process.GetModuleFileNameEx(handle, 0)
        finally:
            win32api.CloseHandle(handle)
    except Exception:
        return None
    process = path.rsplit("\\", 1)[-1].lower()
    if process not in _NAME_CACHE:
        _NAME_CACHE[process] = _display_name_for_path(path)
    return _NAME_CACHE[process]


def foreground_window() -> int | None:
    """HWND för fokuserat fönster (eller None). Fryses vid inspelningsstart
    så flow-läget kan skriva tillbaka den polerade texten i rätt fönster
    även om användaren hunnit byta fokus medan poleringen pågick."""
    try:
        return win32gui.GetForegroundWindow() or None
    except Exception:
        return None


def focus_window(hwnd: int) -> bool:
    """Ser till att hwnd ligger i förgrunden inför en inskrivning. Har fokus
    inte flyttat (det vanliga i flow-läget, där dikteringen hålls kvar tills
    texten skrivits in) är det en no-op och ingen fokusstöld sker.

    SetForegroundWindow nekas normalt en bakgrundsapp; standardknepet är att
    tillfälligt koppla ihop inmatningskön med förgrundstråden så att bytet
    tillåts. Bäst ansträngning: misslyckas det skrivs texten ändå in i det
    fönster som råkar ha fokus (råversionen finns kvar i historiken)."""
    try:
        if win32gui.GetForegroundWindow() == hwnd:
            return True  # fokus kvar (det vanliga) — ingen fokusstöld
        if not win32gui.IsWindow(hwnd):
            return False  # fönstret stängt under poleringen
        cur_tid = win32api.GetCurrentThreadId()
        fg = win32gui.GetForegroundWindow()
        fg_tid = win32process.GetWindowThreadProcessId(fg)[0] if fg else 0
        attached = bool(fg_tid) and fg_tid != cur_tid
        if attached:
            try:
                win32process.AttachThreadInput(cur_tid, fg_tid, True)
            except Exception:
                attached = False
        try:
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            pass  # nekat trots knepet — inskrivningen faller tillbaka på fokus
        finally:
            if attached:
                try:
                    win32process.AttachThreadInput(cur_tid, fg_tid, False)
                except Exception:
                    pass
        ok = win32gui.GetForegroundWindow() == hwnd
        if not ok:
            log.warning("Kunde inte återställa fokus till målfönstret före inskrivning")
        return ok
    except Exception:
        log.exception("Fel vid fokusåterställning")
        return False
