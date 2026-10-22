"""Vilken mikrofon Viska ska lyssna med.

Ett vanligt Bluetooth-headset byter till samtalsläge (mono, sämre ljud) så
fort något program öppnar dess mikrofon, och tillbaka först när den stängs.
Att öppna en annan mikrofon påverkar inte headsetet. Är Windows
standardmikrofon ett sådant headset väljer Viska därför datorns egen
mikrofon i stället, om det finns någon — musiken i headsetet fortsätter då
som vanligt.

Vad som är Bluetooth läses ur registrets beskrivning av ljudenheterna
(MMDevices). Där står varje enhets uppräknare: BTHHFENUM för ett headset i
samtalsläge, USB, HDAUDIO och så vidare. Strukturen är odokumenterad men
har varit densamma sedan Windows 7 och används av många ljudverktyg; går
den inte att läsa faller valet tillbaka på namnet.
"""

import logging
import re
from dataclasses import dataclass

log = logging.getLogger(__name__)

_CAPTURE_KEY = r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture"
# PKEY_Device_FriendlyName för själva hårdvaran ("Jabra Evolve3 85 Hands-Free").
_PROP_DEVICE_NAME = "{b3f8fa53-0004-438e-9003-51a46e139bfc},6"
# Uppräknaren ("BTHHFENUM", "USB", "HDAUDIO").
_PROP_ENUMERATOR = "{a45c254e-df1c-4efd-8020-67d146a850e0},24"

# Windows bokför per program vem som använder mikrofonen, samma uppgift som
# ligger bakom mikrofonikonen i aktivitetsfältet. Referat läser den för att
# upptäcka samtal; samma regler används här.
_CONSENT_KEY = (
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager"
    r"\ConsentStore\microphone"
)
_CALL_APPS = re.compile(
    r"\\msteams_|#(ms-)?teams\.exe$|#zoom\.exe$"
    r"|#(chrome|msedge|firefox|brave|opera|vivaldi)\.exe$",
    re.IGNORECASE,
)

# Ingångar som inte är mikrofoner: linjeingång och "det datorn spelar".
_NOT_A_MIC = re.compile(r"stereo ?mix|what u hear|\blin(e|je)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Endpoint:
    device: str  # hårdvarans namn, det som står inom parentes i enhetsnamnet
    enumerator: str

    @property
    def bluetooth(self) -> bool:
        # BTHHFENUM (samtalsläge) och BTHENUM; LE Audio har okänt namn men
        # börjar enligt samma mönster.
        return self.enumerator.upper().startswith("BTH")


@dataclass(frozen=True)
class Choice:
    device: int | None  # PortAudio-index; None = PortAudios standard
    name: str
    bluetooth: bool
    # Headsetet som Windows hade som standard men som Viska gick förbi.
    avoided: str | None = None
    # Headsetet används för att ett samtal redan har det i samtalsläge.
    in_call: bool = False

    def describe(self) -> str:
        if not self.name:
            return "Ingen mikrofon hittades."
        if self.avoided:
            return (
                f"Lyssnar med {self.name}. {self.avoided} används inte, "
                "eftersom headsetet då byter till samtalsläge."
            )
        if self.in_call:
            return (
                f"Lyssnar med {self.name}. Headsetet är redan i samtalsläge "
                "för ditt samtal, så inget ändras."
            )
        if self.bluetooth:
            return (
                f"Lyssnar med {self.name}. Headsetet byter till samtalsläge "
                "medan du dikterar."
            )
        return f"Lyssnar med {self.name}."


def capture_endpoints() -> list[Endpoint]:
    """Alla inspelningsenheter Windows känner till, ur registret."""
    try:
        import winreg
    except ImportError:
        return []
    result = []
    try:
        root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _CAPTURE_KEY)
    except OSError:
        return []
    with root:
        index = 0
        while True:
            try:
                guid = winreg.EnumKey(root, index)
            except OSError:
                break
            index += 1
            try:
                with winreg.OpenKey(root, guid) as key:
                    with winreg.OpenKey(key, "Properties") as props:
                        device = winreg.QueryValueEx(props, _PROP_DEVICE_NAME)[0]
                        enumerator = winreg.QueryValueEx(props, _PROP_ENUMERATOR)[0]
            except OSError:
                continue
            result.append(Endpoint(device=str(device), enumerator=str(enumerator)))
    return result


