"""Dikteringsmotorn: tangenttryck in, text ut i fönstret som har fokus.

Motorn äger allt som gör en diktering — Whisper-modellerna, mikrofonen,
inspelningen, liveläget, efterbehandlingen, inklistringen och historiken —
men visar ingenting själv. Vad som händer meddelas via ett Feedback-objekt:
Tk-appen gör statusruta och trayikon av meddelandena, och `viska --engine`
skickar dem vidare som JSON till Referat.

Trådning: start/stopp anropas från tangenttrådarna, utskriften körs på en
egen tråd per diktering och Feedback anropas från vilken av dem som helst.
"""

import gc
import logging
import threading
import time
from collections import deque

import numpy as np

from viska import codex, commands, llm, metrics, mics
from viska.audio import SAMPLE_RATE, Recorder
from viska.config import load_history, save, save_history
from viska.focus import focus_window, foreground_app, foreground_window, window_app_name
from viska.hotkey import key_held
from viska.inject import inject
from viska.sounds import Sounds
from viska.stream import LiveWorker
from viska.transcribe import Transcriber

log = logging.getLogger("viska")

LANG_NAMES = {"sv": "svensk", "en": "engelsk"}

# Flow-läget: tar poleringen längre tid än så här skrivs råtexten in i
# stället. Diktering får aldrig blockeras av en trög eller hängande modell.
# En lång diktering tar längre tid att skriva om, så gränsen växer med
# texten: 10 s för några meningar, upp till 90 s. Väntan går alltid att
# avbryta med dikteringsknappen, som skriver in råtexten direkt.
FLOW_POLISH_TIMEOUT_S = 10.0
FLOW_POLISH_TIMEOUT_PER_WORD_S = 0.15
FLOW_POLISH_TIMEOUT_MAX_S = 90.0


def flow_with_key(flow: bool, cfg: dict, key_held) -> bool:
    """Flow för den här dikteringen, med flow_key inräknad. Knappen läses när
    dikteringen startar: liveinskrivningen beror på beslutet och kan inte
    ångras halvvägs."""
    if not flow or not cfg["flow_key"]:
        return flow
    return key_held(cfg["flow_key"]) == (cfg["flow_key_means"] != "raw")


def flow_polish_timeout_s(text: str) -> float:
    """Hur länge flow väntar på poleringen av just den här texten."""
    return min(
        FLOW_POLISH_TIMEOUT_MAX_S,
        FLOW_POLISH_TIMEOUT_S + FLOW_POLISH_TIMEOUT_PER_WORD_S * len(text.split()),
    )
# Hur länge startsignalen väntar på att ett Bluetooth-headset ska byta till
# samtalsläge. Microsoft anger "flera sekunder" som värsta fall.
HEADSET_CONNECT_TIMEOUT_S = 3.0
# Sökbredd för flow-lägets förhandsvisning (vanlig diktering behåller sin).
LIVE_PREVIEW_BEAM = 1


class Feedback:
    """Vad motorn berättar för den som visar den. Alla metoder är frivilliga:
    standardversionen gör ingenting, så en mottagare behöver bara ta hand om
    det den bryr sig om."""

    def status(self, text: str) -> None:
        """Kort tillståndsrad ("redo – kb-whisper-large (cuda)")."""

    def history_changed(self) -> None:
        """Historiken eller senaste dikteringen har ändrats."""

    def recording(self, active: bool) -> None:
        """Inspelningen började eller slutade."""

    def model_loading(self, language: str) -> None:
        """En modell laddas (och laddas ner första gången). language är
        språkets namn ("svensk")."""

    def model_ready(self, device: str) -> None:
        """Modellen är laddad och dikteringen redo."""

    def model_failed(self) -> None:
        """Modellen kunde inte laddas."""

    def not_ready(self) -> None:
        """Tangenten trycktes innan modellen hunnit laddas."""

    def busy(self) -> None:
        """Tangenten trycktes medan förra dikteringen fortfarande skrivs ut."""

    def mic_failed(self) -> None:
        """Mikrofonen gick inte att öppna."""

    def mic_changed(self, choice) -> None:
        """Mikrofonen som används har bytts (mics.Choice): vilken, om den är
        ett Bluetooth-headset och vilket headset som i så fall undveks."""

    def connecting(self) -> None:
        """Headsetets mikrofon ansluter; startsignalen väntar på ljud."""

    def listening(self) -> None:
        """Inspelningen är igång och tar emot ljud."""

    def partial(self, text: str) -> None:
        """Ofärdig livetext, bara för förhandsvisning."""

    def transcribing(self) -> None:
        """Tangenten är släppt och ljudet skrivs ut."""

    def nothing_heard(self) -> None:
        """Det fanns ljud men inget tal."""

    def idle(self) -> None:
        """Dikteringen är klar och inget mer behöver visas."""

    def failed(self) -> None:
        """Utskriften misslyckades."""

    def polishing(self, insert_raw, cancel) -> None:
        """Flow-polering pågår. insert_raw() och cancel() går att anropa från
        vilken tråd som helst för att hoppa över väntan."""

    def inserting(self) -> None:
        """Poleringen är avgjord och texten skrivs in."""

    def flow_done(self, message: str) -> None:
        """Kvittens efter flow-läget: vad som hamnade i dokumentet."""

    def notice(self, message: str) -> None:
        """Kort upplysning (avbrutet, fönstret borta)."""


