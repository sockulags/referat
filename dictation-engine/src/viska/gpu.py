"""GPU-stöd som eftermontering.

Laddar ner cuBLAS/cuDNN/nvRTC-wheels från PyPI och packar upp DLL:erna i
%APPDATA%\\viska\\nvidia\\ — så kan ett och samma (CPU-)paket uppgraderas
till GPU-läge i efterhand, vid första starten eller från Inställningar,
utan pip, ombyggnad eller adminrättigheter. Enda nätverkstrafiken är
biblioteksnedladdningen; ingen användardata skickas någonstans.
"""

import json
import logging
import os
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from viska.config import CONFIG_DIR

log = logging.getLogger(__name__)

GPU_LIB_DIR = CONFIG_DIR / "nvidia"
# PATH som den såg ut innan appen laddat några modeller —
# transcribe._add_nvidia_dll_dirs lägger våra egna nedladdade kataloger
# på processens PATH, och de får inte misstas för systemets CUDA.
_ORIGINAL_PATH = os.environ.get("PATH", "")
# CUDA-DLL:er som är inladdade i processen är låsta och kan inte raderas
# förrän appen startats om — markören skjuter upp borttagningen dit.
_REMOVE_MARKER = CONFIG_DIR / "nvidia.remove"
# ctranslate2 (via faster-whisper) kräver de tre första vid CUDA-körning
# (cuBLAS/cuDNN laddar i sin tur nvRTC dynamiskt); cudart behövs av
# llama.cpp:s CUDA-bygge för poleringsfunktionen.
PACKAGES = (
    "nvidia-cublas-cu12",
    "nvidia-cudnn-cu12",
    "nvidia-cuda-nvrtc-cu12",
    "nvidia-cuda-runtime-cu12",
)
DOWNLOAD_SIZE_GB = 1.4  # ungefärlig total, för dialogtexter


