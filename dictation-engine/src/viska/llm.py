"""Lokal poleringsmodell (llama.cpp + Qwen) — "markera, tryck F8, få
omskriven text". Allt körs på egna GPU:n; ingen text lämnar datorn.

Modellen (~2,4 GB GGUF) laddas ner vid behov till %APPDATA%\\viska\\llm,
samma eftermonteringsmönster som GPU-stödet. Kräver i praktiken GPU:
4B-modellen på CPU tar tiotals sekunder per omskrivning.
"""

import importlib.util
import logging
import os
import shutil
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from viska.config import CONFIG_DIR

log = logging.getLogger(__name__)

LLM_DIR = CONFIG_DIR / "llm"
LLAMA_LIB_DIR = LLM_DIR / "lib"
_REMOVE_MARKER = CONFIG_DIR / "llm.remove"
MODEL_SIZE_GB = 2.4
RUNTIME_SIZE_GB = 0.5
# llama.cpp-motorn (CUDA-bygge, py3-none = versionsoberoende ren Python +
# DLL:er). Bundlas INTE i exe:n — ggml-cuda.dll ensam är 900 MB — utan
# eftermonteras hit tillsammans med modellen. Samma wheel som uv
# installerar i utvecklingsmiljön (pinnad i uv.lock).
RUNTIME_URL = (
    "https://github.com/abetlen/llama-cpp-python/releases/download/"
    "v0.3.33-cu124/llama_cpp_python-0.3.33-py3-none-win_amd64.whl"
)


def model_path(cfg: dict) -> Path:
    p = Path(cfg["polish_model_file"])
    # Absolut sökväg = användarens egen GGUF (t.ex. en Ollama-blob).
    return p if p.is_absolute() else LLM_DIR / p


def model_installed(cfg: dict) -> bool:
    p = model_path(cfg)
    if not p.is_relative_to(LLM_DIR):
        return p.is_file()  # egen fil: markören gäller bara vår katalog
    if _REMOVE_MARKER.exists():
        return False
    return p.is_file()


def _bundled_runtime_dir() -> Path | None:
    """llama_cpp-paketets egna lib-katalog (utvecklingsmiljö; i exe:n är
    den bortstädad av build.py). find_spec importerar inte paketet — en
    import skulle försöka ladda DLL:erna direkt."""
    try:
        spec = importlib.util.find_spec("llama_cpp")
        if spec and spec.submodule_search_locations:
            lib = Path(spec.submodule_search_locations[0]) / "lib"
            if (lib / "llama.dll").is_file():
                return lib
    except Exception:
        pass
    return None


def runtime_installed() -> bool:
    if _REMOVE_MARKER.exists() and not _bundled_runtime_dir():
        return False
    return (
        _bundled_runtime_dir() is not None
        or (LLAMA_LIB_DIR / "llama.dll").is_file()
    )


# Backends som inte kör i vår egen process. De delar inte VRAM med Whisper,
# de kan inte förladdas, och "installerad" betyder för dem "svarar den?".
REMOTE_BACKENDS = ("ollama", "http", "codex")


def is_remote(cfg: dict) -> bool:
    return cfg["polish_backend"] in REMOTE_BACKENDS


def installed(cfg: dict) -> bool:
    if is_remote(cfg):
        return remote_reachable(cfg)
    return model_installed(cfg) and runtime_installed()


def installed_local(cfg: dict) -> bool:
    """Är den INBYGGDA motorn nedladdad? Oberoende av vilken backend som är
    vald, och utan nätverksanrop — panelen för nedladdning/borttagning ska
    kunna ritas direkt även när en fjärrtjänst är vald."""
    return model_installed(cfg) and runtime_installed()


def remote_reachable(cfg: dict) -> bool:
    if cfg["polish_backend"] == "ollama":
        return ollama_reachable(cfg)
    if cfg["polish_backend"] == "http":
        return http_reachable(cfg)
    if cfg["polish_backend"] == "codex":
        from viska import codex

        return codex.ready()
    return False


def polish_remote(cfg: dict, text: str, style: str = "", lang: str = "sv") -> str:
    """Codex hanteras inte här: den motorn har en process som ska leva mellan
    poleringarna, så App äger instansen och anropar den direkt."""
    if cfg["polish_backend"] == "ollama":
        return polish_ollama(cfg, text, style, lang)
    return polish_http(cfg, text, style, lang)


