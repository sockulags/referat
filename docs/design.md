# referat — designbrief

## Känsla

Skandinavisk, lugn, förtroendeingivande. Appen hanterar känsliga samtal — designen ska
kännas som en välgjord bank- eller vårdapp, inte som ett utvecklarverktyg. Ledord:
**ren, varm, tyst självsäker**. Ingen visuell stress, inga onödiga ramar och skuggor.

## Varumärke

- Namn: **referat** — alltid gemener i wordmark.
- Tagline: *"Mötesanteckningar som stannar hos dig."*
- Ikon/symbol: enkel, abstrakt — t.ex. ett stiliserat citattecken eller ljudvåg som
  övergår i textrader. Ingen mikrofon-klyscha om det går att undvika.

## Färg

- **Bas**: varm off-white (`#FAF9F7`-aktig) ljust läge; djup varmgrå (inte kolsvart)
  mörkt läge. Appen ska stödja båda; följ systemtema, växlingsbart i inställningar.
- **Accent**: djup skogsgrön (~`#2D6A4F`-familjen) — förtroende, integritet, svenskt.
  Används sparsamt: primärknappar, aktiva tillstånd, statuschips.
- **Inspelning**: varm röd/korall endast för inspelningsindikatorn.
- Text: hög kontrast, WCAG AA minst.

## Typografi

- UI: Inter (variabel, self-hostad — inga CDN-anrop).
- Protokoll/transkript-läsvyn: något större radavstånd, max ~70 tecken radlängd,
  som en välsatt dokumentvy — det är produktens "leverans" och ska kännas premium.

## Komponentspråk

- Rundade hörn (8–12 px), generös whitespace, tydlig typografisk hierarki.
- Statuschips med färg + ikon + ord (aldrig bara färg).
- Micro-interactions: mjuka transitions (150–200 ms), nivåmätare som andas,
  pipeline-steg som checkas av med diskret animation. Inget som blinkar eller studsar.
- Tomma tillstånd är designade (första start utan möten = vänlig illustration + CTA),
  aldrig bara tom yta.
- Felmeddelanden i klarspråk med nästa steg, aldrig råa felkoder (koden kan visas
  bakom "visa detaljer").

## Landningssidan (`site/`)

Samma varumärke. Hero med tagline + nedladdningsknapp + produktscreenshot.
Sektioner: integritetspitchen (lokal AI, din data), "så funkar det" i 3 steg,
provider-flexibiliteten (för IT-chefen), FAQ, footer. Statisk HTML/CSS/JS utan
ramverk, snabb, responsiv, ljust+mörkt tema. Ton: saklig svenska, ingen hype.
