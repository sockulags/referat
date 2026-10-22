"""Transkribering med faster-whisper (CTranslate2). Allt körs lokalt.

Modellerna är KBLab:s KB-Whisper för svenska (tränade på 50 000+ timmar
svenskt tal, ~47 % lägre WER än whisper-large-v3) och laddas direkt via
Hugging Face-repo-id — KBLab publicerar CTranslate2-formatet i repona.
"""

import logging
import os
import sys
import sysconfig
from pathlib import Path

import numpy as np

from viska.gate import PriorityGate

log = logging.getLogger(__name__)

# Vid "auto": bästa svenska modellen som är rimlig per enhet.
AUTO_MODELS = {
    "cuda": "KBLab/kb-whisper-large",
    "cpu": "KBLab/kb-whisper-small",
}


def _auto_cuda_choice(
    polish_active: bool = False, compute_type: str | None = None
) -> tuple[str, str]:
    """VRAM-medvetet val: large float16 kräver ~4 GB — på små kort (t.ex.
    4 GB-laptopar) hade auto annars OOM:at och trillat ner på CPU trots
    att GPU:n räcker gott för medium i int8.

    Är poleringsmodellen (polish_active) aktiverad delar Whisper VRAM med
    Qwen3-4B (~2,4 GB) — large fp16 (~3 GB) + polering + marginal ryms inte
    under ~10 GB, så Whisper kvantiseras till int8_float16 (halverar dess
    VRAM-behov) i stället för att sänka modellstorleken.

    compute_type är bara med för loggens skull: ett explicit värde i config
    vinner alltid över det här valet (se _load: compute = compute_type or
    default_compute) — utan den vetskapen skulle loggen påstå att
    int8_float16 kommer användas även när den faktiska laddningen strax
    efteråt loggar ett annat värde."""
    from viska.gpu import vram_gb

    vram = vram_gb()
    if vram is not None and vram < 6:
        return "KBLab/kb-whisper-medium", "int8_float16"
    if polish_active and vram is not None and vram < 10:
        if compute_type:
            log.info(
                "VRAM %.1f GB räcker inte för kb-whisper-large fp16 samtidigt "
                "med poleringsmodellen – hade valt int8_float16, men "
                "compute_type=%s är satt explicit i config och vinner",
                vram, compute_type,
            )
        else:
            log.info(
                "VRAM %.1f GB räcker inte för kb-whisper-large fp16 samtidigt "
                "med poleringsmodellen – kör Whisper som int8_float16",
                vram,
            )
        return "KBLab/kb-whisper-large", "int8_float16"
    return "KBLab/kb-whisper-large", "float16"


def _add_nvidia_dll_dirs() -> None:
    """Gör pip-installerade CUDA-bibliotek (cuBLAS/cuDNN) hittbara för ctranslate2.

    sysconfig i stället för site.getsitepackages(): den senare pekar på
    bas-interpretern i uv-venv:er. Katalogerna läggs både i DLL-sökvägen
    och på PATH — ctranslate2 laddar biblioteken med LoadLibrary och
    behöver PATH-varianten på vissa system.
    """
    if getattr(sys, "frozen", False):
        # PyInstaller-bygge: GPU-varianten lägger DLL:erna bredvid exe:n.
        exe_dir = Path(sys.executable).parent
        roots = [exe_dir / "_internal" / "nvidia", exe_dir / "nvidia"]
    else:
        roots = [
            Path(sp) / "nvidia"
            for sp in {sysconfig.get_path("purelib"), sysconfig.get_path("platlib")}
        ]
    # Eftermonterat GPU-stöd (förstagångsdialogen/Inställningar).
    from viska.gpu import GPU_LIB_DIR, system_cuda_dirs

    roots.append(GPU_LIB_DIR)
    # Systeminstallerat CUDA Toolkit (CUDA_PATH) — läggs FÖRST så att våra
    # nedladdade/pip-versioner vinner om båda finns (kända versioner).
    for bin_dir in system_cuda_dirs():
        os.add_dll_directory(str(bin_dir))
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    for nvidia in roots:
        if not nvidia.is_dir():
            continue
        for bin_dir in nvidia.glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


