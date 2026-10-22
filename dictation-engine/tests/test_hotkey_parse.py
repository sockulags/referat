"""Tolkning av tangent- och musbindningar. Inga hookar registreras här."""

import pytest

from viska.hotkey import HotkeyError, is_mouse, parse_hotkey


def test_funktionstangent():
    assert parse_hotkey("f9") == (0, 0x78)


def test_modifierare():
    mods, vk = parse_hotkey("ctrl+alt+d")
    assert mods == 0x0002 | 0x0001
    assert vk == ord("D")


def test_skiftlage_och_mellanslag_spelar_ingen_roll():
    assert parse_hotkey(" Ctrl + F9 ") == parse_hotkey("ctrl+f9")


def test_musknappar_far_egna_virtuella_koder():
    assert parse_hotkey("mouse4") == (0, 0x05)
    assert parse_hotkey("mouse5") == (0, 0x06)
    assert parse_hotkey("mouse3") == (0, 0x04)


def test_musknapp_med_modifierare():
    assert parse_hotkey("ctrl+mouse5") == (0x0002, 0x06)


def test_is_mouse():
    assert is_mouse("mouse4")
    assert is_mouse("Ctrl+Mouse5")
    assert not is_mouse("f9")
    assert not is_mouse("ctrl+alt+d")


def test_vanster_och_hoger_musknapp_gar_inte_att_binda():
    for namn in ("mouse1", "mouse2", "left mouse"):
        with pytest.raises(HotkeyError):
            parse_hotkey(namn)


def test_okand_tangent_avvisas():
    with pytest.raises(HotkeyError):
        parse_hotkey("blaha")


def test_bara_modifierare_avvisas():
    with pytest.raises(HotkeyError):
        parse_hotkey("ctrl+alt")


def test_tva_huvudtangenter_avvisas():
    with pytest.raises(HotkeyError):
        parse_hotkey("f9+f10")
    with pytest.raises(HotkeyError):
        parse_hotkey("f9+mouse4")
