"""Configfilen: migrering, trasiga filer och atomisk skrivning."""

import json

import pytest

from viska import config


@pytest.fixture
def appdata(tmp_path, monkeypatch):
    """Låt config-modulen jobba mot en tom katalog i stället för %APPDATA%."""
    monkeypatch.setattr(config, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "HISTORY_PATH", tmp_path / "history.json")
    return tmp_path


def test_forsta_starten_skriver_defaults(appdata):
    cfg = config.load()
    assert cfg["mic_mode"] == "on_demand"
    assert cfg["config_version"] == config.CONFIG_VERSION
    on_disk = json.loads((appdata / "config.json").read_text(encoding="utf-8"))
    assert on_disk["hotkey"] == "f9"


def test_nya_nycklar_far_defaultvarde_utan_migrering(appdata):
    (appdata / "config.json").write_text(
        json.dumps({"config_version": config.CONFIG_VERSION, "hotkey": "f10"}),
        encoding="utf-8",
    )
    cfg = config.load()
    assert cfg["hotkey"] == "f10"  # användarens val rörs inte
    assert cfg["replacements"] == {}  # ny nyckel tar sitt default


def test_borttagen_rad_i_voice_commands_aterupstar_inte(appdata):
    """Defaults sammanfogas inte in i dict-värden: tar man bort ett
    röstkommando ska det vara borta, inte komma tillbaka vid nästa start."""
    (appdata / "config.json").write_text(
        json.dumps(
            {"config_version": config.CONFIG_VERSION, "voice_commands": {"ny rad": "\n"}}
        ),
        encoding="utf-8",
    )
    cfg = config.load()
    assert cfg["voice_commands"] == {"ny rad": "\n"}


def test_migrering_keep_mic_open_true_blir_on_demand(appdata):
    (appdata / "config.json").write_text(
        json.dumps({"keep_mic_open": True, "hotkey": "f9"}), encoding="utf-8"
    )
    cfg = config.load()
    assert cfg["mic_mode"] == "on_demand"
    assert "keep_mic_open" not in cfg
    assert cfg["config_version"] == config.CONFIG_VERSION
    # Migreringen ska ha skrivits till disk, inte bara till minnet.
    on_disk = json.loads((appdata / "config.json").read_text(encoding="utf-8"))
    assert on_disk["mic_mode"] == "on_demand"


def test_migrering_keep_mic_open_false_blir_closed(appdata):
    (appdata / "config.json").write_text(
        json.dumps({"keep_mic_open": False}), encoding="utf-8"
    )
    assert config.load()["mic_mode"] == "closed"


def test_migrering_kors_bara_en_gang(appdata):
    cfg = {"config_version": config.CONFIG_VERSION, "mic_mode": "always"}
    assert config.migrate(cfg) is False
    assert cfg["mic_mode"] == "always"


def test_trasig_config_sakerhetskopieras_och_skrivs_inte_over(appdata):
    (appdata / "config.json").write_text("{ trasig json", encoding="utf-8")
    cfg = config.load()
    assert cfg["hotkey"] == "f9"  # defaults
    assert (appdata / "config.json.bak").read_text(encoding="utf-8") == "{ trasig json"


def test_skrivning_ar_atomisk(appdata, monkeypatch):
    config.save(dict(config.DEFAULTS))
    original = (appdata / "config.json").read_text(encoding="utf-8")

    def explodera(*_a, **_kw):
        raise OSError("disken full")

    monkeypatch.setattr(config.os, "replace", explodera)
    with pytest.raises(OSError):
        config.save({"hotkey": "f4"})
    # Den gamla filen är orörd och inga temp-filer ligger kvar.
    assert (appdata / "config.json").read_text(encoding="utf-8") == original
    assert not list(appdata.glob("*.tmp"))


def test_historik_sparas_och_lases(appdata):
    config.save_history(["senaste", "äldre"])
    assert config.load_history() == ["senaste", "äldre"]
    config.delete_history()
    assert config.load_history() == []


def test_gamla_forvalet_for_mikrofonstangning_foljer_med():
    cfg = {"config_version": 2, "mic_idle_close_s": 20}
    assert config.migrate(cfg)
    assert cfg["mic_idle_close_s"] == 2


def test_eget_varde_for_mikrofonstangning_behalls():
    cfg = {"config_version": 2, "mic_idle_close_s": 8}
    config.migrate(cfg)
    assert cfg["mic_idle_close_s"] == 8
