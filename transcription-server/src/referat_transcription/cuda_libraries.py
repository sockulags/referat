"""Make the bundled CUDA libraries findable before CTranslate2 asks for them.

CTranslate2 loads cuBLAS 12 and cuDNN 9 by name only when a model runs on CUDA.
The GPU component ships them from the `nvidia-*-cu12` wheels, whose DLLs live in
`nvidia/<library>/bin` — a directory Windows never searches on its own. The CPU
component has no such directories, so this is a no-op there.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _nvidia_roots() -> list[Path]:
    roots: list[Path] = []
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        roots.append(Path(bundle) / "nvidia")
    try:
        import nvidia  # type: ignore[import-not-found]

        roots.extend(Path(path) for path in nvidia.__path__)
    except ImportError:
        pass
    return roots


def register_cuda_libraries() -> list[str]:
    """Add every bundled `nvidia/*/bin` directory to the DLL search path."""
    if sys.platform != "win32":
        return []
    directories: list[str] = []
    for root in _nvidia_roots():
        for candidate in sorted(root.glob("*/bin")):
            path = str(candidate.resolve())
            if candidate.is_dir() and path not in directories:
                directories.append(path)
    for directory in directories:
        os.add_dll_directory(directory)
    if directories:
        # CTranslate2 and cuDNN load libraries by bare name with LoadLibrary,
        # which consults PATH but not os.add_dll_directory.
        os.environ["PATH"] = os.pathsep.join([*directories, os.environ.get("PATH", "")])
    return directories
