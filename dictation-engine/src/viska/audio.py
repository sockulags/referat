"""Mikrofoninspelning: 16 kHz mono float32, formatet Whisper vill ha.

Tre lägen (config: mic_mode) styr när strömmen är öppen, för Windows visar
mikrofonikonen i aktivitetsfältet så länge den är det:

- "on_demand" (förval): strömmen öppnas vid dikteringen och stängs ett par
  sekunder efter den sista. Ikonen syns bara när Viska faktiskt lyssnar.
  Fördröjningen (mic_idle_close_s) gör att diktering på diktering ändå
  slipper öppningskostnaden och behåller förstarten. Ett Bluetooth-headset
  stängs direkt: så länge dess mikrofon är öppen står headsetet i
  samtalsläge.
- "always": strömmen står alltid öppen mot en liten ringbuffert i RAM.
  ~0,25 s förstart tas därifrån vid varje inspelning — att öppna en
  WASAPI-ström tar 100–300 ms och skulle annars klippa första stavelsen.
- "closed": strömmen stängs direkt efter varje diktering.

Ljudet lämnar aldrig processen.

Vilken mikrofon som öppnas avgörs vid varje öppning (se mics.py), så att
ett Bluetooth-headset som blivit Windows standard inte används i onödan.

PortAudio fryser enhetslistan vid init och följer inte Windows byte av
standardmikrofon. Före varje öppning jämförs därför Windows lista över
inspelningsenheter med den som gällde förra gången; har något anslutits
eller kopplats bort byggs PortAudio om, så att ett nyss anslutet headset
syns direkt. En vakthund upptäcker att callbacken tystnat (enheten
försvann) och bygger då om PortAudio; traymenyn kan också trigga det
manuellt via restart().
"""

import logging
import threading
import time
from collections import deque

import numpy as np
import sounddevice as sd

from viska import mics

log = logging.getLogger(__name__)

SAMPLE_RATE = 16000
BLOCK = 800  # 50 ms per callback-block
# Hur länge efter tangentsläppet ljudet fortsätter att tas med. Det sista
# ordet klingar ofta ut efter att fingret lämnat tangenten, och blocket som
# fylls just då kommer först när det är fullt.
TAIL_S = 0.12
# Nivå (RMS) som räknas som riktigt ljud. Ett Bluetooth-headset som byter
# till samtalsläge levererar ren tystnad tills länken är uppe; även ett
# tyst rum ligger tydligt över det här.
AUDIO_FLOOR = 1e-4


ALWAYS = "always"
ON_DEMAND = "on_demand"
CLOSED = "closed"
MODES = (ALWAYS, ON_DEMAND, CLOSED)


