"""Efterbehandling av transkriberad text: röstkommandon och ersättningar.

Röstkommandon: "ny rad" och "nytt stycke" (samt engelska motsvarigheter)
ersätts med radbrytningar. Frasen matchas som egna ord och slukar
omgivande skiljetecken — Whisper skriver gärna "Ny rad." med punkt och
versal. Kommandolistan ligger i config (voice_commands).

Ersättningsregler: namn och facktermer som Whisper hör fel. Ordlistan
(initial_prompt) är bara ett tips till modellen och ignoreras ofta, medan
en regel här alltid slår igenom. Reglerna körs FÖRE röstkommandona så att
en ersättning aldrig kan råka bygga ihop ett kommando av misstag.
"""

import re


def apply(text: str, commands: dict) -> str:
    if not text or not commands:
        return text
    # Längsta frasen först så att "nytt stycke" inte hinner halvmatchas
    # av en kortare fras med samma början.
    for phrase in sorted(commands, key=len, reverse=True):
        replacement = commands[phrase]
        # Komma före frasen slukas ("det här, ny rad" → "det här\n") men
        # meningsavslutare lämnas kvar — punkten tillhör förra meningen.
        pattern = re.compile(
            r"[ \t]*,?[ \t]*\b" + re.escape(phrase) + r"\b[.,!?]*",
            re.IGNORECASE,
        )
        text = pattern.sub(lambda _m, r=replacement: r, text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)  # inga hängande mellanslag
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(" ")


def apply_replacements(text: str, replacements: dict) -> str:
    """Byter ut hörda fraser mot rätt text. Matchar hela ord,
    skiftlägesokänsligt, längsta frasen först (så "Avanza Auto" hinner
    matcha före "Avanza").

    Skiftläget speglas bara när ersättningen är helt gemen — då är den
    skriven utan avsikt om versaler och ska följa meningen den hamnar i.
    Har den egna versaler ("iPhone", "KB-Whisper") är de medvetna och
    lämnas i fred.
    """
    if not text or not replacements or not isinstance(replacements, dict):
        return text
    phrases = [p for p in replacements if isinstance(p, str) and p.strip()]
    for phrase in sorted(phrases, key=len, reverse=True):
        target = replacements[phrase]
        if not isinstance(target, str):
            continue
        # Lookarounds i stället för : fraser kan börja eller sluta på
        # skiljetecken ("t.ex.") och då matchar  på fel ställe.
        pattern = re.compile(
            r"(?<!\w)" + re.escape(phrase.strip()) + r"(?!\w)", re.IGNORECASE
        )
        text = pattern.sub(lambda m, r=target: _match_case(m.group(0), r), text)
    return text


def _match_case(matched: str, replacement: str) -> str:
    if replacement != replacement.lower():
        return replacement  # egna versaler är medvetna
    if matched.isupper() and len(matched) > 1:
        return replacement.upper()
    if matched[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement
