"""`viska --engine`: dikteringsmotorn styrd över stdin/stdout.

För en värdapp (Referat) som startar Viska som en egen process. Ingen Tk,
ingen trayikon. Varje rad är ett JSON-objekt:

- Värden skickar kommandon på stdin: {"cmd": "configure", ...}. Ett "id"
  följer med tillbaka i svaret.
- Motorn skickar händelser på stdout: {"event": "listening"}. Varje kommando
  får ett svar, {"event": "ok", "cmd": ..., "id": ...} eller
  {"event": "error", "cmd": ..., "id": ..., "message": ...}.

stdout används bara för protokollet; loggen går till fil och stderr.

Motorn börjar med standardinställningarna och laddar ingen modell och tar
ingen tangent förrän värden skickat "configure". Se docs/motorlage.md för
hela protokollet.
"""

import copy
import json
import logging
import sys
import threading

from viska import __version__, config, gpu, mics
from viska.engine import DictationEngine, Feedback, flow_polish_timeout_s
from viska.hotkey import HotkeyError, create_push_to_talk

log = logging.getLogger("viska.stdio")

PROTOCOL = 1
LEVEL_INTERVAL_S = 0.05


class JsonOut:
    """En JSON-rad per händelse, aldrig två trådar mitt i varandras rader."""

    def __init__(self, stream):
        self._stream = stream
        self._lock = threading.Lock()

    def send(self, event: str, **data) -> None:
        line = json.dumps({"event": event, **data}, ensure_ascii=False)
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()


class JsonFeedback(Feedback):
    """Motorns meddelanden som händelser till värden."""

    def __init__(self, out: JsonOut, engine_ref):
        self.out = out
        self._engine = engine_ref  # anropbar som ger motorn (skapas efter oss)
        self._level_stop: threading.Event | None = None
        self._actions: dict = {}

    def status(self, text):
        self.out.send("status", text=text)

    def history_changed(self):
        engine = self._engine()
        self.out.send("history", last=engine.last_text, app=engine.last_app)

    def recording(self, active):
        self.out.send("recording", active=active)
        if active:
            self._start_levels()
        elif self._level_stop is not None:
            self._level_stop.set()
            self._level_stop = None

    def _start_levels(self):
        # Nivåmätaren i värdens statusruta: ungefär 20 värden per sekund.
        stop = threading.Event()
        self._level_stop = stop
        recorder = self._engine().recorder

        def run():
            while not stop.wait(LEVEL_INTERVAL_S):
                self.out.send("level", value=round(recorder.level, 4))

        threading.Thread(target=run, daemon=True, name="viska-level").start()

    def model_loading(self, language):
        self.out.send("model_loading", language=language)

    def model_ready(self, device):
        self.out.send("model_ready", device=device)

    def model_failed(self):
        self.out.send("model_failed")

    def not_ready(self):
        self.out.send("not_ready")

    def busy(self):
        self.out.send("busy")

    def mic_failed(self):
        self.out.send("mic_failed")

    def mic_changed(self, choice):
        self.out.send(
            "mic",
            name=choice.name,
            bluetooth=choice.bluetooth,
            avoided=choice.avoided,
            in_call=choice.in_call,
            description=choice.describe(),
        )

    def connecting(self):
        self.out.send("connecting")

    def listening(self):
        self.out.send("listening")

    def partial(self, text):
        self.out.send("partial", text=text)

    def transcribing(self):
        self.out.send("transcribing")

    def nothing_heard(self):
        self.out.send("nothing_heard")

    def idle(self):
        self.out.send("idle")

    def failed(self):
        self.out.send("failed")

    def polishing(self, insert_raw, cancel):
        self._actions = {"insert_raw": insert_raw, "cancel": cancel}
        self.out.send("polishing")

    def inserting(self):
        self._actions = {}
        self.out.send("inserting")

    def flow_done(self, message):
        self.out.send("flow_done", message=message)

    def notice(self, message):
        self.out.send("notice", message=message)

    def take_action(self, name: str) -> bool:
        """Värden valde "infoga råtext" eller "avbryt" under en polering."""
        action = self._actions.get(name)
        if action is None:
            return False
        action()
        return True