def mic_users() -> list[str]:
    """Registernycklarna för de program som använder mikrofonen just nu:
    en senaste användning som har börjat men inte slutat."""
    try:
        import winreg
    except ImportError:
        return []
    users = []

    def visit(key, path: str) -> None:
        try:
            start = winreg.QueryValueEx(key, "LastUsedTimeStart")[0]
            stop = winreg.QueryValueEx(key, "LastUsedTimeStop")[0]
            if start and stop == 0:
                users.append(path)
        except OSError:
            pass
        index = 0
        while True:
            try:
                name = winreg.EnumKey(key, index)
            except OSError:
                return
            index += 1
            try:
                with winreg.OpenKey(key, name) as child:
                    visit(child, f"{path}\\{name}")
            except OSError:
                continue

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _CONSENT_KEY) as root:
            visit(root, "microphone")
    except OSError:
        return []
    return users


def in_call(users: list[str] | None = None) -> bool:
    """Har Teams, Zoom eller en webbläsare mikrofonen öppen?"""
    users = mic_users() if users is None else users
    return any(_CALL_APPS.search(user) for user in users)


def endpoint_signature() -> tuple:
    """Vilka inspelningsenheter Windows har och i vilket tillstånd, för att
    märka att något anslutits eller kopplats bort. Läses ur registret och
    kostar någon millisekund."""
    try:
        import winreg
    except ImportError:
        return ()
    result = []
    try:
        root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _CAPTURE_KEY)
    except OSError:
        return ()
    with root:
        index = 0
        while True:
            try:
                guid = winreg.EnumKey(root, index)
            except OSError:
                break
            index += 1
            try:
                with winreg.OpenKey(root, guid) as key:
                    result.append((guid, winreg.QueryValueEx(key, "DeviceState")[0]))
            except OSError:
                continue
    return tuple(sorted(result))


def _hardware(name: str) -> str:
    """'Headset (Jabra Evolve3 85 Hands-Free)' -> 'Jabra Evolve3 85 Hands-Free'."""
    match = re.search(r"\(([^()]*)\)\s*$", name)
    return match.group(1).strip() if match else name


def _endpoint_for(name: str, endpoints: list[Endpoint]) -> Endpoint | None:
    hardware = _hardware(name).casefold()
    for ep in endpoints:
        if ep.device.casefold() == hardware:
            return ep
    return None


def is_bluetooth(name: str, endpoints: list[Endpoint]) -> bool:
    ep = _endpoint_for(name, endpoints)
    if ep is not None:
        return ep.bluetooth
    lowered = name.casefold()
    return "hands-free" in lowered or "bthhfenum" in lowered


def choose(
    inputs: list[tuple[int, str]],
    default: int | None,
    endpoints: list[Endpoint],
    avoid_bluetooth: bool = True,
    call_active: bool = False,
) -> Choice | None:
    """Ren beslutslogik.

    inputs är WASAPI-ingångarna som (PortAudio-index, namn), default är
    Windows standardmikrofon bland dem. None betyder att det inte finns
    något att välja mellan och att PortAudios standard får gälla.
    """
    by_index = dict(inputs)
    if default not in by_index:
        return None
    default_name = by_index[default]
    if not is_bluetooth(default_name, endpoints):
        return Choice(default, default_name, bluetooth=False)
    if not avoid_bluetooth:
        return Choice(default, default_name, bluetooth=True)
    if call_active:
        # Ett samtal har redan headsetet i samtalsläge; att lyssna med det
        # ändrar ingenting och ger samma mikrofon som samtalet.
        return Choice(default, default_name, bluetooth=True, in_call=True)

    candidates = [
        (index, name)
        for index, name in inputs
        if not is_bluetooth(name, endpoints) and not _NOT_A_MIC.search(name)
    ]
    if not candidates:
        log.info("Bara Bluetooth-mikrofoner finns – använder %s", default_name)
        return Choice(default, default_name, bluetooth=True)

    def rank(item):
        ep = _endpoint_for(item[1], endpoints)
        usb = ep is not None and ep.enumerator.upper() == "USB"
        return (usb, item[0])  # datorns inbyggda före USB, sedan Windows ordning

    index, name = min(candidates, key=rank)
    return Choice(index, name, bluetooth=False, avoided=_hardware(default_name))


