"""Livetranskribering: text skrivs in medan du fortfarande pratar.

Whisper är ingen streamingmodell — den bearbetar hela klipp i taget.
Livekänslan skapas genom att ljudet sedan senaste "committen"
transkriberas om varje intervall. Ett segment räknas som färdigt när det
följs av tillräcklig tystnad: färdig text skrivs in direkt och rörs
aldrig igen, medan den ofärdiga svansen bara förhandsvisas i overlayn
(den kan ändras mellan passen och får därför inte skrivas in i målappen).

Kräver i praktiken GPU: på CPU tar omtranskriberingen längre tid än
intervallet och läget stängs av ("auto" i config).
"""

import logging
import threading
import time

import numpy as np

from viska.audio import SAMPLE_RATE

log = logging.getLogger(__name__)


class LiveWorker:
    def __init__(
        self,
        transcriber,
        recorder,
        language: str,
        on_commit,
        on_partial,
        interval_s: float = 0.4,
        commit_silence_s: float = 0.45,
        max_window_s: float = 18.0,
        initial_prompt: str | None = None,
        preview_only: bool = False,
        beam_size: int | None = None,
    ):
        self.transcriber = transcriber
        self.recorder = recorder
        self.language = language
        self.on_commit = on_commit
        self.on_partial = on_partial
        self.interval_s = interval_s
        self.commit_silence_s = commit_silence_s
        self.max_window_s = max_window_s
        self.initial_prompt = initial_prompt
        # Flow-läget: förhandsvisa pågående text men committa aldrig — inget
        # skrivs in förrän dikteringen är klar (då poleras hela transkriptet).
        # committed_frames stannar på 0 så att _finish transkriberar allt.
        self.preview_only = preview_only
        # Sökbredd för livepassen. Flow-lägets förhandsvisning skrivs aldrig
        # in och kan därför köra billigare än sluttranskriberingen.
        self.beam_size = beam_size
        # Hur lång tid förra passet tog. Nästa pass startar tidigast så långt
        # efter det förra: tar transkriberingen längre tid än intervallet
        # köar passen annars upp sig och GPU:n får aldrig komma ikapp.
        self._last_pass_s = 0.0
        self.committed_frames = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="viska-live"
        )

    def start(self) -> None:
        self._thread.start()

    # RMS-tröskel för "det är tyst här": tal ligger på ~0,02–0,1,
    # rumsbrus/andning under ~0,005.
    _SILENCE_RMS = 0.005

    def stop(self) -> int:
        """Stoppar arbetaren och returnerar antal frames som redan skrivits in.

        Returvärdet är stabilt även om ett pass fortfarande kör: _pass
        kastar sitt resultat när stopp har begärts, så committed_frames
        kan inte längre ändras efter set().
        """
        self._stop.set()
        self._thread.join(timeout=10)
        if self._thread.is_alive():
            log.warning("Livearbetaren svarar inte – dess pågående pass ignoreras")
        return self.committed_frames

    def _run(self) -> None:
        while not self._stop.wait(max(self.interval_s, self._last_pass_s)):
            t0 = time.perf_counter()
            try:
                self._pass()
            except Exception:
                log.exception("Livepasset misslyckades")
            finally:
                self._last_pass_s = time.perf_counter() - t0

    def _pass(self) -> None:
        audio = self.recorder.snapshot(self.committed_frames)
        n = len(audio)
        if n < int(0.6 * SAMPLE_RATE):
            return
        window_offset = n > int(self.max_window_s * SAMPLE_RATE)
        if window_offset:
            # Lång monolog utan en enda paus: det finns inget som är säkert
            # att skriva in (inskriven text kan inte revideras), så
            # förhandsvisa bara svansen. Allt ocommittat transkriberas i sin
            # helhet vid stopp.
            audio = audio[-int(12.0 * SAMPLE_RATE):]
        if float(np.abs(audio).max()) < 0.003:
            return
        segments = self.transcriber.transcribe_segments(
            audio,
            self.language,
            initial_prompt=self.initial_prompt,
            beam_size=self.beam_size,
        )
        if self._stop.is_set():
            return  # stoppad under transkriberingen: resten tas batchvis
        if not segments:
            return
        final = []
        if not window_offset and not self.preview_only:
            # Committa den längsta prefixen av segment som var och en följs
            # av verifierad tystnad i själva vågformen — tidsstämplar från
            # Whisper/VAD räcker inte för att veta att talet är färdigt.
            # Slutar frasen med skiljetecken har Whisper hört ett meningsslut:
            # då räcker en kortare paus — inskrivningen följer talrytmen.
            for s in segments:
                ends_sentence = s.text.rstrip().endswith((".", "!", "?", "…"))
                needed = (
                    max(0.25, self.commit_silence_s - 0.15)
                    if ends_sentence
                    else self.commit_silence_s
                )
                if self._followed_by_silence(audio, s.end, needed):
                    final.append(s)
                else:
                    break
        if final:
            # Räknaren flyttas FÖRE callbacken: kastar inject ett fel får
            # samma ljud inte transkriberas och skrivas in en gång till.
            self.committed_frames += int(final[-1].end * SAMPLE_RATE)
            text = " ".join(s.text.strip() for s in final)
            text = " ".join(text.split())
            if text:
                try:
                    self.on_commit(text)
                except Exception:
                    log.exception("on_commit misslyckades")
        partial = " ".join(s.text.strip() for s in segments[len(final):])
        partial = " ".join(partial.split())
        if window_offset and partial:
            partial = "… " + partial
        try:
            self.on_partial(partial)
        except Exception:
            log.exception("on_partial misslyckades")

    def _followed_by_silence(
        self, audio: np.ndarray, end_s: float, silence_s: float
    ) -> bool:
        need = int(silence_s * SAMPLE_RATE)
        start = int(end_s * SAMPLE_RATE)
        window = audio[start : start + need]
        if len(window) < need:
            return False  # bufferten räcker inte ännu — avgörs nästa pass
        return float(np.sqrt(np.mean(window**2))) < self._SILENCE_RMS
