"""Konfiguration som läses från %APPDATA%\\viska\\config.json.

Filen skrivs alltid atomiskt (temp + os.replace): ett strömavbrott mitt i
skrivningen kan aldrig lämna en halv fil efter sig. Går den ändå inte att
läsa flyttas den till config.json.bak i stället för att tyst skrivas över —
en handredigerad config med ett kommatecken fel ska gå att rädda.

Nya nycklar behöver ingen migrering: de saknas i filen och tar sitt värde
från DEFAULTS. Migreringarna i migrate() är till för nycklar som BYTT
betydelse. Därför sammanfogas inte dict-värden med defaults heller — då
hade en borttagen rad i voice_commands återuppstått vid varje start.
"""

import json
import logging
import os
import tempfile
from collections.abc import Iterable
from pathlib import Path

log = logging.getLogger(__name__)

APP_NAME = "viska"
CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / APP_NAME
CONFIG_PATH = CONFIG_DIR / "config.json"
CONFIG_BACKUP_PATH = CONFIG_DIR / "config.json.bak"
LOG_PATH = CONFIG_DIR / "viska.log"
HISTORY_PATH = CONFIG_DIR / "history.json"

CONFIG_VERSION = 3

DEFAULTS = {
    # Configfilens format. Höjs bara när en nyckel byter betydelse och
    # måste migreras (se _migrate).
    "config_version": CONFIG_VERSION,
    # Tangent som styr dikteringen. Kort tryck = starta/stoppa,
    # håll inne = prata så länge tangenten hålls (walkie-talkie).
    # T.ex. "f9", "f8", "scroll lock", "ctrl+alt+d". Musknappar går också:
    # "mouse4"/"mouse5" (tumknapparna) och "mouse3" (hjulklick). Vänster och
    # höger musknapp går medvetet inte att välja — de behövs för att kunna
    # använda datorn.
    "hotkey": "f9",
    # Tryck kortare än så här räknas som "växla", längre som "håll".
    "hold_threshold_s": 0.35,
    # Whisper-modell för svenska. "auto" = KBLab/kb-whisper-large på GPU,
    # KBLab/kb-whisper-small på CPU. Kan även vara ett explicit namn som
    # "KBLab/kb-whisper-medium" eller ett vanligt som "large-v3".
    "model": "auto",
    # Separat modell för engelska (KB-Whisper är enbart svensktränad).
    # Laddas först när man växlar språk i traymenyn.
    "model_en": "large-v3-turbo",
    # Aktivt språk: "sv" eller "en". Kan växlas i traymenyn.
    "language": "sv",
    # Ordlista/kontext: namn och facktermer som modellen ska stava rätt
    # (Whispers initial_prompt). Ställs enklast in via Inställningar.
    "initial_prompt": "",
    # "auto" provar GPU först och faller tillbaka på CPU. Även "cuda"/"cpu".
    "device": "auto",
    # null = float16 på GPU, int8 på CPU. "int8_float16" halverar VRAM på
    # GPU (~2 GB för large i stället för ~4 GB) med minimal kvalitetsförlust.
    "compute_type": None,
    # null = 5 på GPU, 2 på CPU (lägre = snabbare, marginellt sämre).
    "beam_size": None,
    # "paste" klistrar in via klippbordet (snabbast, säkrast för åäö).
    # "type" simulerar Unicode-tangenttryck tecken för tecken.
    "inject_mode": "paste",
    "restore_clipboard": True,
    "append_space": True,
    "max_recording_s": 300,
    # Liveläge: färdiga fraser skrivs in medan du fortfarande pratar; den
    # pågående frasen förhandsvisas i overlayn. "auto" = på när GPU
    # används (CPU hinner inte transkribera om i realtid). Även true/false.
    "live": "auto",
    # Profiler per app: nyckel = processnamn (gemener, t.ex. "code.exe").
    # Värden: initial_prompt (ordlista utöver den globala), inject_mode
    # ("paste"/"type"), language ("sv"/"en"; utelämnad = aktivt språk —
    # språk byts ALDRIG automatiskt utan bara via uttrycklig profil) och
    # flow (true = polera dikteringen automatiskt; utelämnad = ärver den
    # globala "flow" nedan). Poleringsuppgift: antingen polish_template
    # (namn på en mall i polish_templates) ELLER polish_prompt (egen
    # fritext, "Egen text"). Saknas båda ärver profilen den globala
    # standarden.
    "app_profiles": {},
    # Röstkommandon: talade fraser som blir formatering i stället för
    # text. Lägg till egna eller ta bort rader för att stänga av.
    "voice_commands": {
        "ny rad": "\n",
        "nytt stycke": "\n\n",
        "new line": "\n",
        "new paragraph": "\n\n",
    },
    # Ersättningsregler: hörd fras -> text som skrivs in i stället. Körs
    # efter transkriberingen och är därför deterministiska, till skillnad
    # från ordlistan (initial_prompt) som bara är ett tips till Whisper.
    # Fylls enklast på via "Rätta senaste dikteringen…" i traymenyn.
    # Nyckeln matchas som hela ord, skiftlägesokänsligt; är den hörda frasen
    # versaliserad i texten versaliseras ersättningen på samma sätt.
    "replacements": {},
    # Polering: markera text var som helst, tryck tangenten, få den
    # omskriven av en lokal LLM. Modellen laddas ner via Inställningar.
    "polish_hotkey": "f8",
    # Tonvalsmenyn har en EGEN tangent i stället för dubbeltryck. Skälet är
    # latens: ett dubbeltrycksfönster måste fördröja varje enkeltryck lika
    # länge för att kunna skilja dem åt, så poleringen började alltid 0,4 s
    # för sent. Tom sträng = ingen menytangent.
    "polish_menu_hotkey": "shift+f8",
    # Vill man ändå ha det gamla dubbeltrycket på poleringstangenten: sätt
    # true. Då återkommer fördröjningen på varje enkeltryck.
    "polish_double_tap": False,
    # Global uppgiftsbeskrivning som "Egen text" (tom = "skriv om till
    # korrekt text"). Används när polish_template nedan är tom. Behålls som
    # bakåtkompatibelt förval: äldre config-filer med fritext här fortsätter
    # gälla oförändrat.
    "polish_prompt": "",
    # Mallbibliotek för polering: en lista av {namn, prompt}. Den globala
    # standarden (polish_template nedan) och varje app-profil PEKAR på en
    # mall via namn — ändras en mall slår det igenom överallt där den
    # används. Standardmallarna är redigerbara och raderbara, och nya kan
    # läggas till i Inställningar → Polering. Tömmer man listan finns inga
    # mallar kvar och allt faller tillbaka på "Egen text".
    "polish_templates": [
        {
            "namn": "Mejl",
            "prompt": (
                "Skriv om texten till ett artigt och välformulerat mejl med "
                "naturligt flyt. Behåll alla sakuppgifter och lägg inte till "
                "hälsnings- eller avslutningsfras som inte redan finns."
            ),
        },
        {
            "namn": "Commit-text",
            "prompt": (
                "Skriv om texten till en kortfattad commit-text i imperativ "
                '(t.ex. "Lägg till", "Rätta"). Beskriv vad ändringen gör, '
                "inte hur den formulerades."
            ),
        },
        {
            "namn": "Chattsvar",
            "prompt": (
                "Skriv om texten till ett kort och ledigt chattsvar i "
                "vardaglig ton. Behåll innebörden och var tydlig och vänlig "
                "utan att bli formell."
            ),
        },
        {
            "namn": "Formell text",
            "prompt": (
                "Skriv om texten till vårdat, formellt skriftspråk. Undvik "
                "talspråk och slarviga förkortningar men behåll innebörden "
                "och alla sakuppgifter."
            ),
        },
        {
            "namn": "Kortfattat",
            "prompt": (
                "Skriv om texten så kort och koncist som möjligt utan att "
                "innebörden tappas. Ta bort upprepningar och överflödiga ord."
            ),
        },
    ],
    # Vilken mall den globala standardpoleringen pekar på. Tom = "Egen text"
    # (fritexten i polish_prompt ovan; bakåtkompatibelt förval). Ett namn som
    # inte längre finns i biblioteket faller tillbaka på fritexten.
    "polish_template": "",
    # "builtin" = inbyggd motor (llama.cpp, laddas ner via Inställningar).
    # "ollama" = återanvänd en körande Ollama och dess modeller — inget
    # extra laddas ner.
    # "codex" = använd Codex som redan är installerad och inloggad på datorn.
    # Viska startar och sköter processen själv; inget behöver kopplas ihop.
    # "http" = valfri OpenAI-kompatibel endpoint, för egna tjänster.
    # OBS: både "codex" och "http" skickar den polerade texten från datorn.
    "polish_backend": "builtin",
    "polish_ollama_model": "qwen3.5:9b",
    "polish_ollama_url": "http://localhost:11434",
    # Codex-backenden. Modellen måste finnas i din Codex-katalog.
    "polish_codex_model": "gpt-5.6-luna",
    # low är lägsta nivån modellerna stöder; none och minimal avvisas.
    "polish_codex_effort": "low",
    # http-backenden. Adressen är hela chat/completions-vägen; /health på
    # samma värd används för nåbarhetskollen.
    "polish_http_url": "http://127.0.0.1:8756/v1/chat/completions",
    "polish_http_model": "gpt-5.6-luna",
    # Skickas som "Authorization: Bearer …" när den är ifylld.
    "polish_http_token": "",
    "polish_http_timeout_s": 60,
    # Meningen som "Testa polering" skickar. Redigerbar i Inställningar så att
    # man kan prova sin egen typiska diktering.
    "polish_test_text": (
        "hej ehm jag ville bara höra om vi kan flytta mötet på torsdag till "
        "fredag i stället för jag har en grej som krockar"
    ),
    "polish_model_repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
    # Filnamn i %APPDATA%\viska\llm — eller en absolut sökväg till en egen
    # GGUF (t.ex. en Ollama-blob).
    "polish_model_file": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    # Flow-läge (Wispr Flow-stil): polera hela dikteringen automatiskt
    # innan den skrivs in, i stället för att skriva in råtexten. Global
    # standard som profiler ärver; slås på per app via "flow" i
    # app_profiles. Är poleringen otillgänglig, kastar fel eller tar för
    # lång tid skrivs råtexten in precis som vanlig diktering.
    "flow": False,
    # En knapp som avgör om flow gäller för just den här dikteringen: ""
    # (ingen, "flow" avgör ensam), "ctrl" eller "shift". Den läses när
    # dikteringen startar. Med flow_key_means "polish" poleras dikteringen
    # bara när knappen hålls; med "raw" poleras den utom när knappen hålls.
    # Gäller bara när "flow" är på.
    "flow_key": "",
    "flow_key_means": "polish",
    # Dikteringsknappens beteende: "auto" (kort tryck växlar, håll inne
    # spelar in tills knappen släpps), "hold" (spelar alltid in bara så
    # länge knappen hålls) eller "toggle" (ett tryck startar, nästa stoppar).
    "hotkey_mode": "auto",
    # Dikteringshistorik i traymenyn. Hålls enbart i RAM som standard —
    # "history_persist" (kryssruta i Inställningar → Avancerat) sparar den
    # i stället till history.json vid varje ändring och läser in den igen
    # vid start.
    "history_size": 20,
    "history_persist": False,
    # Satt när Viska en gång har berättat att dikteringen nu finns i Referat.
    "referat_notice_shown": False,
    # Kolla efter ny version mot GitHub releases vid start (endast en
    # versionssiffra hämtas; ingen data skickas).
    "check_updates": True,
    # Personlig GitHub-token (PAT) för den inbyggda uppdateraren när repot är
    # privat: skickas som Authorization-header vid versionskoll och asset-
    # nedladdning. Tom = anonymt (fungerar för publika repon). Sätts i
    # Inställningar → Avancerat (lösenordsmaskerat fält).
    "github_token": "",
    # Hur ofta ljudet omtranskriberas, och hur lång paus som gör en fras
    # färdig (färdig text skrivs in och kan inte ändras i efterhand).
    # Lägre = snabbare inskrivning men committar hellre vid korta pauser.
    "live_interval_s": 0.4,
    "live_commit_silence_s": 0.45,
    # null = systemets standardmikrofon. Annars namn eller index från
    # `viska --list-devices`.
    "input_device": None,
    # Med input_device = null: är Windows standardmikrofon ett Bluetooth-
    # headset används datorns egen mikrofon i stället. Headsetet byter annars
    # till samtalsläge (mono, sämre ljud) så länge dess mikrofon är öppen.
    "mic_avoid_bluetooth": True,
    # När mikrofonströmmen är öppen. Windows visar mikrofonikonen i
    # aktivitetsfältet så länge den är det.
    #   "on_demand" – öppnas vid dikteringen och stängs mic_idle_close_s
    #                 sekunder efter den sista. Ikonen syns bara när Viska
    #                 faktiskt lyssnar, och diktering på diktering är ändå
    #                 igång direkt (strömmen hinner inte stängas).
    #   "always"    – alltid öppen mot en liten RAM-ringbuffert. Ger
    #                 förstarten som skyddar första stavelsen, till priset
    #                 av en mikrofonikon som alltid lyser.
    #   "closed"    – stängs direkt efter varje diktering.
    "mic_mode": "on_demand",
    # Hur länge strömmen får stå öppen efter en diktering i on_demand-läget.
    # Kort, så att mikrofonikonen släcks strax efter dikteringen; diktering
    # direkt efter diktering slipper ändå öppningskostnaden. Ett Bluetooth-
    # headset stängs alltid direkt (det står annars kvar i samtalsläge).
    "mic_idle_close_s": 2,
    # Ljud som tas med från FÖRE tangenttrycket (kräver en redan öppen ström:
    # gäller "always", och "on_demand" när strömmen fortfarande är varm).
    "preroll_s": 0.25,
    "sounds": True,
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    stored = read_stored(CONFIG_PATH)
    if stored is None:
        save(cfg)  # saknas eller trasig (då redan säkerhetskopierad)
        return cfg
    # Versionen läses ur den SPARADE filen, inte ur den sammanslagna dicten:
    # den senare har alltid dagens config_version från DEFAULTS och hade fått
    # varje migrering att se ut som redan gjord.
    stored_version = stored.get("config_version", 1)
    cfg.update(stored)
    if migrate(cfg, stored_version):
        save(cfg)
    return cfg


def read_stored(path: Path) -> dict | None:
    """Configfilen som dict, eller None om den saknas eller inte går att
    läsa. En trasig fil flyttas till config.json.bak först: den ska varken
    tolkas eller tyst skrivas över av nästa Spara."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        backup = path.with_name(path.name + ".bak")
        try:
            os.replace(path, backup)
            log.warning("Configfilen gick inte att läsa (%s) – sparad som %s", e, backup)
        except OSError:
            log.exception("Configfilen gick inte att läsa och inte heller flyttas")
        return None
    if not isinstance(data, dict):
        return None
    return data


def migrate(cfg: dict, from_version: int | None = None) -> bool:
    """Uppdaterar cfg på plats till CONFIG_VERSION. Returnerar True om något
    ändrades (då ska filen skrivas om). from_version är versionen som stod i
    filen; utelämnad läses den ur cfg."""
    version = cfg.get("config_version", 1) if from_version is None else from_version
    if not isinstance(version, int):
        version = 1
    changed = False
    if version < 2:
        # keep_mic_open (bool) -> mic_mode (tre lägen). True var det gamla
        # förvalet som ingen aktivt valde, så det blir det nya förvalet
        # on_demand; ett uttryckligt False betydde "stäng direkt".
        keep_open = cfg.pop("keep_mic_open", None)
        if keep_open is False:
            cfg["mic_mode"] = "closed"
        changed = True
    if version < 3:
        # Förvalet för stängning sänktes från 20 till 2 s. Ett sparat 20 är
        # det gamla förvalet, inte ett val, så det följer med; andra värden
        # har användaren satt själv.
        if cfg.get("mic_idle_close_s") == 20:
            cfg["mic_idle_close_s"] = 2
        changed = True
    if changed or cfg.get("config_version") != CONFIG_VERSION:
        cfg["config_version"] = CONFIG_VERSION
        changed = True
    return changed


def save(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(CONFIG_PATH, cfg)


def _write_json(path: Path, data) -> None:
    """Skriver atomiskt: hela filen hamnar i en temp-fil i samma katalog och
    byter sedan namn med os.replace (atomärt på NTFS). Ett avbrott mitt i
    skrivningen kan aldrig lämna en trunkerad config eller historik."""
    text = json.dumps(data, indent=2, ensure_ascii=False)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_history() -> list[str]:
    """Sparad historik (nyast först), eller tom lista om opt-in-läget är
    avstängt, filen saknas, eller är trasig."""
    if not HISTORY_PATH.exists():
        return []
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        return [str(x) for x in data] if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []  # trasig fil: kör vidare utan historik, skriv inte över


def save_history(items: Iterable[str]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(HISTORY_PATH, list(items))


def delete_history() -> None:
    """Körs när opt-in-läget stängs av — filen ska inte bli kvar på disk."""
    HISTORY_PATH.unlink(missing_ok=True)