class InsertionGuard:
    """Avgör vem som får skriva in text för EN diktering — exakt en vinnare.

    Under en flow-polering finns tre kandidater: den polerade texten, råtexten
    (användaren orkade inte vänta, eller poleringen tog för lång tid) och
    ingenting (användaren avbröt). Utan en gemensam vakt är det lätt att få två
    av dem: ett sent modellsvar som landar efter att råtexten redan skrivits in
    dubblerar dikteringen i dokumentet, och ett avbrott hinner inte stoppa en
    inskrivning som redan var på väg.

    Redan inskriven livetext rörs aldrig — den hör till en annan mekanism och
    ska inte städas bort av ett avbrott.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._winner: str | None = None

    def claim(self, who: str) -> bool:
        """True bara för den första som gör anspråk. Efter ett avbrott
        returnerar den alltid False."""
        with self._lock:
            if self._winner is not None:
                return False
            self._winner = who
            return True

    def cancel(self) -> None:
        with self._lock:
            if self._winner is None:
                self._winner = "cancelled"

    @property
    def winner(self) -> str | None:
        with self._lock:
            return self._winner

    @property
    def cancelled(self) -> bool:
        return self.winner == "cancelled"


class DictationEngine:
    def __init__(self, cfg: dict, feedback: Feedback | None = None, polishing=None):
        self.cfg = cfg
        self.feedback = feedback or Feedback()
        # Flow-läget (automatisk polering) är valfritt: utan poleringsmotor
        # körs varje diktering som vanlig diktering.
        self.polishing = polishing
        self.sounds = Sounds(cfg["sounds"])
        self._mic_choice = None
        self.recorder = Recorder(
            self._choose_mic,
            cfg["mic_mode"],
            cfg["preroll_s"],
            cfg["mic_idle_close_s"],
            close_now=self._mic_is_bluetooth,
        )
        self.history: deque[str] = deque(maxlen=int(cfg["history_size"]))
        if cfg["history_persist"]:
            # Nyast först på disk också — skiva till history_size INNAN
            # deque-konstruktion: en deque(iterable, maxlen) trunkerar
            # annars svansen (de äldsta) i stället för att behålla de N
            # nyaste när den sparade listan är längre än gränsen.
            persisted = load_history()[: int(cfg["history_size"])]
            self.history = deque(persisted, maxlen=int(cfg["history_size"]))
        self.transcribers: dict[str, Transcriber] = {}
        self.language = cfg["language"] if cfg["language"] in LANG_NAMES else "sv"
        self.last_text = ""
        # Programmet senaste dikteringen skrevs in i ("Microsoft Outlook").
        self.last_app: str | None = None
        # Sätts av den som binder dikteringstangenten: avaktiverar tangenten
        # utifrån och svarar True om en aktiv session togs över (maxtiden).
        self.take_over_key = lambda: False
        self._transcribing = threading.Event()
        # Under en flow-polering: väljer råtexten. Ett nytt tryck på tangenten
        # betyder "vänta inte" — snabbare än att leta upp knappen.
        self._skip_polish = None
        # Om flow_key hålls nere; utbytbar i testerna.
        self.key_held = key_held
        self._watchdog = None
        # Serialiserar start/stopp av en dikteringssession (hotkey-trådarna
        # och maxtidstimern) och fryser vilket språk sessionen hade.
        self._session_lock = threading.Lock()
        # Räknas upp för varje diktering, så att en fördröjd startsignal kan
        # se om den fortfarande gäller samma diktering.
        self._session_seq = 0
        self._session_language = self.language
        self._session_transcriber: Transcriber | None = None
        self._session_prompt: str | None = None
        self._session_inject = cfg["inject_mode"]
        # Flow-läge för den aktiva sessionen: fryses vid start likt de andra
        # session-värdena, så att en ändring i Inställningar mitt i en
        # diktering inte kan byta beteende halvvägs.
        self._session_flow = False
        self._session_polish_prompt = llm.resolve_polish_prompt(cfg)
        # Fönstret dikteringen gäller, fryst vid start. Flow-läget skriver
        # tillbaka den polerade texten hit så resultatet hamnar rätt även om
        # fokus hunnit flytta under poleringen.
        self._session_target_hwnd: int | None = None
        # Tidpunkten dikteringen stoppades — nollpunkten för väntan som
        # användaren faktiskt upplever (stopp → text på skärmen).
        self._session_stopped_at = 0.0
        # En modelladdning per språk i taget — utan spärren skulle varje
        # tangenttryck i en profilerad app starta ännu en 3 GB-laddning.
        self._loading_langs: set[str] = set()
        self._loading_lock = threading.Lock()
        self._live: LiveWorker | None = None
        self._live_texts: list[str] = []  # fraser som redan skrivits in

    # -- Historik -------------------------------------------------------------------

    def remember(self, text: str) -> None:
        """Lägger till i historiken och, om opt-in-läget är på, sparar den
        till disk. RAM-listan uppdateras alltid — disksparningen är bara en
        spegling av den, aldrig den enda källan under körning."""
        self.history.appendleft(text)
        if self.cfg["history_persist"]:
            try:
                save_history(self.history)
            except OSError:
                log.exception("Kunde inte spara historiken till disk")

    # -- Modell ------------------------------------------------------------------

    def _release_models(self) -> None:
        """Släpper de laddade modellerna INNAN nya laddas vid ett modellbyte.

        Laddades den nya medan den gamla låg kvar fick grafikkortet hålla
        båda en stund; på 4–8 GB räckte minnet inte och faster-whisper föll
        tyst tillbaka på processorn. Andra språkets modell släpps också och
        laddas om lat med de nya inställningarna. En diktering som skrivs ut
        just nu behåller sin egen referens tills den är klar.
        """
        with self._session_lock:
            self.transcribers = {}
        gc.collect()

    def load_model(self, lang: str, force: bool = False, quiet: bool = False) -> None:
        with self._loading_lock:
            if (not force and lang in self.transcribers) or lang in self._loading_langs:
                return
            self._loading_langs.add(lang)
        try:
            namn = LANG_NAMES[lang]
            if not quiet:
                self.feedback.status(f"laddar {namn} modell…")
                self.feedback.model_loading(namn)
            if force:
                self._release_models()
            try:
                model = self.cfg["model"] if lang == "sv" else self.cfg["model_en"]
                t = Transcriber(
                    model,
                    self.cfg["device"],
                    self.cfg["beam_size"],
                    self.cfg["compute_type"],
                    llm.polish_shares_gpu(self.cfg),
                )
                t.initial_prompt = self.cfg["initial_prompt"]
                with self._session_lock:
                    self.transcribers[lang] = t
                self.feedback.status(f"redo – {t.model_name} ({t.device})")
                # Bara när ingen inspelning pågår — "tryck F9" mitt i en
                # pågående diktering vore direkt vilseledande.
                if not quiet and not self.recorder.recording:
                    self.feedback.model_ready(t.device)
            except Exception:
                log.exception("Kunde inte ladda modellen för %s", lang)
                self.feedback.status("fel vid modelladdning")
                if not quiet:
                    self.sounds.error()
                    self.feedback.model_failed()
        finally:
            with self._loading_lock:
                self._loading_langs.discard(lang)

    # Ändras någon av de här laddas modellen om. polish_backend avgör
    # polish_shares_gpu (bara "builtin" delar VRAM med Whisper) – ett byte
    # där kan därför ändra den VRAM-medvetna kvantiseringen precis som ett
    # modellbyte.
    _MODEL_KEYS = (
        "model", "model_en", "device", "compute_type", "beam_size", "polish_backend",
    )

    def apply(self, changes: dict) -> None:
        """Tar in ändrade inställningar och gör det som krävs för att de ska
        gälla: modellbyte, mikrofonläge, ljud, ordlista och språk. En
        pågående diktering behåller det den startade med."""
        old = dict(self.cfg)
        self.cfg.update(changes)
        new = self.cfg
        self.sounds.enabled = bool(new["sounds"])
        for t in self.transcribers.values():
            t.initial_prompt = new["initial_prompt"]
        if (
            new["mic_mode"] != old["mic_mode"]
            or new["mic_idle_close_s"] != old["mic_idle_close_s"]
        ):
            # Egen tråd: att öppna eller stänga en WASAPI-ström tar hundratals
            # millisekunder och den som sparar ska inte frysa så länge.
            threading.Thread(
                target=self.recorder.set_mode,
                args=(new["mic_mode"], new["mic_idle_close_s"]),
                daemon=True,
            ).start()
        if (
            new["mic_avoid_bluetooth"] != old["mic_avoid_bluetooth"]
            or new["input_device"] != old["input_device"]
        ):
            # En öppen ström behåller sin mikrofon; öppna om så att valet
            # gäller direkt och inte först vid nästa öppning.
            threading.Thread(target=self.recorder.restart, daemon=True).start()
        if new["language"] in LANG_NAMES:
            self.language = new["language"]
        if any(new.get(k) != old.get(k) for k in self._MODEL_KEYS):
            # Byts inte synkront: pågående sessioner behåller sin referens,
            # nya modellen svajpas in under sessionslåset när den är klar.
            self.load_model_async(self.language, force=True)
        elif self.language not in self.transcribers:
            self.load_model_async(self.language)

    def transcriber_for(self, lang: str) -> Transcriber:
        """Språkets modell, laddad nu om den inte redan är det (för mötesljud
        som kommer in när ingen diktering har behövt språket än)."""
        lang = lang if lang in LANG_NAMES else self.language
        transcriber = self.transcribers.get(lang)
        if transcriber is None:
            self.load_model(lang, quiet=True)
            transcriber = self.transcribers.get(lang)
        if transcriber is None:
            raise RuntimeError("modellen kunde inte laddas")
        return transcriber

    def load_model_async(self, lang: str, force: bool = False, quiet: bool = False):
        threading.Thread(
            target=self.load_model, args=(lang, force, quiet), daemon=True
        ).start()

    def set_language(self, lang: str) -> None:
        self.language = lang
        self.cfg["language"] = lang
        save(self.cfg)
        if lang not in self.transcribers:
            self.load_model_async(lang)

    # -- Diktering (anropas från hotkey-trådarna) ---------------------------------

    def start(self) -> bool:
        """Returnerar True om en inspelning startade (PushToTalk-kontraktet)."""
        skip = self._skip_polish
        if skip is not None:
            # Texten skrivs om just nu: tangenten skriver in råtexten direkt.
            skip()
            return False
        with self._session_lock:
            # Profil för appen som ska ta emot texten. Språk byts ALDRIG
            # automatiskt — bara om profilen uttryckligen anger det.
            fg = foreground_app()
            profile = self.cfg["app_profiles"].get(fg, {}) if fg else {}
            lang = profile.get("language") or self.language
            transcriber = self.transcribers.get(lang)
            if transcriber is None and lang != self.language:
                # Profilens språkmodell är inte laddad ännu: kör aktiva
                # språket nu och ladda profilens i bakgrunden till nästa
                # gång (quiet: statusrutan tillhör inspelningen).
                self.load_model_async(lang, quiet=True)
                lang = self.language
                transcriber = self.transcribers.get(lang)
            if transcriber is None:
                self.feedback.not_ready()
                return False
            # Maxtidsstoppet släpper tangenten innan inspelningen hunnit
            # tas; ett nytt tryck i det glappet får inte skriva över den.
            if self._transcribing.is_set() or self.recorder.recording:
                self.feedback.busy()
                return False
            try:
                fresh_stream = self.recorder.start()
            except Exception:
                log.exception("Kunde inte starta inspelningen")
                self.sounds.error()
                self.feedback.mic_failed()
                return False
            self._session_language = lang
            self._session_transcriber = transcriber
            # Fånga mål-HWND nu — dikteringstangenten är en global hotkey som
            # OS:et konsumerar, så förgrundsfönstret här är appen texten gäller.
            self._session_target_hwnd = foreground_window()
            # Global ordlista + appens egen, kombinerat.
            self._session_prompt = (
                ", ".join(
                    p
                    for p in (
                        self.cfg["initial_prompt"],
                        profile.get("initial_prompt", ""),
                    )
                    if p
                )
                or None
            )
            self._session_inject = profile.get(
                "inject_mode", self.cfg["inject_mode"]
            )
            # Flow: polera automatiskt? Profilen ärver den globala standarden.
            # Poleringsuppgiften är appens egen, annars den globala — samma
            # väg som F8-flödet väljer stil. Är poleringen inte tillgänglig
            # (ej nedladdad, backend nere) körs sessionen som VANLIG diktering
            # med liveinskrivning i stället — annars skulle en kvarglömd flow-
            # flagga (t.ex. efter "Ta bort poleringen") tyst stänga av live och
            # falla tillbaka på råtext varje gång. Tillgänglighetskollen är
            # icke-blockerande (cachen läses) så hotkey-tråden aldrig
            # hänger på nätverket; vanlig diktering utan flow kortsluter och
            # betalar inget.
            flow_flag = bool(profile.get("flow", self.cfg["flow"]))
            flow_flag = flow_with_key(flow_flag, self.cfg, self.key_held)
            if self.polishing is None:
                flow_flag = False
            elif flow_flag and llm.is_remote(self.cfg):
                # Håll cachen färsk till nästa diktering utan att blockera nu.
                self.polishing.refresh_reachable_async()
            self._session_flow = flow_flag and self.polishing.available()
            # Poleringsuppgift via den gemensamma upplösningen (mall/fritext →
            # global) så flow och F8 alltid väljer samma stil.
            self._session_polish_prompt = llm.resolve_polish_prompt(
                self.cfg, profile
            )
            self._session_seq += 1
            self.feedback.recording(True)
            if fresh_stream and self._mic_is_bluetooth():
                # Headsetet byter till samtalsläge först nu och levererar
                # tystnad tills det är klart. Startljudet väntar på riktigt
                # ljud, så att ingen börjar prata in i tystnaden.
                self.feedback.connecting()
                threading.Thread(
                    target=self._announce_when_audio,
                    args=(self._session_seq,),
                    daemon=True,
                    name="viska-headset",
                ).start()
            else:
                self.sounds.start()
                self.feedback.listening()
            if self._watchdog is not None:  # ska inte hända, men läck aldrig
                self._watchdog.cancel()
            self._watchdog = threading.Timer(
                self.cfg["max_recording_s"], self._on_max_time
            )
            self._watchdog.daemon = True
            self._watchdog.start()
            self._live_texts = []
            if self._session_flow:
                # Flow: ingen liveinskrivning. Statusrutan får gärna
                # förhandsvisa pågående text (preview_only), men inget skrivs
                # in förrän dikteringen stoppas och hela transkriptet poleras.
                # Börja ladda poleringsmodellen redan nu så den hinner bli varm.
                self.polishing.warmup()
                if self._live_enabled(transcriber):
                    self._start_live_worker(transcriber, lang, preview_only=True)
            elif self._live_enabled(transcriber):
                self._start_live_worker(transcriber, lang, preview_only=False)
            return True

    def _announce_when_audio(self, seq: int) -> None:
        heard = self.recorder.wait_for_audio(HEADSET_CONNECT_TIMEOUT_S)
        with self._session_lock:
            if seq != self._session_seq or not self.recorder.recording:
                return  # dikteringen hann ta slut
            if not heard:
                log.warning(
                    "Inget ljud från headsetet efter %.0f s", HEADSET_CONNECT_TIMEOUT_S
                )
            self.sounds.start()
            self.feedback.listening()

    def _mic_is_bluetooth(self) -> bool:
        return self._mic_choice is not None and self._mic_choice.bluetooth

    def _choose_mic(self):
        """Anropas av Recorder varje gång strömmen öppnas."""
        choice = mics.resolve(
            self.cfg["input_device"], self.cfg["mic_avoid_bluetooth"]
        )
        if choice != self._mic_choice:
            log.info("Mikrofon: %s", choice.describe())
            self._mic_choice = choice
            self.feedback.mic_changed(choice)
        return choice.device

    def _start_live_worker(
        self, transcriber: Transcriber, lang: str, preview_only: bool
    ) -> None:
        self._live = LiveWorker(
            transcriber,
            self.recorder,
            lang,
            # I preview_only-läget committas aldrig något, så on_commit anropas
            # aldrig — men lämna inget som kan skriva in text mitt i flow.
            on_commit=(lambda _t: None) if preview_only else self._on_live_commit,
            on_partial=self._on_live_partial,
            interval_s=self.cfg["live_interval_s"],
            commit_silence_s=self.cfg["live_commit_silence_s"],
            initial_prompt=self._session_prompt,
            preview_only=preview_only,
            # Flow: förhandsvisningen syns bara i statusrutan och ersätts av
            # den riktiga transkriberingen vid stopp, så den får kosta mindre
            # GPU. Vanligt liveläge skriver in sina fraser på riktigt och
            # behåller därför full sökbredd.
            beam_size=LIVE_PREVIEW_BEAM if preview_only else None,
        )
        self._live.start()

    def _live_enabled(self, transcriber: Transcriber) -> bool:
        live = self.cfg["live"]
        if live == "auto":
            return transcriber.device == "cuda"
        return bool(live)

    def _on_live_commit(self, text: str) -> None:
        text = self.post_process(text)
        self._live_texts.append(text)
        try:
            # Mellanslag mellan fraser oavsett append_space — annars klistras
            # nästa fras fast i den förra. Men aldrig efter en radbrytning.
            if not text.endswith("\n"):
                text += " "
            inject(text, self._session_inject, self.cfg["restore_clipboard"])
        except Exception:
            # Frasen finns kvar i last_text (traymenyn: Kopiera senaste).
            log.exception("Kunde inte skriva in livefrasen")

    def _on_live_partial(self, partial: str) -> None:
        if partial:
            self.feedback.partial(partial)

    def _on_max_time(self) -> None:
        # take_over_key() avgör atomiskt vem som äger stoppet — bara om vi
        # tog en aktiv session får vi stoppa, annars stoppade användaren
        # precis själv.
        if self.take_over_key():
            log.info("Maxtid nådd (%s s) – stoppar", self.cfg["max_recording_s"])
            self.stop()

    def stop(self) -> None:
        with self._session_lock:
            watchdog, self._watchdog = self._watchdog, None
            if watchdog is not None:
                watchdog.cancel()
            self.feedback.recording(False)
            self._session_stopped_at = time.perf_counter()
            # Ljudet fryses FÖRE livearbetaren stoppas. Att vänta in arbetaren
            # först kunde hålla mikrofonen öppen i upp till tio sekunder efter
            # att tangenten släppts, och allt som sades under den väntan
            # hamnade i inspelningen. Nu släpps mikrofonen direkt; arbetaren
            # avvecklas på transkriberingstråden, där dess sista committade
            # frames räknas av mot det redan frysta ljudet.
            live, self._live = self._live, None
            audio = self.recorder.stop()
            # Stoppljudet först när svansen är inspelad, annars kan det
            # komma med i ljudet via högtalarna.
            self.sounds.stop()
            self._transcribing.set()
            self.feedback.transcribing()
            lang = self._session_language
            transcriber = self._session_transcriber
            prompt = self._session_prompt
            inject_mode = self._session_inject
            flow = self._session_flow
            polish_prompt = self._session_polish_prompt
            target_hwnd = self._session_target_hwnd
        threading.Thread(
            target=self._finish,
            args=(
                audio, lang, transcriber, live, prompt, inject_mode,
                flow, polish_prompt, target_hwnd,
            ),
            daemon=True,
            name="viska-transcribe",
        ).start()

    def cancel(self) -> bool:
        """Avbryter en pågående inspelning utan att skriva in något. Fraser
        som liveläget redan skrivit in står kvar. False om inget spelades in."""
        # Tangenten släpps före sessionslåset: tangentens lås tas alltid
        # före sessionslåset (start/stopp anropas med det hållet).
        self.take_over_key()
        with self._session_lock:
            if not self.recorder.recording:
                return False
            watchdog, self._watchdog = self._watchdog, None
            if watchdog is not None:
                watchdog.cancel()
            live, self._live = self._live, None
            self.recorder.stop()
            self.sounds.stop()
            # En väntande startsignal (headsetet) gäller inte längre.
            self._session_seq += 1
            self.feedback.recording(False)
        if live is not None:
            threading.Thread(target=live.stop, daemon=True).start()
        log.info("Dikteringen avbröts – ingenting skrevs in")
        self.feedback.notice("Avbruten")
        return True

    def _finish(
        self,
        audio: np.ndarray,
        lang: str,
        transcriber: Transcriber,
        live: LiveWorker | None,
        prompt: str | None,
        inject_mode: str,
        flow: bool = False,
        polish_prompt: str = "",
        target_hwnd: int | None = None,
    ) -> None:
        try:
            # Avveckla livearbetaren här, inte under sessionslåset: ljudet är
            # redan fryst, så väntan kostar bara den här tråden. Listan läses
            # EFTER att arbetaren stannat — då kan inget pass hinna committa
            # en fras som saknas i last_text.
            committed = live.stop() if live is not None else 0
            live_texts = list(self._live_texts)
            if committed:
                audio = audio[committed:]
            if live_texts:
                # Sätts innan sluttranskriberingen: kastar den ett fel ska
                # de redan inskrivna fraserna ändå finnas i "Kopiera
                # senaste diktering".
                self.last_text = " ".join(live_texts).strip()
            text = ""
            transcribe_ms = 0.0
            too_short = len(audio) < 0.3 * SAMPLE_RATE
            silent = audio.size == 0 or float(np.abs(audio).max()) < 0.003
            if not (too_short or silent) and transcriber is not None:
                with metrics.Timer() as t:
                    text = transcriber.transcribe(audio, lang, initial_prompt=prompt)
                transcribe_ms = t.ms
                text = self.post_process(text)
            if flow and text:
                # Flow-läge: polera hela transkriptet innan inskrivning.
                # live_texts är alltid tomt här (preview_only committar aldrig).
                # _transcribing hålls kvar genom polering + inskrivning (som en
                # längre vanlig diktering): nästa inspelning kan inte starta och
                # skriva in före den polerade texten, och fönstret dikteringen
                # gällde behåller fokus. Poleringen har en hård tidsgräns
                # (FLOW_POLISH_TIMEOUT_S) så väntan aldrig blir oändlig.
                self._finish_flow(
                    text, inject_mode, polish_prompt, target_hwnd, lang,
                    audio_s=len(audio) / SAMPLE_RATE, transcribe_ms=transcribe_ms,
                )
                return
            if live_texts or text:
                self.last_text = " ".join([*live_texts, text]).strip()
                self.last_app = window_app_name(target_hwnd)
                self.remember(self.last_text)
                self.feedback.history_changed()
            if not text:
                if not live_texts and not (too_short or silent):
                    self.feedback.nothing_heard()
                else:
                    self.feedback.idle()
                return
            if self.cfg["append_space"] and not text.endswith("\n"):
                text += " "
            with metrics.Timer() as t:
                inject(text, inject_mode, self.cfg["restore_clipboard"])
            self._record_metrics(
                audio, transcribe_ms, t.ms, len(text), live=bool(live_texts)
            )
            self.feedback.idle()
        except Exception:
            log.exception("Transkriberingen misslyckades")
            self.sounds.error()
            self.feedback.failed()
        finally:
            self._transcribing.clear()

    def post_process(self, text: str) -> str:
        """Ersättningsregler före röstkommandon: en regel ska aldrig kunna
        råka bygga ihop frasen som blir en radbrytning."""
        text = commands.apply_replacements(text, self.cfg["replacements"])
        return commands.apply(text, self.cfg["voice_commands"])

    def _elapsed_since_stop(self) -> float:
        """Millisekunder sedan dikteringen stoppades (0 om okänt)."""
        t0 = self._session_stopped_at
        return (time.perf_counter() - t0) * 1000 if t0 else 0.0

    def _record_metrics(
        self, audio, transcribe_ms: float, inject_ms: float, chars: int, live: bool
    ) -> None:
        metrics.record(
            audio_s=len(audio) / SAMPLE_RATE,
            transcribe_ms=transcribe_ms,
            inject_ms=inject_ms,
            total_ms=self._elapsed_since_stop(),
            chars=chars,
            live=live,
        )

    # -- Flow-läge (automatisk polering före inskrivning) ---------------------------

    def _finish_flow(
        self,
        raw: str,
        inject_mode: str,
        polish_prompt: str,
        target_hwnd: int | None,
        lang: str = "sv",
        audio_s: float = 0.0,
        transcribe_ms: float = 0.0,
    ) -> None:  # noqa: PLR0913
        """Polerar hela dikteringen och skriver in resultatet på en gång.
        Körs synkront på transkriberingstråden med _transcribing kvar satt:
        nästa inspelning kan inte starta förrän texten skrivits in, så den
        polerade texten kan aldrig hamna efter en senare diktering och
        fönstret dikteringen gällde har normalt kvar fokus.

        Både råtexten (först) och den polerade texten (överst) hamnar i
        historiken. Är poleringen otillgänglig, kastar fel eller tar för
        lång tid skrivs råtexten in precis som en vanlig diktering –
        dikteringen får aldrig gå förlorad."""
        # Rå först i historiken: kraschar något efter det här går råversionen
        # ändå att hämta via traymenyn.
        self.last_text = raw
        self.last_app = window_app_name(target_hwnd)
        self.remember(raw)
        self.feedback.history_changed()
        guard = InsertionGuard()
        with metrics.Timer() as t:
            polished, reason = self._polish_for_flow(
                raw, polish_prompt, lang, guard
            )
        polish_ms = t.ms
        if guard.cancelled:
            # Avbrutet: ingenting skrivs in för den här dikteringen. Redan
            # inskriven livetext står kvar — den hör till en annan mekanism
            # och ska inte städas bort av ett avbrott.
            log.info("Flow-dikteringen avbröts – ingenting skrevs in")
            self.feedback.notice("Avbruten – dikteringen finns i historiken")
            return
        if polished and polished.strip() and polished.strip() != raw.strip():
            if not guard.claim("polerad"):
                log.info("Poleringen kom efter att något annat skrivits in")
                self.feedback.idle()
                return
            self.last_text = polished
            self.remember(polished)  # polerad överst
            self.feedback.history_changed()
            out = polished
            done_text = "Klar – polerad"
        else:
            if not guard.claim("rå"):
                self.feedback.idle()
                return
            out = raw
            done_text = {
                "råtext vald": "Råtexten infogad",
                "tidsgräns": "Poleringen svarade inte – råtexten infogad",
                "fel": "Poleringen misslyckades – råtexten infogad",
                "otillgänglig": "Poleringen är inte tillgänglig – råtexten infogad",
            }.get(reason, "Klar – råtexten infogad")
        if self.cfg["append_space"] and not out.endswith("\n"):
            out += " "
        # Poleringen kan ha tagit tid; se till att texten skrivs in i det
        # fönster dikteringen gällde även om fokus hunnit flytta. I normalfallet
        # (fokus kvar) är det en no-op och ingen fokusstöld sker. Är fönstret
        # borta skrivs ingenting: att klistra in i vad som råkar ha fokus nu är
        # värre än att låta texten ligga kvar i historiken.
        if target_hwnd and not focus_window(target_hwnd):
            log.warning("Målfönstret finns inte kvar – texten skrivs inte in")
            self.feedback.notice("Fönstret är borta – texten finns i historiken")
            return
        with metrics.Timer() as t:
            inject(out, inject_mode, self.cfg["restore_clipboard"])
        metrics.record(
            audio_s=audio_s,
            transcribe_ms=transcribe_ms,
            inject_ms=t.ms,
            total_ms=self._elapsed_since_stop(),
            chars=len(out),
            polish_ms=polish_ms,
            flow=True,
        )
        # Kort kvittens: i flow-läget är det inte självklart VAD som hamnade i
        # dokumentet. Vanlig diktering säger fortfarande ingenting — där syns
        # resultatet direkt.
        self.feedback.flow_done(done_text)

    def _polish_for_flow(
        self, text: str, style: str, lang: str = "sv", guard=None
    ):
        """Polerar text medan statusrutan visar två utvägar: skriv in
        råtexten nu, eller avbryt. Ett avbrott märks på vakten
        (guard.cancelled), inte på returvärdet.

        Väntan är inte längre en blind join: en polering som tar några sekunder
        ska gå att hoppa över utan att sitta av tidsgränsen.

        Returnerar (text, orsak). Orsaken driver statusraden: en råtext som
        skrivs in för att modellen teg ska säga just det, inte se ut som ett
        normalt resultat."""
        if not self.polishing.available():
            return None, "otillgänglig"
        result: dict[str, str] = {}
        # Sätts från GUI-tråden när en knapp trycks; läses här.
        choice: dict[str, str] = {}
        done = threading.Event()

        def work():
            try:
                result["text"] = self.polishing.polish(self.cfg, text, style, lang)
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "Flow-poleringen misslyckades (%s) – skriver in råtext",
                    codex.friendly_error(e),
                )
            finally:
                done.set()

        self.feedback.polishing(
            insert_raw=lambda: choice.setdefault("pick", "raw"),
            cancel=lambda: choice.setdefault("pick", "cancel"),
        )
        self._skip_polish = lambda: choice.setdefault("pick", "raw")
        threading.Thread(target=work, daemon=True, name="viska-flow-polish").start()
        deadline = time.monotonic() + flow_polish_timeout_s(text)
        while not done.is_set() and not choice and time.monotonic() < deadline:
            time.sleep(0.03)
        self._skip_polish = None
        # Knapparna bort så att nästa status inte ärver dem.
        self.feedback.inserting()
        if choice.get("pick") == "cancel":
            log.info("Flow-poleringen avbröts av användaren")
            if guard is not None:
                guard.cancel()
            return None, "avbruten"
        if choice.get("pick") == "raw":
            log.info("Användaren valde råtext i stället för att vänta")
            return None, "råtext vald"
        if not done.is_set():
            # Tråden lever kvar och slutför i tysthet (modellen blir varm till
            # nästa gång) – men vi väntar inte, råtexten skrivs in nu.
            log.warning("Flow-poleringen tog för lång tid – skriver in råtext")
            return None, "tidsgräns"
        text_out = result.get("text")
        return text_out, ("polerad" if text_out else "fel")

    # -- Livscykel -----------------------------------------------------------------

    def close(self) -> None:
        self.recorder.close()