def has_nvidia_gpu() -> bool:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return False
    try:
        r = subprocess.run(
            [exe, "-L"],
            capture_output=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return r.returncode == 0 and b"GPU" in r.stdout
    except Exception:
        return False


def vram_gb() -> float | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        r = subprocess.run(
            [exe, "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            timeout=10,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return int(r.stdout.strip().splitlines()[0]) / 1024
    except Exception:
        return None


def gpu_name() -> str | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        r = subprocess.run(
            [exe, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            timeout=10,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        name = r.stdout.strip().splitlines()
        return name[0] if r.returncode == 0 and name else None
    except Exception:
        return None


# Nyckelfiler som måste finnas för att CUDA ska fungera. Kollas efter
# nedladdning och vid varje statusfråga: en ofullständig installation
# (avbrott, AV-karantän, manuell radering) ska synas som "inte
# installerad" och gå att göra om — inte tyst halvfungera.
_REQUIRED_DLLS = (
    "cublas/bin/cublas64_12.dll",
    "cublas/bin/cublasLt64_12.dll",
    "cudnn/bin/cudnn64_9.dll",
    "cudnn/bin/cudnn_ops64_9.dll",
    "cuda_nvrtc/bin/nvrtc64_120_0.dll",
    "cuda_runtime/bin/cudart64_12.dll",
)


def _libs_complete() -> bool:
    return all((GPU_LIB_DIR / rel).is_file() for rel in _REQUIRED_DLLS)


def downloaded_libs_installed() -> bool:
    """Eftermonterade DLL:er i appdatan (de vi själva kan ta bort)."""
    if _REMOVE_MARKER.exists():
        return False  # borttagning väntar på omstart
    return _libs_complete()


def system_cuda_dirs() -> list[Path]:
    """CUDA Toolkit-kataloger utanför vår kontroll (CUDA_PATH-installation)."""
    dirs = []
    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path and (Path(cuda_path) / "bin").is_dir():
        dirs.append(Path(cuda_path) / "bin")
    return dirs


def system_cuda_available() -> bool:
    """Har datorn redan en komplett CUDA-runtime (toolkit + cuDNN)?

    Kollar allt Viska behöver: cuBLAS 12 + cuDNN 9 (ctranslate2) samt
    cudart 12 + nvRTC (llama.cpp:s CUDA-bygge, poleringen). Saknas något
    fyller vår nedladdning luckan i stället. Söker bara i PATH som den
    såg ut vid appstart plus CUDA_PATH — processens PATH innehåller även
    våra egna nedladdade kataloger, som inte får misstas för systemets.
    """
    gpu_root = str(GPU_LIB_DIR).lower()
    search_dirs = list(system_cuda_dirs()) + [
        Path(entry)
        for entry in _ORIGINAL_PATH.split(os.pathsep)
        if entry and not entry.lower().startswith(gpu_root)
    ]

    def found(name: str) -> bool:
        return any((d / f"{name}.dll").is_file() for d in search_dirs)

    return all(
        found(name)
        for name in ("cublas64_12", "cudnn64_9", "nvrtc64_120_0", "cudart64_12")
    )


def gpu_support_present() -> bool:
    """Finns CUDA-biblioteken någonstans där transcribe letar?"""
    if system_cuda_available():
        return True
    if downloaded_libs_installed():
        return True
    if getattr(sys, "frozen", False):
        bundled = Path(sys.executable).parent / "_internal" / "nvidia"
        return bundled.is_dir() and any(bundled.glob("*/bin/*.dll"))
    pip_nvidia = Path(sysconfig.get_path("purelib")) / "nvidia"
    return pip_nvidia.is_dir() and any(pip_nvidia.glob("*/bin/*.dll"))


def _wheel_url(package: str) -> tuple[str, int]:
    with urllib.request.urlopen(
        f"https://pypi.org/pypi/{package}/json", timeout=30
    ) as r:
        data = json.load(r)
    for f in data["urls"]:
        if f["filename"].endswith("win_amd64.whl"):
            return f["url"], f["size"]
    raise RuntimeError(f"Ingen Windows-wheel hittades för {package}")


def download_gpu_libs(progress=None, cancelled=None) -> None:
    """Laddar ner och packar upp DLL:erna till GPU_LIB_DIR.

    progress(text, andel 0..1) anropas löpande; cancelled() -> bool
    kollas mellan block. Vid fel eller avbrott städas allt bort —
    en halvfärdig installation är värre än ingen.
    """
    if progress:
        progress("Hämtar paketlista…", 0.0)
    plan = [(pkg, *_wheel_url(pkg)) for pkg in PACKAGES]
    total = sum(size for _, _, size in plan)
    done = 0
    shutil.rmtree(GPU_LIB_DIR, ignore_errors=True)
    _REMOVE_MARKER.unlink(missing_ok=True)
    tmp_root = Path(tempfile.mkdtemp(prefix="viska-gpu-"))
    try:
        for pkg, url, _size in plan:
            whl = tmp_root / f"{pkg}.whl"
            with urllib.request.urlopen(url, timeout=60) as r, open(whl, "wb") as f:
                while chunk := r.read(1 << 20):
                    if cancelled and cancelled():
                        raise InterruptedError("Nedladdningen avbröts")
                    f.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(f"Laddar ner {pkg}…", min(done / total, 0.99))
            with zipfile.ZipFile(whl) as z:
                root = GPU_LIB_DIR.resolve()
                for member in z.namelist():
                    if (
                        member.startswith("nvidia/")
                        and "/bin/" in member
                        and member.endswith(".dll")
                    ):
                        dest = (root / Path(member).relative_to("nvidia")).resolve()
                        if not dest.is_relative_to(root):
                            continue  # zip-slip-skydd: aldrig utanför målmappen
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with z.open(member) as src, open(dest, "wb") as out:
                            shutil.copyfileobj(src, out)
            whl.unlink()
        if not _libs_complete():
            missing = [r for r in _REQUIRED_DLLS if not (GPU_LIB_DIR / r).is_file()]
            raise RuntimeError(
                f"Installationen blev ofullständig ({', '.join(missing)}) – "
                "försök igen; kontrollera antivirus om det upprepas"
            )
        log.info("GPU-bibliotek installerade i %s", GPU_LIB_DIR)
        if progress:
            progress("Klart", 1.0)
    except BaseException:
        shutil.rmtree(GPU_LIB_DIR, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def remove_gpu_libs() -> bool:
    """Tar bort de eftermonterade biblioteken. Returnerar True om de
    försvann nu; False om de är låsta (CUDA aktivt) och tas bort vid
    nästa start i stället."""
    try:
        shutil.rmtree(GPU_LIB_DIR)
        _REMOVE_MARKER.unlink(missing_ok=True)
        log.info("GPU-bibliotek borttagna")
        return True
    except FileNotFoundError:
        _REMOVE_MARKER.unlink(missing_ok=True)
        return True
    except OSError:
        _REMOVE_MARKER.touch()
        log.info("GPU-bibliotek låsta av processen – tas bort vid nästa start")
        return False


def cleanup_pending_removal() -> None:
    """Körs tidigt vid uppstart, innan några CUDA-DLL:er laddats."""
    if _REMOVE_MARKER.exists():
        shutil.rmtree(GPU_LIB_DIR, ignore_errors=True)
        _REMOVE_MARKER.unlink(missing_ok=True)
