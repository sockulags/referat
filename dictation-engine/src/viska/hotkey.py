"""Global dikteringstangent via Win32 RegisterHotKey.

RegisterHotKey i stället för tangentbordshookar ('keyboard'/pynput) för att:
- den fungerar även när ett admin-fönster har fokus,
- tangenten konsumeras av OS:et så att appen i fokus aldrig ser den,
- den är opåverkad av svenskt tangentbordslayout (kända buggar i
  'keyboard'-biblioteket på icke-USA-layouter).

RegisterHotKey ger bara nedtryck; släpp detekteras genom att polla
GetAsyncKeyState — standardmönstret för push-to-talk på Windows.

Musknappar (mouse3/mouse4/mouse5) går inte att registrera den vägen alls, så
de fångas i stället med en låg-nivå-mushook (WH_MOUSE_LL) i MouseTrigger.
Hooken svälter knappen från appen under markören — annars hade mouse4 både
startat en diktering och backat i webbläsaren. Vänster och höger musknapp
går medvetet inte att välja: en svald vänsterklick gör datorn oanvändbar.

Hooken delar håll/växla-logik med tangentbordsvarianten genom _HoldToggle,
och släpp detekteras med samma GetAsyncKeyState-pollning (musknapparna har
egna virtuella koder, VK_MBUTTON/VK_XBUTTON1/VK_XBUTTON2). Använd
create_push_to_talk() i stället för att välja klass för hand.

Trådning: on_start/on_stop anropas alltid med det interna låset hållet,
vilket gör start/stopp exakt-en-gång och omöjliggör omkastad ordning
(stopp för session A efter start av session B). Callbackarna får därför
aldrig anropa tillbaka in i PushToTalk (utom force_stop, som är designad
för det via sitt returvärde i stället för återinträde).
"""

import ctypes
import logging
import threading
import time
from ctypes import wintypes

log = logging.getLogger(__name__)

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000

_MODS = {
    "alt": MOD_ALT,
    "ctrl": MOD_CONTROL,
    "control": MOD_CONTROL,
    "shift": MOD_SHIFT,
    "win": MOD_WIN,
    "windows": MOD_WIN,
}

# Musknappar: egna virtuella koder som GetAsyncKeyState känner till, men som
# RegisterHotKey inte tar emot. VK_LBUTTON/VK_RBUTTON saknas medvetet.
_MOUSE_VKS = {
    "mouse3": 0x04,  # VK_MBUTTON (hjulklick)
    "mouse4": 0x05,  # VK_XBUTTON1 (tumknappen "bakåt")
    "mouse5": 0x06,  # VK_XBUTTON2 (tumknappen "framåt")
    "middle mouse": 0x04,
    "hjulklick": 0x04,
}

# Låg-nivå-mushook.
WH_MOUSE_LL = 14
WM_MBUTTONDOWN = 0x0207
WM_MBUTTONUP = 0x0208
WM_MBUTTONDBLCLK = 0x0209
WM_XBUTTONDOWN = 0x020B
WM_XBUTTONUP = 0x020C
WM_XBUTTONDBLCLK = 0x020D
# Ett snabbt andra tryck kommer som DBLCLK i stället för DOWN — annars hade
# varannat tryck i växlingsläget försvunnit.
_MOUSE_DOWN = (WM_MBUTTONDOWN, WM_XBUTTONDOWN, WM_MBUTTONDBLCLK, WM_XBUTTONDBLCLK)
_MOUSE_UP = (WM_MBUTTONUP, WM_XBUTTONUP)
_MOUSE_SWALLOW = (
    WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MBUTTONDBLCLK,
    WM_XBUTTONDOWN, WM_XBUTTONUP, WM_XBUTTONDBLCLK,
)

_VKS = {
    **{f"f{i}": 0x6F + i for i in range(1, 25)},  # f1=0x70 … f24=0x87
    **{chr(c).lower(): c for c in range(0x41, 0x5B)},  # a–z
    **{chr(c): c for c in range(0x30, 0x3A)},  # 0–9
    "space": 0x20,
    "pause": 0x13,
    "caps lock": 0x14,
    "capslock": 0x14,
    "insert": 0x2D,
    "home": 0x24,
    "end": 0x23,
    "page up": 0x21,
    "page down": 0x22,
    "scroll lock": 0x91,
    "scrolllock": 0x91,
    **{f"num {i}": 0x60 + i for i in range(10)},
}


class HotkeyError(Exception):
    pass


