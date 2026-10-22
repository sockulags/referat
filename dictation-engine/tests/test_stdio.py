"""Motorläget (`viska --engine`): JSON-kommandon in, JSON-händelser ut.

De flesta testerna matar kommandon direkt till EngineHost. Det sista
startar motorn som en egen process, så som Referat gör, och kontrollerar att
stdout bara innehåller protokollrader.
"""

import io
import json
import subprocess
import sys

import pytest

from viska import mics, stdio


class Collect:
    def __init__(self):
        self.events = []

    def send(self, event, **data):
        self.events.append({"event": event, **data})

    def last(self):
        return self.events[-1]


class FakeKey:
    def __init__(self, hotkey, *args):
        self.hotkey = hotkey
        self.args = args
        self.stopped = False

    def force_stop(self):
        return False

    def stop(self):
        self.stopped = True


@pytest.fixture
def host(monkeypatch):
    keys = []

    def fake_key(hotkey, *args):
        keys.append(FakeKey(hotkey, *args))
        return keys[-1]

    monkeypatch.setattr(stdio, "create_push_to_talk", fake_key)
    out = Collect()
    h = stdio.EngineHost(out)
    loads = []
    monkeypatch.setattr(
        h.engine, "load_model_async",
        lambda lang, force=False, quiet=False: loads.append((lang, force)),
    )
    h.keys = keys
    h.loads = loads
    yield h
    h.close()


def test_okant_kommando_ger_fel(host):
    host.handle({"cmd": "dansa", "id": 7})
    assert host.out.last() == {
        "event": "error", "cmd": "dansa", "id": 7, "message": "Okänt kommando",
    }


def test_trasig_rad_ger_fel_och_motorn_lever_vidare(host):
    host.handle_line("{inte json")
    assert host.out.last()["event"] == "error"
    host.handle_line('{"cmd": "history", "id": 1}')
    assert host.out.last() == {
        "event": "ok", "cmd": "history", "id": 1, "items": [], "last": "",
    }


def test_inget_laddas_och_ingen_tangent_tas_fore_configure(host):
    assert host.keys == []
    assert host.loads == []


def test_configure_tar_tangenten_och_laddar_modellen(host):
    host.handle({"cmd": "configure", "id": 1, "config": {"hotkey": "f10", "okänd": 1}})
    assert host.out.last() == {
        "event": "ok", "cmd": "configure", "id": 1, "ignored": ["okänd"],
    }
    assert [k.hotkey for k in host.keys] == ["f10"]
    assert host.loads == [("sv", False)]


def test_tangenten_binds_bara_om_nar_den_andras(host):
    host.handle({"cmd": "configure", "config": {"hotkey": "f10"}})
    host.handle({"cmd": "configure", "config": {"sounds": False}})
    assert len(host.keys) == 1
    host.handle({"cmd": "configure", "config": {"hotkey": "f11"}})
    assert [k.hotkey for k in host.keys] == ["f10", "f11"]
    assert host.keys[0].stopped


def test_lage_och_omskrivningsknapp_foljer_med_tangenten(host):
    host.handle({"cmd": "configure", "config": {"hotkey": "mouse5"}})
    assert host.keys[-1].args[-2:] == ("auto", "")
    host.handle(
        {"cmd": "configure", "config": {"hotkey_mode": "toggle", "flow_key": "ctrl"}}
    )
    assert len(host.keys) == 2  # bunden om
    assert host.keys[-1].args[-2:] == ("toggle", "ctrl")


def test_upptagen_tangent_rapporteras_men_motorn_startar(host, monkeypatch):
    def taken(*_args):
        raise stdio.HotkeyError("F9 används redan av ett annat program")

    monkeypatch.setattr(stdio, "create_push_to_talk", taken)
    host.handle({"cmd": "configure", "config": {}})
    assert host.out.events[-2]["event"] == "hotkey_failed"
    assert host.out.last()["event"] == "ok"


def test_sprak_maste_vara_kant(host):
    host.handle({"cmd": "set_language", "language": "fi"})
    assert host.out.last()["event"] == "error"
    host.handle({"cmd": "set_language", "language": "en"})
    assert host.out.last()["event"] == "ok"
    assert host.engine.language == "en"


def test_avbryt_utan_inspelning(host):
    host.handle({"cmd": "cancel"})
    assert host.out.last()["cancelled"] is False
    host.handle({"cmd": "insert_raw"})
    assert host.out.last()["inserted"] is False


def test_polering_kan_hoppas_over_fran_varden(host):
    picked = []
    host.feedback.polishing(lambda: picked.append("raw"), lambda: picked.append("x"))
    host.handle({"cmd": "insert_raw"})
    assert picked == ["raw"]
    assert host.out.last()["inserted"] is True