def remote_label(cfg: dict) -> str:
    """Kort namn på tjänsten för statustexter i Inställningar och overlayn."""
    if cfg["polish_backend"] == "ollama":
        return "Ollama"
    if cfg["polish_backend"] == "codex":
        return "Codex"
    return "molntjänsten"


def remote_model(cfg: dict) -> str:
    if cfg["polish_backend"] == "ollama":
        return cfg["polish_ollama_model"]
    if cfg["polish_backend"] == "codex":
        return cfg.get("polish_codex_model", "")
    return cfg["polish_http_model"]


def polish_shares_gpu(cfg: dict) -> bool:
    """Delar poleringen samma lokala VRAM-budget som Whisper just nu?

    Bara den inbyggda motorn gör det säkert – den laddas i samma process
    på samma GPU (Qwen3-4B, ~2,4 GB). Fjärrbackendernas modeller kan vara
    hur stora som helst och köra på en annan maskin (eller i molnet), så de
    räknas inte in i Whispers kvantiseringsval."""
    return (
        cfg["polish_backend"] == "builtin"
        and model_installed(cfg)
        and runtime_installed()
    )


# -- Ollama-backend: återanvänd en körande Ollama och dess modeller ------------


def ollama_reachable(cfg: dict) -> bool:
    try:
        with urllib.request.urlopen(
            f"{cfg['polish_ollama_url']}/api/tags", timeout=2
        ):
            return True
    except Exception:
        return False


def polish_ollama(cfg: dict, text: str, style: str = "", lang: str = "sv") -> str:
    import json

    body = {
        "model": cfg["polish_ollama_model"],
        "messages": [
            {"role": "system", "content": _system_prompt(style, lang)},
            {"role": "user", "content": text},
        ],
        "stream": False,
        "options": {"temperature": 0},
        # Låt modellen bo kvar i VRAM mellan poleringar — annars
        # betalas inläsningen (~30-60 s för större modeller) varje gång.
        "keep_alive": "15m",
        # Resonerande modeller (qwen3 m.fl.) tänker annars dolt i
        # hundratals tokens — 16 s blir 3 s med tänket avstängt.
        "think": False,
    }

    def _call(payload: dict) -> dict:
        req = urllib.request.Request(
            f"{cfg['polish_ollama_url']}/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        # Generös tidsgräns: Ollama kan behöva läsa in modellen först.
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)

    try:
        out = _call(body)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if "think" not in detail.lower():
            raise
        body.pop("think")  # modellen saknar tänk-stöd: kör utan flaggan
        out = _call(body)
    result = _strip_thinking(out["message"]["content"]).strip()
    return result or text


def _strip_thinking(text: str) -> str:
    # Resonerande modeller (deepseek-r1 m.fl.) kan inleda med <think>-block.
    import re

    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)


# -- http-backend: valfri OpenAI-kompatibel endpoint ---------------------------
#
# För en färdig endpoint: en företagsgateway, en egen server, en tjänst med
# API-nyckel. Viska talar bara OpenAI-formatets /chat/completions och vet
# ingenting om vad som står bakom. Behöver du bara komma igång utan GPU är
# codex-backenden enklare — den kräver ingen adress alls.
#
# Ingen text lämnar datorn förrän den här backenden uttryckligen väljs.


def _http_origin(url: str) -> str:
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def http_reachable(cfg: dict) -> bool:
    """Svarar tjänsten? Kort tidsgräns: kollen görs bland annat när
    Inställningar öppnas och får aldrig frysa GUI:t."""
    try:
        req = urllib.request.Request(
            f"{_http_origin(cfg['polish_http_url'])}/health",
            headers=_http_headers(cfg),
        )
        with urllib.request.urlopen(req, timeout=2):
            return True
    except Exception:
        return False