# RegisterHotKey-id:n måste vara unika per tråd/process. Tidigare hade
# klasserna varsitt fast id, vilket tyst gick sönder så fort en tredje
# tangent (tonvalsmenyn) skulle registreras.
_id_lock = threading.Lock()
_next_id = 0


def _alloc_hotkey_id() -> int:
    global _next_id
    with _id_lock:
        _next_id += 1
        return _next_id


def is_mouse(hotkey: str) -> bool:
    """True om bindningen styrs av en musknapp (då krävs MouseTrigger)."""
    return any(part.strip() in _MOUSE_VKS for part in hotkey.lower().split("+"))


def parse_hotkey(hotkey: str) -> tuple[int, int]:
    mods = 0
    vk = None
    for part in hotkey.lower().split("+"):
        part = part.strip()
        if part in _MODS:
            mods |= _MODS[part]
        elif part in _MOUSE_VKS:
            if vk is not None:
                raise HotkeyError(f"Flera huvudtangenter i '{hotkey}'")
            vk = _MOUSE_VKS[part]
        elif part in _VKS:
            if vk is not None:
                raise HotkeyError(f"Flera huvudtangenter i '{hotkey}'")
            vk = _VKS[part]
        else:
            raise HotkeyError(f"Okänd tangent '{part}' i '{hotkey}'")
    if vk is None:
        raise HotkeyError(f"Ingen huvudtangent i '{hotkey}'")
    return mods, vk


MODES = ("auto", "hold", "toggle")

# Knappar som går att hålla in vid sidan av dikteringsknappen, och deras
# modifierare i RegisterHotKey.
_HELD_KEYS = {"ctrl": (0x11, MOD_CONTROL), "shift": (0x10, MOD_SHIFT)}


def key_held(name: str) -> bool:
    """Hålls Ctrl eller Shift nere just nu? False för okända namn."""
    key = _HELD_KEYS.get(name)
    return bool(key and user32.GetAsyncKeyState(key[0]) & 0x8000)


class _HoldToggle:
    """Håll/växla-logiken, delad av tangent- och musvarianten.

    mode "auto":
    - Kort tryck: börja spela in; nästa tryck stoppar.
    - Håll inne (längre än hold_threshold_s): spela in tills knappen släpps.
    mode "hold": inspelningen stoppar alltid när knappen släpps.
    mode "toggle": ett tryck startar, nästa stoppar, hur länge det än hålls.

    on_start ska returnera sant om en inspelning faktiskt startade; annars
    förblir knappen "inaktiv" och nästa tryck blir ett nytt startförsök i
    stället för ett stopp.

    Släppet detekteras genom att polla _is_down(): tangentvarianten frågar
    GetAsyncKeyState, musvarianten sitt eget hooktillstånd.
    """

    def __init__(
        self, vk: int, hold_threshold_s: float, on_start, on_stop, mode: str = "auto"
    ):
        self._vk = vk
        self.hold_threshold_s = hold_threshold_s
        self.mode = mode if mode in MODES else "auto"
        self.on_start = on_start
        self.on_stop = on_stop
        self._lock = threading.Lock()
        self._active = False

    def _on_trigger_down(self) -> None:
        watch_from = None
        with self._lock:
            if self._active:
                # Andra trycket i växlingsläge: stoppa.
                self._active = False
                self.on_stop()
                return
            # Mät hålltiden från nedtrycket — inte från när on_start är
            # klar (att öppna mikrofonen kan ta flera hundra ms).
            t0 = time.monotonic()
            started = False
            try:
                started = bool(self.on_start())
            finally:
                self._active = started
            if started:
                watch_from = t0
        if watch_from is not None and self.mode != "toggle":
            threading.Thread(
                target=self._watch_release,
                args=(watch_from,),
                daemon=True,
                name="viska-release",
            ).start()

    def _is_down(self) -> bool:
        return bool(user32.GetAsyncKeyState(self._vk) & 0x8000)

    def _watch_release(self, t0: float) -> None:
        while self._is_down():
            time.sleep(0.015)
        if self.mode == "auto" and time.monotonic() - t0 < self.hold_threshold_s:
            return  # kort tryck: växlingsläge, inspelningen fortsätter
        with self._lock:
            if not self._active:
                return  # redan stoppad (maxtid eller andra tryck)
            self._active = False
            self.on_stop()

    def force_stop(self) -> bool:
        """Avaktivera utifrån (t.ex. maxtid). Returnerar True om vi tog
        över en aktiv session — då, och bara då, äger anroparen stoppet."""
        with self._lock:
            was_active, self._active = self._active, False
            return was_active