def test_mikrofonbyte_blir_en_handelse():
    out = Collect()
    feedback = stdio.JsonFeedback(out, lambda: None)
    choice = mics.Choice(3, "Mikrofonmatris (Realtek)", False, avoided="Jabra 85")
    feedback.mic_changed(choice)
    event = out.last()
    assert event["event"] == "mic"
    assert event["avoided"] == "Jabra 85"
    assert "samtalsläge" in event["description"]


def test_json_rader_far_inte_blandas():
    buffer = io.StringIO()
    out = stdio.JsonOut(buffer)
    out.send("partial", text="hej – åäö")
    assert json.loads(buffer.getvalue()) == {"event": "partial", "text": "hej – åäö"}


def test_motorn_som_egen_process():
    proc = subprocess.run(
        [sys.executable, "-m", "viska", "--engine"],
        input=b'{"cmd": "history", "id": 1}\n{"cmd": "quit", "id": 2}\n',
        capture_output=True,
        timeout=60,
    )
    lines = [json.loads(line) for line in proc.stdout.decode("utf-8").splitlines()]
    assert [e["event"] for e in lines] == ["hello", "ok", "ok", "bye"]
    assert lines[0]["protocol"] == stdio.PROTOCOL
    assert lines[1]["cmd"] == "history"
    assert proc.returncode == 0


def test_historiken_talar_om_programmet():
    out = Collect()

    class Engine:
        last_text = "Vi ses på torsdag."
        last_app = "Microsoft Outlook"

    stdio.JsonFeedback(out, lambda: Engine()).history_changed()
    assert out.last() == {
        "event": "history", "last": "Vi ses på torsdag.", "app": "Microsoft Outlook",
    }


# -- Polering hos värden ---------------------------------------------------------


def _request(out, timeout=2.0):
    import time as _time

    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        for event in out.events:
            if event["event"] == "polish_request":
                return event
        _time.sleep(0.01)
    raise AssertionError("ingen polish_request skickades")


def test_varden_polerar_och_motorn_far_svaret(host):
    import threading

    from viska.engine import InsertionGuard

    result = {}

    def flow():
        result["value"] = host.engine._polish_for_flow(
            "hej anna vi ses", "Skriv som mejl", "sv", InsertionGuard()
        )

    worker = threading.Thread(target=flow)
    worker.start()
    request = _request(host.out)
    assert request["text"] == "hej anna vi ses"
    assert request["style"] == "Skriv som mejl"
    # Värden får motorns tidsgräns, så att den inte ger upp först.
    assert request["timeout_s"] == pytest.approx(10.6)
    host.handle({"cmd": "polished", "request": request["request"], "text": "Hej Anna, vi ses."})
    worker.join(5)
    assert result["value"] == ("Hej Anna, vi ses.", "polerad")


def test_misslyckad_polering_ger_ratext(host):
    import threading

    from viska.engine import InsertionGuard

    result = {}
    worker = threading.Thread(
        target=lambda: result.update(
            value=host.engine._polish_for_flow("hej", "", "sv", InsertionGuard())
        )
    )
    worker.start()
    request = _request(host.out)
    host.handle({"cmd": "polish_failed", "request": request["request"], "message": "nere"})
    worker.join(5)
    assert result["value"] == (None, "fel")


def test_sent_svar_kastas():
    out = Collect()
    polishing = stdio.HostPolishing(out, timeout=lambda _text: 0.1, margin_s=0)
    with pytest.raises(TimeoutError):
        polishing.polish({}, "hej", "")
    assert polishing.answer(1, text="för sent") is False


def test_aktuell_mikrofon_foljer_motorns_regler(host, monkeypatch):
    chosen = mics.Choice(5, "Mikrofonmatris (Realtek)", False, avoided="Jabra Evolve3 85")
    seen = {}

    def resolve(device, avoid):
        seen["args"] = (device, avoid)
        return chosen

    monkeypatch.setattr(stdio.mics, "resolve", resolve)
    host.handle({"cmd": "current_mic", "id": 4})
    assert host.out.last() == {
        "event": "ok", "cmd": "current_mic", "id": 4, "name": "Mikrofonmatris (Realtek)",
        "bluetooth": False, "avoided": "Jabra Evolve3 85", "in_call": False,
    }
    assert seen["args"] == (None, True)


def test_utan_tangent_laddas_modellen_bara_for_moten(host):
    # Referat startar motorn för mötesljud även när dikteringen är av.
    host.handle({"cmd": "configure", "config": {"hotkey": ""}})
    assert host.keys == []
    assert host.loads == [("sv", False)]
    host.handle({"cmd": "configure", "config": {"hotkey": "f9"}})
    assert [k.hotkey for k in host.keys] == ["f9"]
    host.handle({"cmd": "configure", "config": {"hotkey": ""}})
    assert host.keys[0].stopped
    assert len(host.keys) == 1
