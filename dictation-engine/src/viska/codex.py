"""Polering via Codex — utan att något behöver kopplas ihop för hand.

Har du Codex installerat och inloggat räcker det att välja "Codex" som
poleringsmotor. Viska startar en egen Codex-process i bakgrunden, håller den
varm och kör varje omskrivning i den. Ingen adress, ingen server att dra
igång, ingen nyckel.

Fyra saker gör att det fungerar utan konfiguration:

- BINÄREN SOM REDAN FINNS. SDK:n vill helst använda en 354 MB stor
  medföljande kopia av Codex. Den bundlas inte — vi pekar i stället på den
  Codex du redan har installerad, via PATH eller standardplatsen.

- EGET CODEX_HOME. Plugins, MCP-servrar, skills och AGENTS.md läses per tråd
  ur användarens CODEX_HOME. På en vanlig kodningsuppsättning blev en
  dikterad mening 20 653 input-tokens; med ett tomt hem 11 559, och
  rundturen gick från 5,2 till 3,5 sekunder. Hemmet ligger i
  %APPDATA%\\viska\\codex-home och innehåller bara vår config och en kopia
  av inloggningen.

- EN NY TRÅD PER OMSKRIVNING. Processen är dyr att starta men billig att ha
  igång; en tråd är tvärtom. Två dikteringar har inget med varandra att göra,
  så var och en får en egen efemär tråd i stället för att släpa med sig alla
  tidigare som kontext.

- INGA VERKTYG. Sandlådan är read-only och godkännanden nekas. Uppgiften är
  text in, text ut.

Texten skickas till OpenAI via din Codex-inloggning. Det är hela poängen med
motorn, men det är också det enda i Viska som lämnar datorn — därför är den
aldrig vald som standard.
"""

import logging
import os
import shutil
import threading
from pathlib import Path

from viska.config import CONFIG_DIR

log = logging.getLogger(__name__)

# Vårt egna, tomma hem. Bara config.toml och en kopia av auth.json.
CODEX_HOME = CONFIG_DIR / "codex-home"

# Verifierad mot `codex app-server --strict-config` på 0.146/0.147: okända
# nycklar avvisas, och web_search vill ha ett av disabled/cached/indexed/live.
# [features] är fri form — ett namn som byter sig i en ny version gör
# poleringen långsammare, aldrig trasig.
ISOLATED_CONFIG = """# Skapad av Viska. Redigera inte för hand.
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"

[features]
multi_agent = false
shell_tool = false
unified_exec = false
"""

INSTRUCTIONS = (
    "You are a text rewriting engine embedded in a dictation tool. "
    "You receive a system message describing the rewriting task and a user "
    "message containing dictated text. Apply the task and reply with the "
    "rewritten text only: no explanation, no preamble, no quotes around it, "
    "no tool use, no questions. Never invent facts, and never change dates, "
    "names or numbers."
)

# Standardplatser att leta på när codex inte ligger på PATH (tjänster och
# autostartade processer ärver inte alltid användarens PATH).
_KNOWN_PATHS = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe",
    Path(os.environ.get("PROGRAMFILES", "")) / "OpenAI" / "Codex" / "bin" / "codex.exe",
)


def binary() -> Path | None:
    """Codex som användaren redan har installerad, eller None."""
    found = shutil.which("codex")
    if found:
        return Path(found)
    for candidate in _KNOWN_PATHS:
        if candidate.parts and candidate.is_file():
            return candidate
    return None


def user_home() -> Path:
    """Användarens riktiga CODEX_HOME — det är där inloggningen bor."""
    return Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))


def auth_file() -> Path:
    return user_home() / "auth.json"


def status() -> tuple[bool, str]:
    """(klar att använda, förklaring i klartext för Inställningar)."""
    if binary() is None:
        return False, (
            "Codex hittades inte på datorn. Installera Codex, så dyker den "
            "upp här."
        )
    if not auth_file().exists():
        return False, "Codex är installerad men inte inloggad. Kör `codex login`."
    return True, f"Klar – använder din Codex-inloggning ({binary()})"


def ready() -> bool:
    return status()[0]