class Transcriber:
    def __init__(
        self,
        model: str = "auto",
        device: str = "auto",
        beam_size=None,
        compute_type=None,
        polish_active: bool = False,
    ):
        self.model_name = None
        self.device = None
        self.beam_size = None
        # Ordlista/kontext (Whispers initial_prompt); kan bytas när som helst.
        self.initial_prompt = ""
        self._requested = (model, device, beam_size, compute_type, polish_active)
        # Diktering och mötesljud delar modellen; dikteringen går före.
        self.gate = PriorityGate()
        self._model = self._load()

    def _load(self):
        from faster_whisper import WhisperModel

        model, device, beam_size, compute_type, polish_active = self._requested
        devices = ["cuda", "cpu"] if device == "auto" else [device]
        last_error = None
        for dev in devices:
            if model == "auto" and dev == "cuda":
                name, default_compute = _auto_cuda_choice(polish_active, compute_type)
            else:
                name = AUTO_MODELS[dev] if model == "auto" else model
                default_compute = "float16" if dev == "cuda" else "int8"
            compute = compute_type or default_compute
            try:
                if dev == "cuda":
                    _add_nvidia_dll_dirs()
                # Loggas FÖRE laddningen: hänger den (t.ex. antivirus som
                # skannar nyskrivna CUDA-DLL:er) ska loggen visa var.
                log.info("Laddar %s på %s (%s)…", name, dev, compute)
                loaded = WhisperModel(name, device=dev, compute_type=compute)
                self._warmup(loaded)
                self.model_name = name
                self.device = dev
                self.beam_size = beam_size or (5 if dev == "cuda" else 2)
                log.info("Modell %s laddad på %s (%s)", name, dev, compute)
                return loaded
            except Exception as e:
                last_error = e
                log.warning("Kunde inte ladda %s på %s: %s", name, dev, e)
        raise last_error

    @staticmethod
    def _warmup(model) -> None:
        # En halv sekund tystnad: CUDA/cuDNN-fel visar sig här i stället för
        # vid första dikteringen, och kernels värms så första svaret går fort.
        silence = np.zeros(8000, dtype=np.float32)
        segments, _ = model.transcribe(silence, beam_size=1)
        list(segments)

    def transcribe_segments(
        self,
        audio,
        language: str | None = "sv",
        initial_prompt: str | None = None,
        beam_size: int | None = None,
    ) -> list:
        """Som transcribe(), men returnerar segmentlistan med tidsstämplar —
        liveläget behöver veta var i ljudet varje fras slutar.

        beam_size går att sänka per anrop: förhandsvisningen i flow-läget
        skrivs aldrig in och behöver inte samma sökbredd som slutresultatet."""
        if language == "auto":
            language = None
        prompt = initial_prompt if initial_prompt is not None else self.initial_prompt
        with self.gate.high():
            return self._live_segments(audio, language, prompt, beam_size)

    def _live_segments(self, audio, language, prompt, beam_size) -> list:
        segments, _info = self._model.transcribe(
            audio,
            language=language,
            beam_size=beam_size or self.beam_size,
            initial_prompt=prompt or None,
            vad_filter=True,
            # Kortare padding än batchläget: segmentslutet hamnar närmare
            # verkligt talslut, så tystnadsfönstret som krävs för commit
            # blir tillgängligt tidigare. Klippet skyddas ändå — commit
            # sker bara i RMS-verifierad tystnad.
            vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
            condition_on_previous_text=False,
        )
        return list(segments)

    def transcribe(
        self, audio, language: str | None = "sv", initial_prompt: str | None = None
    ) -> str:
        """`audio` är en float32-array i 16 kHz, eller en sökväg till en ljudfil."""
        if language == "auto":
            language = None
        prompt = initial_prompt if initial_prompt is not None else self.initial_prompt
        with self.gate.high():
            return self._dictation_text(audio, language, prompt)

    def _dictation_text(self, audio, language, prompt) -> str:
        segments, _info = self._model.transcribe(
            audio,
            language=language,
            beam_size=self.beam_size,
            initial_prompt=prompt or None,
            # Silero-VAD klipper tystnad i kanterna; utan den hallucinerar
            # Whisper undertextfraser ("Undertexter från Amara.org") på
            # svenska tystnadsklipp. Explicita värden — defaults har ändrats
            # mellan faster-whisper-versioner.
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 400},
            # True ger hallucinationsloopar på korta dikteringsklipp.
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        text = " ".join(seg.text.strip() for seg in segments)
        return " ".join(text.split())


# Mötesljud skrivs ut i bitar av ungefär den här längden (sekunder), med
# snittet i den tystaste tiondelssekunden inom CUT_SEARCH_S från gränsen,
# så att inget ord delas och en diktering aldrig väntar längre än en bit.
CHUNK_S = 30.0
CUT_SEARCH_S = 5.0


def chunk_bounds(audio: np.ndarray, rate: int = 16000) -> list[tuple[int, int]]:
    """(start, slut) i samplingar för varje bit av ett långt ljud."""
    total = len(audio)
    step = int(CHUNK_S * rate)
    window = rate // 10
    bounds, start = [], 0
    while total - start > step + int(CUT_SEARCH_S * rate):
        lo = start + step - int(CUT_SEARCH_S * rate)
        hi = start + step + int(CUT_SEARCH_S * rate)
        best, best_energy = start + step, None
        for pos in range(lo, hi - window, window):
            energy = float(np.mean(audio[pos : pos + window] ** 2))
            if best_energy is None or energy < best_energy:
                best, best_energy = pos + window // 2, energy
        bounds.append((start, best))
        start = best
    bounds.append((start, total))
    return bounds


def transcribe_long(
    transcriber: "Transcriber",
    audio: np.ndarray,
    language: str | None = "sv",
    initial_prompt: str | None = None,
) -> list[dict]:
    """Ett helt möte: segment med tidsstämplar från början av ljudet. Varje
    bit tar modellen med låg prioritet, så att diktering hinner emellan."""
    if language == "auto":
        language = None
    prompt = initial_prompt if initial_prompt is not None else transcriber.initial_prompt
    result = []
    for start, end in chunk_bounds(audio):
        offset = start / 16000
        with transcriber.gate.low():
            segments, _info = transcriber._model.transcribe(
                audio[start:end],
                language=language,
                beam_size=transcriber.beam_size,
                initial_prompt=prompt or None,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 400},
                condition_on_previous_text=False,
            )
            for seg in segments:
                text = " ".join(seg.text.split())
                if text:
                    result.append(
                        {"start": seg.start + offset, "end": seg.end + offset, "text": text}
                    )
    return result