def _http_headers(cfg: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    token = (cfg.get("polish_http_token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def polish_http(cfg: dict, text: str, style: str = "", lang: str = "sv") -> str:
    import json

    body = {
        "model": cfg["polish_http_model"],
        "messages": [
            {"role": "system", "content": _system_prompt(style, lang)},
            {"role": "user", "content": text},
        ],
        "temperature": 0,
        "stream": False,
    }
    req = urllib.request.Request(
        cfg["polish_http_url"],
        data=json.dumps(body).encode(),
        headers=_http_headers(cfg),
    )
    try:
        with urllib.request.urlopen(
            req, timeout=float(cfg["polish_http_timeout_s"])
        ) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(_http_error(e)) from e
    choice = (out.get("choices") or [{}])[0]
    result = _strip_thinking(choice.get("message", {}).get("content", "")).strip()
    return result or text


def _http_error(e: "urllib.error.HTTPError") -> str:
    """Serverns egen förklaring om den ger en – kvotstopp och nertid ska gå
    att läsa ur loggen utan att gissa."""
    detail = ""
    try:
        import json

        payload = json.loads(e.read().decode(errors="replace"))
        detail = str(payload.get("error", {}).get("message", "")).strip()
    except Exception:
        pass
    if e.code == 429:
        return f"poleringstjänstens kvot är slut: {detail or 'HTTP 429'}"
    return f"poleringstjänsten svarade HTTP {e.code}: {detail or 'inget svar'}"


def download_size_gb(cfg: dict) -> float:
    total = 0.0
    if not runtime_installed():
        total += RUNTIME_SIZE_GB
    if not model_installed(cfg):
        total += MODEL_SIZE_GB
    return round(total, 1) or MODEL_SIZE_GB


def download_all(cfg: dict, progress=None, cancelled=None) -> None:
    """Motor + modell, det som saknas. Förloppet viktas efter storlek."""
    need_runtime = not runtime_installed()
    need_model = not model_installed(cfg)
    total = (RUNTIME_SIZE_GB if need_runtime else 0) + (
        MODEL_SIZE_GB if need_model else 0
    )
    offset = 0.0

    def scaled(base: float, span: float):
        if progress is None:
            return None
        return lambda t, f: progress(t, base + f * span)

    if need_runtime:
        span = RUNTIME_SIZE_GB / total
        _download_runtime(scaled(0.0, span), cancelled)
        offset = span
    if need_model:
        download_model(cfg, scaled(offset, 1.0 - offset), cancelled)
    if progress:
        progress("Klart", 1.0)


def _download_runtime(progress=None, cancelled=None) -> None:
    LLAMA_LIB_DIR.mkdir(parents=True, exist_ok=True)
    tmp = LLM_DIR / "runtime.whl.part"
    try:
        with urllib.request.urlopen(RUNTIME_URL, timeout=60) as r, open(
            tmp, "wb"
        ) as f:
            header = r.headers.get("Content-Length")
            expected = int(header) if header else None
            done = 0
            while chunk := r.read(1 << 20):
                if cancelled and cancelled():
                    raise InterruptedError("Nedladdningen avbröts")
                f.write(chunk)
                done += len(chunk)
                if progress:
                    progress(
                        "Laddar ner poleringsmotorn…",
                        min(done / (expected or 1), 0.99),
                    )
        if expected is not None and done != expected:
            raise RuntimeError(
                f"Nedladdningen avbröts i förtid ({done} av {expected} byte)"
            )
        root = LLAMA_LIB_DIR.resolve()
        with zipfile.ZipFile(tmp) as z:
            for member in z.namelist():
                if member.startswith("llama_cpp/lib/") and member.endswith(".dll"):
                    dest = (root / Path(member).name).resolve()
                    if not dest.is_relative_to(root):
                        continue  # zip-slip-skydd
                    with z.open(member) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out)
        if not (LLAMA_LIB_DIR / "llama.dll").is_file():
            raise RuntimeError("Motorn saknade förväntade filer")
        log.info("Poleringsmotor installerad i %s", LLAMA_LIB_DIR)
    except BaseException:
        shutil.rmtree(LLAMA_LIB_DIR, ignore_errors=True)
        raise
    finally:
        tmp.unlink(missing_ok=True)


def download_model(cfg: dict, progress=None, cancelled=None) -> None:
    url = (
        f"https://huggingface.co/{cfg['polish_model_repo']}"
        f"/resolve/main/{cfg['polish_model_file']}"
    )
    LLM_DIR.mkdir(parents=True, exist_ok=True)
    _REMOVE_MARKER.unlink(missing_ok=True)
    dest = model_path(cfg)
    tmp = dest.with_suffix(".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
            header = r.headers.get("Content-Length")
            expected = int(header) if header else None
            total = expected or 1
            done = 0
            while chunk := r.read(1 << 20):
                if cancelled and cancelled():
                    raise InterruptedError("Nedladdningen avbröts")
                f.write(chunk)
                done += len(chunk)
                if progress:
                    progress("Laddar ner poleringsmodellen…", min(done / total, 0.99))
        # http.client sväljer avbrutna anslutningar (read() returnerar bara
        # b"") — utan längdkontrollen skulle en halv fil installeras som
        # giltig modell och krascha varje polering.
        if expected is not None and done != expected:
            raise RuntimeError(
                f"Nedladdningen avbröts i förtid ({done} av {expected} byte)"
            )
        tmp.replace(dest)
        log.info("Poleringsmodell installerad: %s", dest)
        if progress:
            progress("Klart", 1.0)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def remove_model(cfg: dict) -> bool:
    """True om filen försvann nu; False = låst (laddad) — tas bort vid nästa start."""
    try:
        shutil.rmtree(LLM_DIR)
        _REMOVE_MARKER.unlink(missing_ok=True)
        return True
    except FileNotFoundError:
        _REMOVE_MARKER.unlink(missing_ok=True)
        return True
    except OSError:
        _REMOVE_MARKER.touch()
        return False


def cleanup_pending_removal() -> None:
    if _REMOVE_MARKER.exists():
        shutil.rmtree(LLM_DIR, ignore_errors=True)
        _REMOVE_MARKER.unlink(missing_ok=True)


# Inbyggda reservtoner för tonvalsmenyn (F8-dubbeltryck): används BARA när
# mallbiblioteket (polish_templates) är tomt. Normalt visar menyn i stället
# "Appens standard" följt av användarens mallar. Uppgiften formuleras på
# aktivt språk så modellen bevarar det; etiketterna är alltid svenska.
_TONE_PRESETS = {
    "sv": [
        ("Neutral", "Skriv om texten till korrekt, naturlig text med samma innebörd och ton."),
        ("Mejl", "Skriv om texten till ett artigt och välformulerat mejl."),
        ("Commit-text", "Skriv om texten till en kortfattad commit-text i imperativ."),
        ("Kortfattat", "Skriv om texten så kort och koncist som möjligt utan att innebörden tappas."),
    ],
    "en": [
        ("Neutral", "Rewrite the text into correct, natural text with the same meaning and tone."),
        ("Mejl", "Rewrite the text into a polite, well-formed email."),
        ("Commit-text", "Rewrite the text into a concise git commit message in the imperative mood."),
        ("Kortfattat", "Rewrite the text to be as short and concise as possible without losing the meaning."),
    ],
}


def tone_presets(lang: str) -> list[tuple[str, str]]:
    """Inbyggda reservtoner (etikett, uppgift) på aktivt språk — fallback för
    tonvalsmenyn när mallbiblioteket är tomt."""
    return _TONE_PRESETS.get(lang, _TONE_PRESETS["sv"])


# -- Poleringsmallar: ett bibliotek som global standard och app-profiler pekar på


def polish_templates(cfg: dict) -> list[dict]:
    """Mallbiblioteket, rensat från trasiga poster (tål handredigerad config).
    Varje post: {"namn": str, "prompt": str}."""
    result = []
    for t in cfg.get("polish_templates") or []:
        if isinstance(t, dict) and str(t.get("namn", "")).strip():
            result.append(
                {"namn": str(t["namn"]).strip(), "prompt": str(t.get("prompt", ""))}
            )
    return result


def template_prompt(cfg: dict, name: str) -> str | None:
    """Poleringsuppgiften för mallen med angivet namn, eller None om den inte
    finns i biblioteket (t.ex. raderad)."""
    for t in polish_templates(cfg):
        if t["namn"] == name:
            return t["prompt"]
    return None


def resolve_polish_prompt(cfg: dict, profile: dict | None = None) -> str:
    """Gemensam upplösning av poleringsuppgiften för alla poleringsvägar
    (F8-enkeltryck, tonvalsmenyns "Appens standard" och flow-läget): app-profil
    → mall/fritext → global standard.

    En profil kan peka på en mall (polish_template), ha egen fritext
    (polish_prompt, dagens "Egen text") eller ingetdera — då ärvs den globala
    standarden. Den globala standarden pekar i sin tur på en mall eller på sin
    egen fritext. En pekare till en raderad mall faller tillbaka på global
    standard (och loggar en rad), så en polering aldrig blir tom av misstag."""
    profile = profile or {}
    tmpl = (profile.get("polish_template") or "").strip()
    if tmpl:
        prompt = template_prompt(cfg, tmpl)
        if prompt is not None:
            return prompt
        log.info(
            'App-profilens poleringsmall "%s" saknas – faller tillbaka på '
            "global standard",
            tmpl,
        )
    elif profile.get("polish_prompt"):
        return profile["polish_prompt"]  # Egen text (bakåtkompatibelt)
    return _resolve_global_polish(cfg)


def _resolve_global_polish(cfg: dict) -> str:
    name = (cfg.get("polish_template") or "").strip()
    if name:
        prompt = template_prompt(cfg, name)
        if prompt is not None:
            return prompt
        log.info(
            'Global poleringsmall "%s" saknas – faller tillbaka på fritexten',
            name,
        )
    return cfg.get("polish_prompt", "")


def _system_prompt(style: str, lang: str = "sv") -> str:
    if lang == "en":
        task = (
            style.strip()
            or "Rewrite the text into correct, natural text with the same meaning and tone."
        )
        return (
            "You are a text editor.\n"
            f"TASK: {task}\n"
            "Rules that always apply:\n"
            "- Remove all filler words (um, uh, like, you know, kind of).\n"
            "- Fix grammar and spelling. Keep the language of the text (English).\n"
            "- NEVER change dates, names, numbers or facts — "
            "'tomorrow' stays 'tomorrow'.\n"
            "- Do not invent new information and never use placeholders.\n"
            "- Reply with the result only, no explanation."
        )
    task = (
        style.strip()
        or "Skriv om texten till korrekt, naturlig text med samma innebörd och ton."
    )
    return (
        "Du är en textredigerare.\n"
        f"UPPGIFT: {task}\n"
        "Regler som alltid gäller:\n"
        "- Ta bort alla utfyllnadsord (eh, öh, alltså, liksom, typ, ju).\n"
        "- Rätta grammatik och stavning. Behåll textens språk.\n"
        "- Ändra ALDRIG tidsangivelser, namn, siffror eller fakta — "
        "'imorgon' förblir 'imorgon'.\n"
        "- Hitta inte på ny information och använd aldrig platshållare.\n"
        "- Svara enbart med resultatet, ingen förklaring."
    )


class Polisher:
    """Lat laddning: modellen tas in i VRAM först vid första poleringen
    (eller explicit warmup) och bor sedan kvar — omskrivningar därefter
    tar under en sekund."""

    def __init__(self, cfg: dict):
        self._cfg = cfg
        self._llm = None
        self._lock = threading.Lock()

    def ensure_loaded(self) -> None:
        with self._lock:
            if self._llm is not None:
                return
            # ctranslate2:s DLL-uppslag återanvänds — llama.cpp:s CUDA-bygge
            # behöver samma kataloger (cublas/cudart).
            from viska.transcribe import _add_nvidia_dll_dirs

            _add_nvidia_dll_dirs()
            # I exe:n är paketets egna DLL:er bortstädade (900 MB) — peka
            # ut den eftermonterade motorn INNAN importen laddar biblioteket.
            if _bundled_runtime_dir() is None:
                os.environ["LLAMA_CPP_LIB_PATH"] = str(LLAMA_LIB_DIR)
            from llama_cpp import Llama

            path = model_path(self._cfg)
            log.info("Laddar poleringsmodellen %s…", path.name)
            self._llm = Llama(
                model_path=str(path), n_gpu_layers=-1, n_ctx=4096, verbose=False
            )
            # Absorbera förstagångens kernel-JIT här i stället för vid
            # användarens första F8.
            self._llm.create_chat_completion(
                messages=[{"role": "user", "content": "ok"}], max_tokens=1
            )
            log.info("Poleringsmodellen redo")

    def polish(self, text: str, style: str = "", lang: str = "sv") -> str:
        self.ensure_loaded()
        with self._lock:
            out = self._llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": _system_prompt(style, lang)},
                    {"role": "user", "content": text},
                ],
                # Girig avkodning: mest texttrogna omskrivningen — 4B-modeller
                # börjar annars gärna "förbättra" fakta och tidsangivelser.
                temperature=0.0,
                # Teckenbaserat (split() räknar minifierad kod/URL:er som
                # ETT ord); llama.cpp klämmer tyst mot kontextfönstret,
                # därför avslöjas trunkering via finish_reason nedan.
                max_tokens=min(len(text) // 2 + 400, 3072),
            )
        choice = out["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError(
                "texten är för lång för modellens kontextfönster — "
                "polera en mindre markering"
            )
        result = choice["message"]["content"].strip()
        return result or text
