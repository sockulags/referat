"""Builds the dictation engine, viska-engine.exe, with PyInstaller.

    uv run python build.py          # CPU
    uv run python build.py --gpu    # with the CUDA libraries Whisper uses

Result: dist/viska-engine/viska-engine.exe. The model is not bundled; the
engine downloads it from Hugging Face the first time it runs.
"""

import argparse
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path

ROOT = Path(__file__).parent

# referat shows the interface and rewrites with its own AI service, so the
# engine's lazily imported rewrite backends never run and stay out.
EXCLUDED = ("tkinter", "llama_cpp", "openai_codex", "codex_cli_bin")

# What CTranslate2 needs on Windows: cuBLAS (loaded by name) and the CUDA
# runtime.
NVIDIA_LIBS = ("cublas", "cuda_runtime")


def copy_nvidia_dlls(dist: Path) -> None:
    # Mirrors the lookup at run time (nvidia/*/bin).
    nvidia = Path(sysconfig.get_path("purelib")) / "nvidia"
    bin_dirs = sorted(nvidia.glob("*/bin")) if nvidia.is_dir() else []
    bin_dirs = [d for d in bin_dirs if d.parent.name in NVIDIA_LIBS]
    if not bin_dirs:
        sys.exit(f"No DLLs under {nvidia}; run 'uv sync --extra gpu' before --gpu.")
    for src in bin_dirs:
        lib = src.parent.name
        shutil.copytree(src, dist / "_internal" / "nvidia" / lib / "bin")
        print(f"Copied the {lib} DLLs")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpu", action="store_true", help="bundle the CUDA libraries")
    args = parser.parse_args()
    # A console program, so that stdin and stdout exist; referat starts it
    # hidden.
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--noconfirm", "--clean", "--console",
            "--name", "viska-engine",
            "--collect-data", "faster_whisper",
            *[arg for pkg in EXCLUDED for arg in ("--exclude-module", pkg)],
            str(ROOT / "run_engine.py"),
        ],
        check=True,
        cwd=ROOT,
    )
    dist = ROOT / "dist" / "viska-engine"
    if args.gpu:
        copy_nvidia_dlls(dist)
    size_mb = sum(f.stat().st_size for f in dist.rglob("*")) // 1_000_000
    print(f"\nDone: {dist / 'viska-engine.exe'} ({size_mb} MB)")


if __name__ == "__main__":
    main()
