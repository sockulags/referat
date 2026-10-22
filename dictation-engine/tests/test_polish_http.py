"""http-backenden mot en påhittad server i samma process."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from viska import codex, llm

class _Stub(BaseHTTPRequestHandler):
    """Svarar som poleringstjänsten. `mode` styrs per test."""

    mode = "ok"
    seen: dict = {}

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.mode == "down":
            self._send(500, {"error": {"message": "nere"}})
        else:
            self._send(200, {"status": "ok"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        _Stub.seen = {
            "body": json.loads(self.rfile.read(length)),
            "auth": self.headers.get("Authorization"),
            "path": self.path,
        }
        if self.mode == "quota":
            self._send(429, {"error": {"message": "You've hit your usage limit."}})
        elif self.mode == "broken":
            self._send(502, {"error": {"message": "Codex svarade utan text"}})
        elif self.mode == "empty":
            self._send(200, {"choices": [{"message": {"content": "   "}}]})
        else:
            self._send(
                200,
                {"choices": [{"message": {"content": "Polerad text."}}]},
            )

    def log_message(self, *_a):
        pass


@pytest.fixture
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _Stub.mode = "ok"
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def cfg(url, **overrides):
    return {
        "polish_backend": "http",
        "polish_http_url": f"{url}/v1/chat/completions",
        "polish_http_model": "gpt-5.4-mini",
        "polish_http_token": "",
        "polish_http_timeout_s": 5,
        **overrides,
    }


def test_polering_gar_igenom(server):
    assert llm.polish_http(cfg(server), "hej hej", "skriv ett mejl") == "Polerad text."
    body = _Stub.seen["body"]
    assert body["model"] == "gpt-5.4-mini"
    assert body["temperature"] == 0
    assert body["stream"] is False
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "skriv ett mejl" in body["messages"][0]["content"]
    assert body["messages"][1]["content"] == "hej hej"


def test_nyckeln_skickas_som_bearer(server):
    llm.polish_http(cfg(server, polish_http_token="hemlis"), "hej", "")
    assert _Stub.seen["auth"] == "Bearer hemlis"


def test_utan_nyckel_skickas_ingen_header(server):
    llm.polish_http(cfg(server), "hej", "")
    assert _Stub.seen["auth"] is None


def test_tomt_svar_ger_ratexten_tillbaka(server):
    _Stub.mode = "empty"
    assert llm.polish_http(cfg(server), "originaltexten", "") == "originaltexten"


def test_kvotstopp_sags_rakt_ut(server):
    _Stub.mode = "quota"
    with pytest.raises(RuntimeError) as e:
        llm.polish_http(cfg(server), "hej", "")
    assert "kvot" in str(e.value)
    assert "usage limit" in str(e.value)


def test_ovriga_fel_tar_med_statuskoden(server):
    _Stub.mode = "broken"
    with pytest.raises(RuntimeError) as e:
        llm.polish_http(cfg(server), "hej", "")
    assert "502" in str(e.value)


def test_nabarhetskollen_ser_health(server):
    assert llm.http_reachable(cfg(server)) is True


def test_nabarhetskollen_faller_ner_nar_tjansten_ar_nere(server):
    _Stub.mode = "down"
    assert llm.http_reachable(cfg(server)) is False


def test_nabarhetskollen_pa_stangd_port():
    assert llm.http_reachable(cfg("http://127.0.0.1:1")) is False


# -- Backendvalet -------------------------------------------------------------


def test_http_raknas_som_fjarrbackend():
    assert llm.is_remote({"polish_backend": "http"})
    assert llm.is_remote({"polish_backend": "ollama"})
    assert not llm.is_remote({"polish_backend": "builtin"})


def test_fjarrbackend_delar_inte_vram():
    assert not llm.polish_shares_gpu({"polish_backend": "http"})


def test_etikett_och_modell_foljer_backend():
    c = cfg("http://x", polish_ollama_model="qwen3.5:9b")
    assert llm.remote_model(c) == "gpt-5.4-mini"
    assert "moln" in llm.remote_label(c)
    c["polish_backend"] = "ollama"
    assert llm.remote_model(c) == "qwen3.5:9b"
    assert llm.remote_label(c) == "Ollama"


# -- Vem som får skriva in text för en diktering -------------------------------


def _guard():
    from viska.engine import InsertionGuard

    return InsertionGuard()


def test_forsta_anspraket_vinner():
    guard = _guard()
    assert guard.claim("polerad") is True
    assert guard.claim("rå") is False
    assert guard.winner == "polerad"


def test_ratext_infogas_hogst_en_gang():
    guard = _guard()
    assert guard.claim("rå") is True
    assert guard.claim("rå") is False


def test_sent_svar_far_inte_infogas_efter_ratext():
    guard = _guard()
    guard.claim("rå")
    assert guard.claim("polerad") is False


def test_avbrott_stoppar_all_inskrivning():
    guard = _guard()
    guard.cancel()
    assert guard.cancelled is True
    assert guard.claim("polerad") is False
    assert guard.claim("rå") is False


def test_avbrott_efter_inskrivning_andrar_inte_vinnaren():
    guard = _guard()
    guard.claim("polerad")
    guard.cancel()
    assert guard.winner == "polerad"
    assert guard.cancelled is False


# -- Codex-motorn: det som går att prova utan att anropa modellen -------------


class _FakeStatus:
    """Som SDK:ns TurnStatus: en enum vars strängform inte är värdet."""

    def __init__(self, value):
        self.value = value

    def __str__(self):
        return f"TurnStatus.{self.value}"


class _FakeResult:
    def __init__(self, status):
        self.status = status


def test_status_lases_ur_enumen():
    assert codex.turn_status(_FakeResult(_FakeStatus("completed"))) == "completed"
    assert codex.turn_status(_FakeResult(_FakeStatus("failed"))) == "failed"


def test_status_tar_ocksa_strang_och_saknat_varde():
    assert codex.turn_status(_FakeResult("completed")) == "completed"
    assert codex.turn_status(_FakeResult(None)) == "completed"


def test_kvotstopp_sags_rakt_ut_i_klartext():
    text = codex.friendly_error(RuntimeError("You've hit your usage limit."))
    assert "kvot" in text.lower()


def test_ovriga_fel_lamnas_som_de_ar():
    assert codex.friendly_error(RuntimeError("nätverket dog")) == "nätverket dog"


def test_saknad_codex_forklaras(monkeypatch):
    monkeypatch.setattr(codex.shutil, "which", lambda _n: None)
    monkeypatch.setattr(codex, "_KNOWN_PATHS", ())
    ok, text = codex.status()
    assert ok is False
    assert "hittades inte" in text


def test_installerad_men_utloggad_forklaras(monkeypatch, tmp_path):
    fake = tmp_path / "codex.exe"
    fake.write_text("")
    monkeypatch.setattr(codex.shutil, "which", lambda _n: str(fake))
    monkeypatch.setattr(codex, "user_home", lambda: tmp_path / "tomt")
    ok, text = codex.status()
    assert ok is False
    assert "inte inloggad" in text


def test_eget_hem_far_config_och_kopierad_inloggning(monkeypatch, tmp_path):
    real_home = tmp_path / "riktigt"
    real_home.mkdir()
    (real_home / "auth.json").write_text('{"token": "abc"}', encoding="utf-8")
    monkeypatch.setattr(codex, "user_home", lambda: real_home)
    monkeypatch.setattr(codex, "CODEX_HOME", tmp_path / "viska-hem")
    codex.provision_home()
    config_text = (codex.CODEX_HOME / "config.toml").read_text(encoding="utf-8")
    # Inga verktyg, ingen sandlådeåtkomst, ingen webbsökning.
    assert 'sandbox_mode = "read-only"' in config_text
    assert 'web_search = "disabled"' in config_text
    assert (codex.CODEX_HOME / "auth.json").read_text(encoding="utf-8") == '{"token": "abc"}'
    # Ingenting av användarens egen uppsättning följer med.
    assert list((codex.CODEX_HOME).iterdir()).__len__() == 2


def test_utloggad_ger_tydligt_fel(monkeypatch, tmp_path):
    monkeypatch.setattr(codex, "user_home", lambda: tmp_path / "tomt")
    monkeypatch.setattr(codex, "CODEX_HOME", tmp_path / "hem")
    with pytest.raises(RuntimeError, match="inloggad"):
        codex.provision_home()