class Recorder:
    def __init__(
        self,
        input_device=None,
        mode: str = ON_DEMAND,
        preroll_s: float = 0.25,
        idle_close_s: float = 20.0,
        tail_s: float = TAIL_S,
        close_now=None,
    ):
        # Ett fast val, eller en funktion som väljer vid varje öppning.
        self._device = input_device
        self._mode = mode if mode in MODES else ON_DEMAND
        self._idle_close_s = max(0.0, float(idle_close_s))
        self._tail_s = max(0.0, float(tail_s))
        # Anropas vid stopp: True = stäng direkt oavsett läge (headset).
        self._close_now = close_now
        self._idle_timer: threading.Timer | None = None
        self._preroll_blocks = max(0, int(preroll_s * SAMPLE_RATE / BLOCK))
        self._ring = deque(maxlen=self._preroll_blocks + 2)
        self._chunks = None  # None = spelar inte in
        # _lock skyddar buffertarna (delas med ljudcallbacken och får bara
        # hållas ögonblick); _stream_lock serialiserar öppna/stänga/byta
        # ström mellan hotkey-tråden och trayns omstart. Håll aldrig _lock
        # under strömoperationer: stream.stop() väntar in callbacken, som
        # själv tar _lock.
        self._lock = threading.Lock()
        # Väcks av callbacken för varje nytt block; stop() väntar på svansen.
        self._block_arrived = threading.Condition(self._lock)
        self._last_block_t = 0.0
        self._heard_audio = False
        self._stream_lock = threading.Lock()
        self._stream = None
        self._endpoints = None  # Windows enhetslista vid förra öppningen
        self._last_frame_t = 0.0
        self.level = 0.0
        if self._mode == ALWAYS:
            try:
                with self._stream_lock:
                    self._open_stream()
            except Exception:
                log.exception("Kunde inte öppna mikrofonen vid start")

    @property
    def recording(self) -> bool:
        with self._lock:
            return self._chunks is not None

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def stream_open(self) -> bool:
        return self._stream is not None

    def start(self) -> bool:
        """Börjar spela in. True om strömmen just öppnades (ingen förstart,
        och ett headset kan behöva tid innan ljudet kommer)."""
        with self._stream_lock:
            self._cancel_idle_close()
            already_open = self._stream is not None
            self._ensure_stream()
            with self._lock:
                self._heard_audio = False
                # Förstart finns bara om strömmen redan var öppen: en nyss
                # öppnad ström har ingen historik att ta med.
                preroll = []
                if already_open and self._preroll_blocks:
                    preroll = list(self._ring)[-self._preroll_blocks:]
                self._chunks = preroll
            return not already_open

    def wait_for_audio(self, timeout: float) -> bool:
        """Väntar tills inspelningen fått riktigt ljud. False vid tidsgräns."""
        deadline = time.monotonic() + timeout
        with self._lock:
            while not self._heard_audio:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self._chunks is None:
                    return False
                self._block_arrived.wait(remaining)
            return True

    def stop(self) -> np.ndarray:
        with self._stream_lock:
            with self._lock:
                self._wait_for_tail()
                chunks, self._chunks = self._chunks, None
                self._ring.clear()  # spara inget ljud mellan dikteringar
            if self._mode == CLOSED or self._should_close_now():
                self._close_stream()
            elif self._mode == ON_DEMAND:
                self._schedule_idle_close()
        if not chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(chunks)[:, 0]

    def snapshot(self, start_frame: int = 0) -> np.ndarray:
        """Ljudet hittills, från och med start_frame (för liveläget).

        Blocken är alltid BLOCK frames stora, så starten hittas med
        heltalsaritmetik i stället för att konkatenera hela inspelningen.
        """
        with self._lock:
            if self._chunks is None:
                return np.zeros(0, dtype=np.float32)
            skip, offset = divmod(start_frame, BLOCK)
            tail = self._chunks[skip:]
        if not tail:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(tail)[offset:, 0]

    def restart(self) -> None:
        """Byt till den mikrofon som nu är systemets standard."""
        with self._stream_lock:
            self._cancel_idle_close()
            with self._lock:
                self._chunks = None
            self._close_stream()
            self._reset_portaudio()
            if self._mode == ALWAYS:
                self._open_stream()

    def set_mode(self, mode: str, idle_close_s: float | None = None) -> None:
        """Byter läge live från Inställningar: öppnar eller stänger strömmen
        så att mikrofonikonen omedelbart stämmer med det valda läget."""
        if idle_close_s is not None:
            self._idle_close_s = max(0.0, float(idle_close_s))
        if mode not in MODES or mode == self._mode:
            return
        self._mode = mode
        with self._stream_lock:
            self._cancel_idle_close()
            if self.recording:
                return  # en pågående diktering rörs inte; nästa stop() gäller
            if mode == ALWAYS:
                if self._stream is None:
                    try:
                        self._open_stream()
                    except Exception:
                        log.exception("Kunde inte öppna mikrofonen")
            else:
                self._close_stream()

    def close(self) -> None:
        """Stänger ner allt (vid avslut)."""
        with self._stream_lock:
            self._cancel_idle_close()
            self._close_stream()

    # -- Internt --------------------------------------------------------------

    def _callback(self, indata, frames, time_info, status) -> None:
        now = time.monotonic()
        self._last_frame_t = now
        # Nivå för overlayns mätare; läses från GUI-tråden utan lås
        # (float-skrivning är atomär, värdet är rent kosmetiskt).
        self.level = float(np.sqrt(np.mean(indata**2)))
        with self._lock:
            if self._chunks is not None:
                self._chunks.append(indata.copy())
                if self.level > AUDIO_FLOOR:
                    self._heard_audio = True
            else:
                self._ring.append(indata.copy())
            self._last_block_t = now
            self._block_arrived.notify_all()

    def _wait_for_tail(self) -> None:
        """Låt inspelningen löpa tail_s till efter tangentsläppet.

        Anropas med _lock hållet; Condition.wait släpper det så att
        callbacken kan lägga till block under tiden. Ett block som kommer
        in efter (släpp + tail_s) innehåller allt fram till dess. En ström
        som tystnat ger upp efter en kort tidsgräns i stället för att hänga.
        """
        if self._chunks is None or self._stream is None or self._tail_s <= 0:
            return
        wanted = time.monotonic() + self._tail_s
        deadline = wanted + 2 * BLOCK / SAMPLE_RATE + 0.1
        while self._last_block_t < wanted:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            self._block_arrived.wait(remaining)

    def _should_close_now(self) -> bool:
        try:
            return bool(self._close_now and self._close_now())
        except Exception:
            log.exception("Kunde inte avgöra om mikrofonen ska stängas direkt")
            return False

    def _schedule_idle_close(self) -> None:
        """Anropas med _stream_lock hållet."""
        if self._idle_close_s <= 0:
            self._close_stream()
            return
        timer = threading.Timer(self._idle_close_s, self._idle_close)
        timer.daemon = True
        self._idle_timer = timer
        timer.start()

    def _cancel_idle_close(self) -> None:
        timer, self._idle_timer = self._idle_timer, None
        if timer is not None:
            timer.cancel()

    def _idle_close(self) -> None:
        with self._stream_lock:
            self._idle_timer = None
            # En diktering som hann starta medan timern väntade på låset äger
            # strömmen — då stänger vi ingenting.
            if self.recording or self._mode != ON_DEMAND:
                return
            log.debug(
                "Ingen diktering på %.0f s – stänger mikrofonen", self._idle_close_s
            )
            self._close_stream()

    def _ensure_stream(self) -> None:
        if self._stream is not None:
            if time.monotonic() - self._last_frame_t < 1.0:
                return
            log.warning("Ljudströmmen har tystnat (enhet borta?) – bygger om")
            self._close_stream()
            self._reset_portaudio()
        self._open_stream()

    def _open_stream(self) -> None:
        endpoints = mics.endpoint_signature()
        if self._endpoints is not None and endpoints != self._endpoints:
            log.info("Mikrofonerna har ändrats – läser in dem på nytt")
            self._reset_portaudio()
        self._endpoints = endpoints
        try:
            stream = self._start_stream(self._current_device())
        except (sd.PortAudioError, ValueError):
            # PortAudio läser in enheterna bara när den startar; en lista
            # från före en ändring ger fel enhet eller ingen alls.
            log.warning(
                "Mikrofonen gick inte att öppna – läser in mikrofonerna och "
                "försöker igen",
                exc_info=True,
            )
            self._reset_portaudio()
            self._endpoints = mics.endpoint_signature()
            stream = self._start_stream(self._current_device())
        self._stream = stream
        self._last_frame_t = time.monotonic()

    def _current_device(self):
        return self._device() if callable(self._device) else self._device

    def _start_stream(self, device):
        """Öppnar och startar strömmen. En WASAPI-mikrofon i delat läge tar
        bara sin egen samplingsfrekvens, oftast 48 kHz; med auto_convert
        gör Windows om ljudet till 16 kHz. Felet kommer ibland först när
        strömmen startar (AUDCLNT_E_UNSUPPORTED_FORMAT), så båda stegen
        prövas. PortAudios standardenhet är inte WASAPI och tar inte
        inställningen; den klarar 16 kHz själv."""
        kwargs = dict(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=BLOCK,
            device=device,
            callback=self._callback,
        )
        error = None
        for extra in ({"extra_settings": sd.WasapiSettings(auto_convert=True)}, {}):
            stream = None
            try:
                stream = sd.InputStream(**kwargs, **extra)
                stream.start()
                return stream
            except (sd.PortAudioError, ValueError) as exc:
                error = exc
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass
        raise error

    def _close_stream(self) -> None:
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

    @staticmethod
    def _reset_portaudio() -> None:
        # Privata API:er, men etablerat mönster för att få PortAudio att se
        # nya enheter (python-sounddevice #47/#382). Kräver att alla strömmar
        # är stängda först.
        try:
            sd._terminate()
            sd._initialize()
        except Exception:
            log.exception("Kunde inte starta om PortAudio")