def _wasapi_inputs() -> tuple[list[tuple[int, str]], int | None]:
    """WASAPI-ingångarna som (PortAudio-index, namn) och Windows standard."""
    import sounddevice as sd

    wasapi = next(
        i for i, api in enumerate(sd.query_hostapis()) if "WASAPI" in api["name"]
    )
    api = sd.query_hostapis(wasapi)
    inputs = [
        (i, sd.query_devices(i)["name"])
        for i in api["devices"]
        if sd.query_devices(i)["max_input_channels"] > 0
    ]
    return inputs, api["default_input_device"]


def list_inputs() -> list[dict]:
    """Mikrofonerna att välja bland, för en inställningssida: namn, om det är
    ett Bluetooth-headset och om det är Windows standard. Namnet är det som
    sparas som input_device."""
    try:
        inputs, default = _wasapi_inputs()
    except Exception:
        log.exception("Kunde inte läsa WASAPI-enheterna")
        return []
    endpoints = capture_endpoints()
    return [
        {
            "name": name,
            "bluetooth": is_bluetooth(name, endpoints),
            "default": index == default,
        }
        for index, name in inputs
        if not _NOT_A_MIC.search(name)
    ]


def find_input(name: str, inputs: list[tuple[int, str]]) -> tuple[int, str] | None:
    """Ett sparat mikrofonnamn bland WASAPI-ingångarna. Samma mikrofon finns
    under flera värd-API:er med samma namn, så namnet ensamt räcker inte för
    PortAudio; här blir det ett index. MME kortar namnet till 31 tecken och
    Chromium lägger ibland till ett USB-id, så ett namn som börjar det andra
    räknas också."""
    wanted = name.strip().casefold()
    if not wanted:
        return None
    for index, candidate in inputs:
        if candidate.strip().casefold() == wanted:
            return index, candidate
    for index, candidate in inputs:
        have = candidate.strip().casefold()
        if have.startswith(wanted) or wanted.startswith(have):
            return index, candidate
    return None


def resolve(input_device, avoid_bluetooth: bool = True) -> Choice:
    """Mikrofonen att öppna nu. input_device är användarens uttryckliga val
    (namn eller index) och respekteras när mikrofonen finns; None, eller en
    mikrofon som inte är ansluten, betyder "Windows standard, men inte ett
    Bluetooth-headset om det går att undvika"."""
    import sounddevice as sd

    if isinstance(input_device, int) and not isinstance(input_device, bool):
        try:
            name = sd.query_devices(input_device, kind="input")["name"]
        except Exception:
            name = str(input_device)
        return Choice(input_device, name, is_bluetooth(name, capture_endpoints()))

    try:
        inputs, default = _wasapi_inputs()
    except Exception:
        log.exception("Kunde inte läsa WASAPI-enheterna")
        inputs, default = [], None
    endpoints = capture_endpoints()

    if input_device not in (None, ""):
        found = find_input(str(input_device), inputs)
        if found is not None:
            index, name = found
            return Choice(index, name, is_bluetooth(name, endpoints))
        log.warning("Mikrofonen %r finns inte just nu – väljer automatiskt", input_device)

    choice = choose(
        inputs, default, endpoints, avoid_bluetooth,
        call_active=avoid_bluetooth and in_call(),
    )
    if choice is not None:
        return choice
    try:
        name = sd.query_devices(kind="input")["name"]
    except Exception:
        name = ""
    return Choice(None, name, bluetooth=False)