def provision_home() -> None:
    """Gör vårt hem redo: vår config och en färsk kopia av inloggningen.

    auth.json kopieras i stället för att delas — Codex skriver om filen när
    token förnyas, och en delad fil kan skrivas sönder av två processer.
    Kopian tas om vid varje start, så en förnyad inloggning följer med."""
    CODEX_HOME.mkdir(parents=True, exist_ok=True)
    (CODEX_HOME / "config.toml").write_text(ISOLATED_CONFIG, encoding="utf-8")
    source = auth_file()
    if not source.exists():
        raise RuntimeError("Codex är inte inloggad – kör `codex login`")
    shutil.copy2(source, CODEX_HOME / "auth.json")


class CodexPolisher:
    """Håller Codex-processen varm mellan poleringar.

    Trådsäker: bara en polering åt gången i Viska, men statuskoller och
    avslut kan komma från andra trådar."""

    def __init__(self, cfg: dict):
        self._cfg = cfg
        self._codex = None
        self._lock = threading.Lock()

    @property
    def model(self) -> str:
        return self._cfg.get("polish_codex_model") or "gpt-5.6-luna"

    @property
    def effort(self) -> str:
        # low är lägsta nivån modellerna faktiskt stöder; none och minimal
        # finns i protokollet men avvisas av backenden.
        return self._cfg.get("polish_codex_effort") or "low"

    def _client(self):
        from openai_codex import Codex, CodexConfig

        with self._lock:
            if self._codex is None:
                codex_bin = binary()
                if codex_bin is None:
                    raise RuntimeError(
                        "Codex hittades inte – installera Codex och försök igen"
                    )
                provision_home()
                log.info("Startar Codex för polering…")
                self._codex = Codex(
                    CodexConfig(
                        # Utan explicit sökväg letar SDK:n efter en medföljande
                        # 354 MB-binär som vi medvetet inte bundlar.
                        codex_bin=str(codex_bin),
                        env={**os.environ, "CODEX_HOME": str(CODEX_HOME)},
                        cwd=str(CODEX_HOME),
                    )
                )
            return self._codex

    def ensure_loaded(self) -> None:
        """Startar processen i förväg (flow-lägets förvärmning)."""
        self._client()

    def polish(
        self,
        text: str,
        style: str = "",
        lang: str = "sv",
        model: str | None = None,
        effort: str | None = None,
    ) -> str:
        """model/effort går att skicka med så att Inställningarnas testknapp
        kan prova ett osparat val utan att starta en andra Codex-process."""
        from openai_codex import ApprovalMode, Sandbox

        codex = self._client()
        thread = codex.thread_start(
            model=model or self.model,
            sandbox=Sandbox.read_only,
            approval_mode=ApprovalMode.deny_all,
            base_instructions=INSTRUCTIONS,
            developer_instructions=style or "Skriv om texten till korrekt text.",
            ephemeral=True,
        )
        result = thread.run(text, effort=effort or self.effort)
        status_name = turn_status(result)
        if status_name != "completed":
            raise RuntimeError(
                f"Codex avslutade turen som {status_name}: "
                f"{getattr(result, 'error', '') or 'ingen förklaring'}"
            )
        answer = (getattr(result, "final_response", "") or "").strip()
        if not answer:
            raise RuntimeError("Codex svarade utan text")
        usage = getattr(getattr(result, "usage", None), "last", None)
        if usage is not None:
            # Input-tokens avslöjar om något stort smugit sig in i prompten
            # igen (plugins, skills, MCP-servrar).
            log.info(
                "Codex: %s tokens in, %s ut",
                getattr(usage, "input_tokens", "?"),
                getattr(usage, "output_tokens", "?"),
            )
        return answer

    def close(self) -> None:
        with self._lock:
            codex, self._codex = self._codex, None
        if codex is not None:
            try:
                codex.close()
            except Exception:
                log.exception("Kunde inte stänga Codex")


def turn_status(result) -> str:
    """Turens status som ren sträng.

    SDK:n returnerar en enum (TurnStatus.completed), inte "completed" — en rak
    strängjämförelse gör att varje LYCKAD tur ser ut som ett fel. Det var
    precis den buggen som slängde första skarpa svaret.
    """
    status = getattr(result, "status", None)
    return str(getattr(status, "value", status) or "completed")


def friendly_error(exc: Exception) -> str:
    """Kvotstopp ska synas som kvotstopp i loggen, inte som ett okänt fel."""
    message = str(exc) or exc.__class__.__name__
    lowered = message.lower()
    if "usage limit" in lowered or "quota" in lowered or "rate limit" in lowered:
        return f"Codex-kvoten är slut: {message}"
    return message