class PushToTalk(_HoldToggle):
    """Håll/växla på en tangent, registrerad med RegisterHotKey.

    RegisterHotKey träffar bara exakt den kombinationen, så F9 med Ctrl nere
    är en annan tangent än F9. also_held ("ctrl"/"shift") registrerar därför
    kombinationen med den knappen också, så att dikteringen startar även när
    den hålls."""

    def __init__(
        self,
        hotkey: str,
        hold_threshold_s: float,
        on_start,
        on_stop,
        mode: str = "auto",
        also_held: str = "",
    ):
        self._HOTKEY_ID = _alloc_hotkey_id()
        self._mods, vk = parse_hotkey(hotkey)
        if is_mouse(hotkey):
            raise HotkeyError(
                f"'{hotkey}' är en musknapp – använd create_push_to_talk()"
            )
        extra = _HELD_KEYS.get(also_held, (0, 0))[1]
        self._extra_mods = self._mods | extra if extra and not self._mods & extra else 0
        self._EXTRA_ID = _alloc_hotkey_id() if self._extra_mods else None
        super().__init__(vk, hold_threshold_s, on_start, on_stop, mode)
        self._hotkey_str = hotkey
        self._tid = None
        self._ready = threading.Event()
        self._error = None
        self._thread = threading.Thread(
            target=self._message_loop, daemon=True, name="viska-hotkey"
        )
        self._thread.start()
        self._ready.wait(timeout=5)
        if self._error:
            raise HotkeyError(self._error)

    def _message_loop(self) -> None:
        self._tid = kernel32.GetCurrentThreadId()
        if not user32.RegisterHotKey(
            None, self._HOTKEY_ID, self._mods | MOD_NOREPEAT, self._vk
        ):
            self._error = (
                f"Dikteringstangenten '{self._hotkey_str.upper()}' är upptagen "
                f"av ett annat program (Win32-fel {ctypes.get_last_error()}). "
                "Byt den i Inställningar."
            )
            self._ready.set()
            return
        if self._EXTRA_ID is not None and not user32.RegisterHotKey(
            None, self._EXTRA_ID, self._extra_mods | MOD_NOREPEAT, self._vk
        ):
            # Dikteringen fungerar ändå; bara inte med knappen nere från start.
            log.warning(
                "Kunde inte registrera '%s' med extraknappen (Win32-fel %s)",
                self._hotkey_str, ctypes.get_last_error(),
            )
            self._EXTRA_ID = None
        self._ready.set()
        ids = {self._HOTKEY_ID, self._EXTRA_ID} - {None}
        msg = wintypes.MSG()
        try:
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == WM_HOTKEY and msg.wParam in ids:
                    try:
                        self._on_trigger_down()
                    except Exception:
                        # Får aldrig döda meddelandeloopen — då slutar
                        # tangenten fungera tyst (osynligt under pythonw).
                        log.exception("Fel i tangent-callback")
        finally:
            user32.UnregisterHotKey(None, self._HOTKEY_ID)
            if self._EXTRA_ID is not None:
                user32.UnregisterHotKey(None, self._EXTRA_ID)

    def stop(self) -> None:
        if self._tid:
            user32.PostThreadMessageW(self._tid, WM_QUIT, 0, 0)
            # Vänta in avregistreringen — annars kan en ny PushToTalk med
            # samma tangent få "upptagen" av vår egen gamla registrering.
            self._thread.join(timeout=2)


