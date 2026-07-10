# referat — produktspec

> Mötesanteckningar som stannar hos dig.

## Vad

Windows-desktopapp som spelar in möten (systemljud + mikrofon), transkriberar och
producerar ett färdigt mötesprotokoll — sammanfattning, beslut och actionpunkter.
Användaren väljer själv var AI:n kör: lokalt på datorn, på företagets interna server,
eller hos en molnleverantör. Ingenting lämnar datorn utan att användaren valt det.

## Målgrupp

Den otekniska kontorsanvändaren: HR, jurister, projektledare, chefer, sälj. Personen
har aldrig öppnat en terminal och ska aldrig behöva göra det. Allt konfigureras via
ett vänligt GUI med klarspråk — inga tekniska termer utan förklaring.

## Kärnvärden (i prioritetsordning)

1. **Enkelhet** — från installation till färdigt protokoll utan manual. En stor knapp:
   "Starta inspelning". Resten sker automatiskt.
2. **Integritet** — tydligt var ljud och text tar vägen. Lokal-läget är default-pitchen.
3. **Flexibilitet** — IT-avdelningen kan peka appen mot företagets egen AI-endpoint.

## Användarflöde

### Första start (onboarding-wizard)
1. Välkomstskärm — vad appen gör, 15 sekunder att läsa.
2. "Var ska AI:n köra?" — tre kort med klarspråk:
   - **På den här datorn** (kräver lokal AI-server, guide finns)
   - **På företagets server** (IT ger dig en adress + ev. nyckel)
   - **Molntjänst** (OpenAI, Azure OpenAI — ange nyckel)
3. Anslutningstest med tydlig grön bock / röd förklaring i klarspråk.
4. Mikrofontest — prata, se mätaren röra sig, klart.

Wizarden går att hoppa över och nås igen från inställningar.

### Vardagsflödet
1. Öppna appen → stor "Starta inspelning"-knapp. Valfritt: mötestitel.
2. Under inspelning: timer, ljudnivåmätare (mick + systemljud separat), paus/stopp.
   Appen kan minimeras till systray; diskret indikator på att inspelning pågår.
3. Stopp → pipeline kör automatiskt: Transkriberar… → Sammanfattar… → Klart.
   Tydliga statussteg med progress. Går att stänga appen; jobbet återupptas.
4. Mötesvy: **Protokoll**-flik (sammanfattning, beslut, actionpunkter med ägare) och
   **Transkript**-flik (fulltext, sökbar). Export: Markdown, Word (.docx), kopiera.
5. Startsidan listar tidigare möten med statuschip: Inspelad / Transkriberad / Klar /
   Fel (med "försök igen").

## AI-provider-modell (säljargumentet)

Två provider-slots, konfigurerade oberoende av varandra:

- **Transkribering**: OpenAI-kompatibel `/v1/audio/transcriptions`-endpoint.
  Presets: Lokal server, OpenAI, Azure OpenAI, Egen endpoint. Fält: bas-URL,
  API-nyckel (valfri), modellnamn, språk.
- **Sammanfattning**: OpenAI-kompatibel chat completions ELLER Anthropic API.
  Presets: Lokal server (Ollama m.fl.), OpenAI, Azure OpenAI, Anthropic, Egen endpoint.

Varje provider har en "Testa anslutning"-knapp med begripliga felmeddelanden
("Fel nyckel", "Servern svarar inte — kontrollera adressen med IT").
Nycklar lagras krypterat via Electron safeStorage, aldrig i klartext.

## Protokollmall

Standardmall (svenska): **Sammanfattning** (5–10 meningar), **Beslut** (punktlista),
**Actionpunkter** (punkt + ägare + ev. deadline), **Öppna frågor**. Mallen är en
redigerbar prompt i inställningar för avancerade användare; default funkar utan pill.

## Talardiarisering (tillval)

"Vem sa vad" — transkriptet kan märkas upp per talare ("Talare 1", "Talare 2") och
namnen kan bytas i efterhand ("Anna"), vilket följer med in i protokollet. Kräver en
lokal talarserver (guide finns i wikin) och är avstängt som default — en
kraftanvändarfunktion som inte rör onboardingen.

### Röstigenkänning mellan möten (tillval i tillvalet)

Egen featureflagga, av som default. När den är på sparas ett lokalt röstavtryck när
användaren namnger en talare; nästa möte där rösten hörs föreslås namnet som
"Anna?" — alltid ett förslag som användaren bekräftar, aldrig ett tyst beslut (ett
felaktigt "Anna sa X" i ett HR-protokoll är värre än ett anonymt "Talare 2").
Röstavtryck är biometriska personuppgifter (GDPR art. 9): allt lagras lokalt,
avtryck kan raderas enskilt eller alla på en gång, och inställningstexten uppmanar
till att informera deltagarna. Wikin dokumenterar ansvaret för IT/DPO.

## Utanför scope (MVP)

Live-transkribering under mötet, kalenderintegration, team-delning,
macOS/Linux, engelska UI. Arkitekturen ska inte blockera dessa senare.

## Distribution

- Windows-installer (NSIS via electron-builder), signeringsfritt MVP.
- Landningssida (statisk, i `site/`) med nedladdningsknapp, produktpitch och
  3-stegs "kom igång". Deploybar till GitHub Pages.
