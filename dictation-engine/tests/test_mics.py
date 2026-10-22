"""Valet av mikrofon när ett Bluetooth-headset är Windows standard.

Enhetsnamnen är tagna från en riktig dator: två Bluetooth-headset, ett
USB-ljudkort och en inbyggd mikrofon.
"""

from viska import mics

ENDPOINTS = [
    mics.Endpoint("Jabra Evolve3 85 Hands-Free", "BTHHFENUM"),
    mics.Endpoint("JBL LIVE770NC Hands-Free", "BTHHFENUM"),
    mics.Endpoint("Realtek USB2.0 Audio", "USB"),
    mics.Endpoint("Realtek(R) Audio", "HDAUDIO"),
    mics.Endpoint("Jabra Link 390", "USB"),
]

HEADSET = (3, "Headset (Jabra Evolve3 85 Hands-Free)")
USB_MIC = (5, "Microphone (Realtek USB2.0 Audio)")
USB_LINE = (6, "Line (Realtek USB2.0 Audio)")
BUILT_IN = (8, "Mikrofonmatris (Realtek(R) Audio)")


def test_headset_som_standard_ersatts_av_inbyggd_mikrofon():
    choice = mics.choose([HEADSET, USB_MIC, BUILT_IN], 3, ENDPOINTS)
    assert choice.device == 8
    assert not choice.bluetooth
    assert choice.avoided == "Jabra Evolve3 85 Hands-Free"
    assert "samtalsläge" in choice.describe()


def test_usb_valjs_nar_inbyggd_saknas_men_aldrig_linjeingang():
    choice = mics.choose([HEADSET, USB_LINE, USB_MIC], 3, ENDPOINTS)
    assert choice.device == 5


def test_vanlig_standardmikrofon_rors_inte():
    choice = mics.choose([HEADSET, USB_MIC, BUILT_IN], 5, ENDPOINTS)
    assert choice.device == 5
    assert choice.avoided is None


def test_headset_anvands_om_det_ar_enda_mikrofonen():
    choice = mics.choose([HEADSET, USB_LINE], 3, ENDPOINTS)
    assert choice.device == 3
    assert choice.bluetooth


def test_headset_anvands_nar_anvandaren_vill():
    choice = mics.choose([HEADSET, BUILT_IN], 3, ENDPOINTS, avoid_bluetooth=False)
    assert choice.device == 3
    assert choice.bluetooth
    assert "samtalsläge" in choice.describe()


def test_ingen_standard_ger_inget_val():
    assert mics.choose([USB_MIC], None, ENDPOINTS) is None


def test_namnet_racker_nar_registret_inte_kanner_enheten():
    assert mics.is_bluetooth("Headset (Okänt märke Hands-Free)", [])
    assert not mics.is_bluetooth("Microphone (Okänt USB-kort)", [])


def test_usb_dongel_raknas_inte_som_bluetooth():
    # Jabra Link 390 talar Bluetooth med headsetet men är ett USB-ljudkort
    # för Windows; samtalsläget hanteras i dongeln och syns inte här.
    assert not mics.is_bluetooth("Headset Microphone (Jabra Link 390)", ENDPOINTS)


def test_registret_gar_att_lasa():
    # Alla Windows-datorer har nyckeln; poster utan egenskaperna hoppas över.
    for ep in mics.capture_endpoints():
        assert ep.device
        assert ep.enumerator


# -- Pågående samtal --------------------------------------------------------------

TEAMS = r"microphone\MSTeams_8wekyb3d8bbwe"
CHROME = r"microphone\NonPackaged\C:#Program Files#Google#Chrome#Application#chrome.exe"
ZOOM = r"microphone\NonPackaged\C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe"
VISKA = r"microphone\NonPackaged\C:#Users#a#Viska#Viska.exe"
OBS = r"microphone\NonPackaged\C:#Program Files#obs-studio#bin#64bit#obs64.exe"


def test_samtalsprogram_kanns_igen():
    for key in (TEAMS, CHROME, ZOOM):
        assert mics.in_call([key]), key


def test_andra_program_med_mikrofonen_ar_inget_samtal():
    assert not mics.in_call([VISKA, OBS])
    assert not mics.in_call([])


def test_headset_anvands_under_ett_samtal():
    choice = mics.choose(
        [HEADSET, BUILT_IN], 3, ENDPOINTS, call_active=True
    )
    assert choice.device == 3
    assert choice.in_call
    assert "redan i samtalsläge" in choice.describe()


def test_samtal_paverkar_inte_en_vanlig_mikrofon():
    choice = mics.choose([HEADSET, BUILT_IN], 8, ENDPOINTS, call_active=True)
    assert choice.device == 8
    assert not choice.in_call


def test_registret_over_mikrofonanvandare_gar_att_lasa():
    assert isinstance(mics.mic_users(), list)


# Namnen från loggen på en Dell där varje val misslyckades: samma mikrofon
# finns under MME, DirectSound, WASAPI och WDM-KS, så namnet ensamt pekade
# ut fyra enheter.
DELL_INPUTS = [
    (17, "Microphone Array (2- Realtek(R) Audio)"),
    (18, "Headset (Jabra Evolve3 85)"),
]


def test_sparat_namn_blir_wasapi_index():
    assert mics.find_input("Headset (Jabra Evolve3 85)", DELL_INPUTS) == DELL_INPUTS[1]
    assert mics.find_input("microphone array (2- realtek(r) audio)", DELL_INPUTS) == (
        DELL_INPUTS[0]
    )


def test_avkortat_eller_forlangt_namn_hittas():
    # MME kortar till 31 tecken; Chromium lägger till USB-id.
    assert mics.find_input("Microphone Array (2- Realtek(R)", DELL_INPUTS)[0] == 17
    assert mics.find_input("Headset (Jabra Evolve3 85) (0b0e:24d4)", DELL_INPUTS)[0] == 18


def test_okant_namn_hittas_inte():
    assert mics.find_input("Mikrofon (USB-dongel)", DELL_INPUTS) is None
    assert mics.find_input("  ", DELL_INPUTS) is None


def _fake_system(monkeypatch, inputs, default):
    monkeypatch.setattr(mics, "_wasapi_inputs", lambda: (inputs, default))
    monkeypatch.setattr(mics, "capture_endpoints", lambda: ENDPOINTS)
    monkeypatch.setattr(mics, "in_call", lambda users=None: False)


def test_valt_namn_oppnas_med_index(monkeypatch):
    _fake_system(monkeypatch, DELL_INPUTS, 17)
    choice = mics.resolve("Headset (Jabra Evolve3 85)")
    assert choice.device == 18
    assert choice.name == "Headset (Jabra Evolve3 85)"


def test_vald_mikrofon_som_saknas_ger_automatiskt_val(monkeypatch):
    _fake_system(monkeypatch, [HEADSET, BUILT_IN], HEADSET[0])
    choice = mics.resolve("Headset (JBL LIVE770NC Hands-Free)")
    assert choice.device == BUILT_IN[0]
    assert choice.avoided == "Jabra Evolve3 85 Hands-Free"