class ActionKey:
    """Enkel åtgärdstangent (t.ex. polering): ett callback per nedtryck,
    ingen håll/växla-logik. Egen tråd och eget hotkey-id så den samsas
    med dikteringstangenten.

    Anges on_double skiljs dessutom enkel- från dubbeltryck: ett andra
    tryck inom double_tap_s räknas som dubbeltryck (on_double), annars
    fördröjs enkeltrycket (on_press) tills fönstret gått ut så trycken
    kan skiljas åt. Det kostar double_tap_s på VARJE enkeltryck, så
    dubbeltrycket är numera avstängt som standard: tonvalsmenyn har en
    egen tangent i stället. Utan on_double körs on_press direkt vid varje
    nedtryck (noll extra fördröjning)."""

    def __init__(self, hotkey: str, on_press, on_double=None, double_tap_s: float = 0.4):
        self._HOTKEY_ID = _alloc_hotkey_id()
        self._mods, self._vk = parse_hotkey(hotkey)
        if is_mouse(hotkey):
            # Poleringen har inget håll-läge och delar därför inte
            # MouseTrigger; en musknapp här hade registrerats som skräp.
            raise HotkeyError("Poleringstangenten kan inte vara en musknapp")
        self._hotkey_str = hotkey
        self.on_press = on_press
        self.on_double = on_double
        self.double_tap_s = double_tap_s
        self._tid = None
        self._ready = threading.Event()
        self._error = None
        # Skyddar dubbeltrycksfönstret; enkeltrycket levereras från en Timer-
        # tråd medan dubbeltrycket levereras från meddelandeloopen.
        self._tap_lock = threading.Lock()
        self._pending = None  # Timer som väntar in ett eventuellt andra tryck
        self._thread = threading.Thread(
            target=self._message_loop, daemon=True, name="viska-actionkey"
        )
        self._thread.start()
        self._ready.wait(timeout=5)
        if self._error:
            raise HotkeyError(self._error)

    def _message_loop(self) -> None:
        self._tid = kernel32.GetCurrentThreadId()
        if not user32.RegisterHotKey(
            None, self._HOTKEY_ID, self._mods | MOD_NOREPEAT, self._vk
        ):
            self._error = (
                f"Tangenten '{self._hotkey_str.upper()}' är upptagen av ett "
                f"annat program (Win32-fel {ctypes.get_last_error()}). "
                "Byt den i Inställningar."
            )
            self._ready.set()
            return
        self._ready.set()
        msg = wintypes.MSG()
        try:
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == WM_HOTKEY and msg.wParam == self._HOTKEY_ID:
                    try:
                        self._on_hotkey_down()
                    except Exception:
                        log.exception("Fel i åtgärdstangentens callback")
        finally:
            user32.UnregisterHotKey(None, self._HOTKEY_ID)

    def _on_hotkey_down(self) -> None:
        if self.on_double is None:
            self.on_press()  # inget dubbeltryck att skilja på — kör direkt
            return
        fire_double = False
        with self._tap_lock:
            if self._pending is not None:
                # Andra trycket inom fönstret: dubbeltryck. Avbryt den
                # väntande enkeltryckstimern.
                self._pending.cancel()
                self._pending = None
                fire_double = True
            else:
                self._pending = threading.Timer(
                    self.double_tap_s, self._single_expired
                )
                self._pending.daemon = True
                self._pending.start()
        if fire_double:
            self.on_double()

    def _single_expired(self) -> None:
        # Timern gick ut utan ett andra tryck: det var ett enkeltryck.
        with self._tap_lock:
            if self._pending is None:
                return  # hann bli dubbeltryck (eller stoppades)
            self._pending = None
        try:
            self.on_press()
        except Exception:
            log.exception("Fel i åtgärdstangentens callback")

    def stop(self) -> None:
        with self._tap_lock:
            if self._pending is not None:
                self._pending.cancel()
                self._pending = None
        if self._tid:
            user32.PostThreadMessageW(self._tid, WM_QUIT, 0, 0)
            self._thread.join(timeout=2)


class _MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", wintypes.POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


_HOOKPROC = ctypes.WINFUNCTYPE(
    ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
)

# Utan argtypes tolkar ctypes lparam som c_int och kastar OverflowError på
# 64 bitar — pekaren till MSLLHOOKSTRUCT ryms inte i 32.
user32.SetWindowsHookExW.argtypes = [
    ctypes.c_int, _HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD
]
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.CallNextHookEx.argtypes = [
    wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
]
user32.CallNextHookEx.restype = ctypes.c_ssize_t
user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]