class HostPolishing:
    """Polering som värden gör, med sin egen AI-tjänst.

    Motorn har flödet: statusrutan med "infoga råtext" och "avbryt",
    tidsgränsen och vakten mot dubbla inskrivningar. Själva omskrivningen
    skickas till värden som en polish_request-händelse, och värden svarar
    med kommandot polished eller polish_failed. Ett svar som kommer efter
    motorns tidsgräns kastas, och råtexten har då redan skrivits in.
    """

    def __init__(self, out: JsonOut, timeout=flow_polish_timeout_s, margin_s: float = 5.0):
        self.out = out
        self.timeout = timeout
        # Väntar lite längre än motorns gräns, så att det är motorns tidsgräns
        # som avgör och inte den här.
        self.margin_s = margin_s
        self._lock = threading.Lock()
        self._next_id = 0
        self._waiting: dict[int, dict] = {}

    # Värden lovar att svara när den slår på flow; inget att kontrollera.
    def available(self) -> bool:
        return True

    def warmup(self) -> None:
        pass

    def refresh_reachable_async(self) -> None:
        pass

    def polish(self, cfg: dict, text: str, style: str, lang: str = "sv") -> str:
        with self._lock:
            self._next_id += 1
            request = self._next_id
            slot = {"done": threading.Event(), "text": None, "error": None}
            self._waiting[request] = slot
        # Värden får veta hur länge motorn väntar, så att den inte ger upp
        # före motorn med en lång text.
        timeout_s = self.timeout(text)
        try:
            self.out.send(
                "polish_request",
                request=request,
                text=text,
                style=style,
                language=lang,
                timeout_s=timeout_s,
            )
            if not slot["done"].wait(timeout_s + self.margin_s):
                raise TimeoutError("värden svarade inte på poleringen")
            if slot["error"]:
                raise RuntimeError(slot["error"])
            return slot["text"] or text
        finally:
            with self._lock:
                self._waiting.pop(request, None)

    def answer(self, request, text: str | None = None, error: str | None = None) -> bool:
        """Värdens svar. False om ingen väntar på just den förfrågan längre."""
        with self._lock:
            slot = self._waiting.get(request)
        if slot is None:
            return False
        slot["text"], slot["error"] = text, error
        slot["done"].set()
        return True


