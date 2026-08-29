# Publicera i winget

## Varför

En osignerad installer möter SmartScreen-varningen i webbläsarens nedladdningsflöde.
`winget install` går inte den vägen, så varningen uteblir helt — utan certifikat och utan
kostnad. Vid nuvarande volym löser det mer än kodsignering skulle göra, och det är därför
SignPath ligger på is (se [signering.md](signering.md)).

Paketet heter `Sockulags.Referat` och har alias `referat`.

## Generera manifesten

Manifesten pekar på en publicerad release-asset och bär dess SHA256, så releasen måste
finnas först. Kör efter att GitHub-releasen är publicerad:

```powershell
./scripts/winget-manifests.ps1 -Version 0.9.0
```

Skriptet laddar ner `referat-setup.exe` från releasen, räknar fram hashen och skriver tre
filer till `dist/winget/<version>/`. Utan `-Version` används versionen i package.json.
Med `-InstallerPath` hashas en lokal fil i stället, vilket är användbart för att titta på
resultatet innan releasen finns.

Kontrollera sedan:

```powershell
winget validate --manifest dist/winget/0.9.0
```

## Skicka in

### Första gången

Paketet finns inte i katalogen än, så den första versionen går in som en vanlig pull request
mot [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs):

1. Forka repot.
2. Lägg filerna i `manifests/s/Sockulags/Referat/<version>/`.
3. Öppna en PR. Automatisk validering kör, installern skannas, och en moderator granskar.
   Räkna med några dagar.

### Därefter

När paketet väl finns sköter `wingetcreate` resten:

```powershell
winget install Microsoft.WingetCreate
wingetcreate update Sockulags.Referat --version 0.9.0 --urls https://github.com/sockulags/referat/releases/download/v0.9.0/referat-setup.exe --submit --token <PAT>
```

Den hämtar det befintliga manifestet, uppdaterar version och hash, forkar och öppnar PR:en.
Token behöver `public_repo`. Det går att lägga i release-bygget senare, men först ska den
manuella vägen ha fungerat en gång.

## Efter att paketet är godkänt

Först då är det sant att man kan installera med winget, så vänta med att skriva det i
användardokumentationen. När det är live hör det hemma i:

- `wiki-content/Installation.md` som förstahandsalternativ före den direkta nedladdningen
- `README.md` under installationsavsnittet
- `site/index.html` vid nedladdningsknappen

## Att hålla koll på

- **Tyst installation.** Manifestet anger `/S`, vilket är electron-builders NSIS-standard för
  en one-click-installer. Det är inte verifierat mot en riktig installation ännu — kontrollera
  vid första `winget install` att den går igenom utan dialog.
- **Per användare, inte per maskin.** `Scope: user` speglar `perMachine: false` i
  electron-builder.yml. Ändras det måste manifestet följa med.
- **ProductCode saknas.** Matchningen mot Program och funktioner sker via
  `AppsAndFeaturesEntries` med namn, utgivare och version. När appen är installerad går det
  att läsa av det riktiga avinstallations-GUID:t och lägga till `ProductCode` för säkrare
  uppgraderingsdetektering.
- **Appens egen uppdaterare finns kvar.** electron-updater uppdaterar i bakgrunden oavsett hur
  appen installerades, och eftersom uppdateringen kör samma NSIS-installer skrivs versionen i
  Program och funktioner om. Följden är att den installerade versionen ofta ligger före
  katalogen. Det är ofarligt — `winget upgrade` hittar bara ingenting — men det betyder att
  winget är en väg in, inte uppdateringskanalen.