class MouseTrigger(_HoldToggle):
    """Håll/växla på en musknapp (mouse3/mouse4/mouse5) via WH_MOUSE_LL.

    Hookens callback måste återvända inom några hundra millisekunder, annars
    plockar Windows tyst bort hooken (LowLevelHooksTimeout). on_start kan ta
    längre än så (att öppna mikrofonen), så själva trycket lämnas över till en
    egen tråd medan hooken direkt svarar "svald". Ordningen bevaras av att
    trådarna serialiseras genom _HoldToggle:s lås.

    Knappen svälts bara när bindningens eventuella modifierare hålls nere —
    annars ska mouse4 fortsätta vara "bakåt" i webbläsaren som vanligt.

    Just för att trycket svälts ser GetAsyncKeyState det aldrig, så hållet
    följs i stället av hookens egna ned- och uppmeddelanden.
    """

    def __init__(
        self,
        hotkey: str,
        hold_threshold_s: float,
        on_start,
        on_stop,
        mode: str = "auto",
        also_held: str = "",
    ):
        # also_held behövs inte här: hooken kräver bara bindningens egna
        # modifierare och bryr sig inte om fler hålls nere.
        mods, vk = parse_hotkey(hotkey)
        if not is_mouse(hotkey):
            raise HotkeyError(f"'{hotkey}' är ingen musknapp")
        super().__init__(vk, hold_threshold_s, on_start, on_stop, mode)
        self._mods = mods
        self._hotkey_str = hotkey
        # XBUTTON1/2 skiljs åt av höga halvan av mouseData; hjulklicket har
        # ett eget meddelande och behöver ingen extra kontroll.
        self._xbutton = {0x05: 1, 0x06: 2}.get(vk, 0)
        self._tid = None
        self._hook = None
        self._button_down = False
        self._ready = threading.Event()
        self._error = None
        # Referensen måste överleva så länge hooken sitter uppe — annars
        # skräpsamlas trampolinen och Windows kallar in i tomma intet.
        self._proc = _HOOKPROC(self._hook_proc)
        self._thread = threading.Thread(
            target=self._message_loop, daemon=True, name="viska-mousehook"
        )
        self._thread.start()
        self._ready.wait(timeout=5)
        if self._error:
            raise HotkeyError(self._error)

    def _message_loop(self) -> None:
        self._tid = kernel32.GetCurrentThreadId()
        self._hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._proc, None, 0)
        if not self._hook:
            self._error = (
                f"Musknappen '{self._hotkey_str.upper()}' kunde inte fångas "
                f"(Win32-fel {ctypes.get_last_error()}). Välj en annan knapp "
                "i Inställningar."
            )
            self._ready.set()
            return
        self._ready.set()
        msg = wintypes.MSG()
        try:
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
        finally:
            user32.UnhookWindowsHookEx(self._hook)
            self._hook = None

    def _hook_proc(self, code: int, wparam: int, lparam: int) -> int:
        if code != 0 or wparam not in _MOUSE_SWALLOW:
            return user32.CallNextHookEx(None, code, wparam, lparam)
        try:
            if not self._is_our_button(wparam, lparam):
                return user32.CallNextHookEx(None, code, wparam, lparam)
            if wparam in _MOUSE_UP:
                # Släppet svälts bara om nedtrycket var vårt — annars fick
                # appen under pekaren nedtrycket och måste få släppet med.
                was_ours, self._button_down = self._button_down, False
                if not was_ours:
                    return user32.CallNextHookEx(None, code, wparam, lparam)
            else:
                if not self._mods_held():
                    return user32.CallNextHookEx(None, code, wparam, lparam)
                self._button_down = True
                threading.Thread(
                    target=self._deliver, daemon=True, name="viska-mousepress"
                ).start()
        except Exception:
            # En hook som kastar får inte ta ner musen: släpp igenom.
            log.exception("Fel i mushooken")
            return user32.CallNextHookEx(None, code, wparam, lparam)
        return 1  # svald: appen under muspekaren ser aldrig knappen

    def _is_down(self) -> bool:
        return self._button_down

    def _is_our_button(self, wparam: int, lparam: int) -> bool:
        if self._xbutton:
            if wparam not in (WM_XBUTTONDOWN, WM_XBUTTONUP, WM_XBUTTONDBLCLK):
                return False
            data = ctypes.cast(lparam, ctypes.POINTER(_MSLLHOOKSTRUCT)).contents
            return (data.mouseData >> 16) & 0xFFFF == self._xbutton
        return wparam in (WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MBUTTONDBLCLK)

    def _mods_held(self) -> bool:
        if not self._mods:
            return True
        wanted = (
            (MOD_ALT, 0x12),  # VK_MENU
            (MOD_CONTROL, 0x11),  # VK_CONTROL
            (MOD_SHIFT, 0x10),  # VK_SHIFT
            (MOD_WIN, 0x5B),  # VK_LWIN
        )
        for flag, vk in wanted:
            if self._mods & flag and not user32.GetAsyncKeyState(vk) & 0x8000:
                if flag != MOD_WIN or not user32.GetAsyncKeyState(0x5C) & 0x8000:
                    return False
        return True

    def _deliver(self) -> None:
        try:
            self._on_trigger_down()
        except Exception:
            log.exception("Fel i musknappens callback")

    def stop(self) -> None:
        if self._tid:
            user32.PostThreadMessageW(self._tid, WM_QUIT, 0, 0)
            self._thread.join(timeout=2)


def create_push_to_talk(
    hotkey: str,
    hold_threshold_s: float,
    on_start,
    on_stop,
    mode: str = "auto",
    also_held: str = "",
):
    """Dikteringsknappen, oavsett om det är en tangent eller en musknapp."""
    cls = MouseTrigger if is_mouse(hotkey) else PushToTalk
    return cls(hotkey, hold_threshold_s, on_start, on_stop, mode, also_held)