class EngineHost:
    """Tar emot kommandon och kör motorn. Separat från stdin-loopen så att
    testerna kan mata kommandon direkt."""

    # Ändras någon av de här binds dikteringstangenten om.
    _KEY_SETTINGS = ("hotkey", "hold_threshold_s", "hotkey_mode", "flow_key")

    def __init__(self, out: JsonOut, cfg: dict | None = None):
        self.out = out
        self.cfg = cfg if cfg is not None else _engine_defaults()
        self.feedback = JsonFeedback(out, lambda: self.engine)
        self.polishing = HostPolishing(out)
        self.engine = DictationEngine(self.cfg, self.feedback, self.polishing)
        self.engine.take_over_key = self._take_over_key
        self.hotkey = None
        self.server = None  # transkriberingsservern för mötesljud, när den körs
        self.configured = False
        self.running = True

    def _take_over_key(self) -> bool:
        return self.hotkey is not None and self.hotkey.force_stop()

    # -- Kommandon --------------------------------------------------------------

    def handle_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("kommandot måste vara ett JSON-objekt")
        except ValueError as e:
            self.out.send("error", cmd=None, message=f"Ogiltig rad: {e}")
            return
        self.handle(message)

    def handle(self, message: dict) -> None:
        cmd = message.get("cmd")
        ident = message.get("id")
        handler = getattr(self, f"cmd_{cmd}", None) if isinstance(cmd, str) else None
        if handler is None:
            self.out.send("error", cmd=cmd, id=ident, message="Okänt kommando")
            return
        try:
            result = handler(message) or {}
        except Exception as e:  # noqa: BLE001
            log.exception("Kommandot %s misslyckades", cmd)
            self.out.send("error", cmd=cmd, id=ident, message=str(e))
            return
        self.out.send("ok", cmd=cmd, id=ident, **result)

    def cmd_configure(self, message: dict) -> dict:
        """Nya inställningar. Bara kända nycklar tas emot; resten rapporteras
        tillbaka som ignorerade."""
        changes = message.get("config") or {}
        known = {k: v for k, v in changes.items() if k in config.DEFAULTS}
        ignored = sorted(set(changes) - set(known))
        old_key = {k: self.cfg[k] for k in self._KEY_SETTINGS}
        self.engine.apply(known)
        if not self.configured or any(
            self.cfg[k] != old_key[k] for k in self._KEY_SETTINGS
        ):
            self._bind_key()
        self.configured = True
        return {"ignored": ignored} if ignored else {}

    def _bind_key(self) -> None:
        if self.hotkey is not None:
            if self.hotkey.force_stop():
                self.engine.stop()
            self.hotkey.stop()
            self.hotkey = None
        if not self.cfg["hotkey"]:
            # Ingen tangent: värden använder motorn bara för mötesljud.
            return
        try:
            self.hotkey = create_push_to_talk(
                self.cfg["hotkey"],
                self.cfg["hold_threshold_s"],
                self.engine.start,
                self.engine.stop,
                self.cfg["hotkey_mode"],
                self.cfg["flow_key"],
            )
        except HotkeyError as e:
            # Motorn fungerar ändå via start/stop-kommandona.
            self.out.send("hotkey_failed", hotkey=self.cfg["hotkey"], message=str(e))

    def cmd_set_language(self, message: dict) -> None:
        language = message.get("language")
        if language not in ("sv", "en"):
            raise ValueError("språket måste vara sv eller en")
        self.engine.apply({"language": language})

    def cmd_start(self, _message: dict) -> dict:
        """Starta en diktering utan tangenten (t.ex. "Prova att diktera")."""
        return {"started": self.engine.start()}

    def cmd_stop(self, _message: dict) -> dict:
        """Stoppa en diktering och skriv ut den."""
        self._take_over_key()
        if not self.engine.recorder.recording:
            return {"stopped": False}
        self.engine.stop()
        return {"stopped": True}

    def cmd_cancel(self, _message: dict) -> dict:
        """Avbryt inspelningen, eller en pågående polering, utan att skriva in
        något."""
        if self.feedback.take_action("cancel"):
            return {"cancelled": True}
        return {"cancelled": self.engine.cancel()}

    def cmd_insert_raw(self, _message: dict) -> dict:
        """Under en polering: skriv in råtexten nu i stället för att vänta."""
        return {"inserted": self.feedback.take_action("insert_raw")}

    def cmd_polished(self, message: dict) -> dict:
        """Svar på en polish_request: den omskrivna texten."""
        text = message.get("text")
        if not isinstance(text, str):
            raise ValueError("text saknas")
        return {"accepted": self.polishing.answer(message.get("request"), text=text)}

    def cmd_polish_failed(self, message: dict) -> dict:
        """Svar på en polish_request: det gick inte. Råtexten skrivs in."""
        error = str(message.get("message") or "poleringen misslyckades")
        return {"accepted": self.polishing.answer(message.get("request"), error=error)}

    def cmd_history(self, _message: dict) -> dict:
        return {"items": list(self.engine.history), "last": self.engine.last_text}

    def cmd_list_mics(self, _message: dict) -> dict:
        return {"mics": mics.list_inputs()}

    def cmd_current_mic(self, _message: dict) -> dict:
        """Mikrofonen motorn skulle välja just nu, med samma regler som för en
        diktering: datorns egen i stället för ett Bluetooth-headset, och
        headsetet under ett samtal. Så kan värden spela in möten med samma
        mikrofon. name är tomt när ingen mikrofon hittas."""
        choice = mics.resolve(self.cfg["input_device"], self.cfg["mic_avoid_bluetooth"])
        return {
            "name": choice.name,
            "bluetooth": choice.bluetooth,
            "avoided": choice.avoided,
            "in_call": choice.in_call,
        }

    def cmd_serve_transcription(self, message: dict) -> dict:
        """Låt mötesljud skrivas ut med motorns modell: en OpenAI-kompatibel
        /v1/audio/transcriptions på 127.0.0.1. Porten väljs fritt om den
        inte anges. Ett andra anrop svarar med den som redan körs."""
        if self.server is None:
            from viska.transcription_server import TranscriptionServer

            self.server = TranscriptionServer(self.engine, port=int(message.get("port") or 0))
            self.server.start()
        return {"port": self.server.port, "url": f"http://127.0.0.1:{self.server.port}/v1"}

    def cmd_quit(self, _message: dict) -> None:
        self.running = False

    def close(self) -> None:
        if self.server is not None:
            self.server.stop()
            self.server = None
        if self.hotkey is not None:
            self.hotkey.stop()
            self.hotkey = None
        self.engine.close()


def _engine_defaults() -> dict:
    cfg = copy.deepcopy(config.DEFAULTS)
    # Värden äger historiken och sparar den själv.
    cfg["history_persist"] = False
    return cfg


def main() -> None:
    """Startpunkt för `viska --engine` och för viska-engine.exe."""
    config.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            # Egen loggfil: en värdapp kan köra motorn samtidigt som Viska.
            logging.FileHandler(
                config.LOG_PATH.with_name("engine.log"), encoding="utf-8"
            ),
            # stderr, aldrig stdout: stdout är protokollet.
            logging.StreamHandler(sys.stderr),
        ],
    )
    gpu.cleanup_pending_removal()
    sys.exit(run())


def run(stdin=None, stdout=None) -> int:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for stream in (stdin, stdout):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    out = JsonOut(stdout)
    host = EngineHost(out)
    out.send("hello", version=__version__, protocol=PROTOCOL)
    try:
        for line in stdin:
            host.handle_line(line)
            if not host.running:
                break
    finally:
        host.close()
        out.send("bye")
    return 0
