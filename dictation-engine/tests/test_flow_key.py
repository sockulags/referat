"""Knappen som avgör om en diktering skrivs om, och hur länge flow väntar.

Knappen är en låtsad knapp, så testerna rör aldrig det riktiga tangentbordet.
"""

import pytest

from viska.engine import flow_polish_timeout_s, flow_with_key


def cfg(key="ctrl", means="polish"):
    return {"flow_key": key, "flow_key_means": means}


def held(*names):
    return lambda name: name in names


def test_utan_knapp_avgor_flow_ensam():
    assert flow_with_key(True, cfg(key=""), held()) is True
    assert flow_with_key(False, cfg(key=""), held("ctrl")) is False


def test_knappen_betyder_skriv_om():
    assert flow_with_key(True, cfg(), held("ctrl")) is True
    assert flow_with_key(True, cfg(), held()) is False
    # En annan knapp än den valda räknas inte.
    assert flow_with_key(True, cfg(), held("shift")) is False


def test_knappen_betyder_skriv_in_direkt():
    assert flow_with_key(True, cfg(means="raw"), held("ctrl")) is False
    assert flow_with_key(True, cfg(means="raw"), held()) is True


def test_knappen_slar_aldrig_pa_flow_som_ar_avstangt():
    assert flow_with_key(False, cfg(), held("ctrl")) is False


def test_tidsgransen_vaxer_med_texten_men_har_ett_tak():
    assert flow_polish_timeout_s("hej") == pytest.approx(10.15)
    assert flow_polish_timeout_s("ord " * 200) == pytest.approx(40.0)
    assert flow_polish_timeout_s("ord " * 5000) == 90.0
