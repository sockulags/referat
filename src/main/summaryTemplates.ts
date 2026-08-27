// The seeded prompt templates. A meeting can be summarized through several of
// them — the template decides who the summary is written for, not just how it
// looks. Users can edit every template and add their own; the built-in ones
// can be edited but never deleted, so there is always something to fall back to.

import type { SummaryTemplate } from '../shared/types'

/** The template a meeting uses when nothing else has been chosen. */
export const DEFAULT_TEMPLATE_ID = 'protokoll'

/**
 * The 0.5 protocol prompt, unchanged. Settings compares against it to tell an
 * untouched legacy prompt from one the user hand-edited.
 */
export const DEFAULT_PROMPT_TEMPLATE = `Du är en erfaren mötessekreterare. Nedan följer en transkription av ett möte.
Skriv ett tydligt och professionellt mötesprotokoll i Markdown med exakt dessa rubriker:

## Sammanfattning
5–10 meningar som fångar mötets syfte och viktigaste innehåll.

## Beslut
Punktlista med de beslut som fattades. Skriv "Inga beslut fattades." om inga beslut togs.

## Actionpunkter
Punktlista med uppgifter. Ange ägare och deadline där det framgår, t.ex.
"- Ta fram budgetförslag — Anna (senast 15 mars)". Skriv "Inga actionpunkter." om inga finns.

## Öppna frågor
Punktlista med frågor som lämnades olösta. Skriv "Inga öppna frågor." om inga finns.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Använd endast information som finns i transkriptionen. Hitta aldrig på namn, beslut eller siffror.
- Var koncis och saklig.

{{ordlista}}

{{fokus}}

Transkription:
{{transcript}}`

const QUICK_SUMMARY = `Du sammanfattar ett möte för någon som inte var med och har två minuter på sig.
Skriv löpande text i Markdown, 8–12 meningar, utan rubriker och utan punktlistor.

Börja med vad mötet handlade om, fortsätt med det som faktiskt hände och avsluta med
vad som händer härnäst. Nämn namn bara när det spelar roll för vad som bestämdes.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Använd endast information som finns i transkriptionen. Hitta aldrig på namn, beslut eller siffror.
- Utelämna småprat och sidospår.

{{ordlista}}

{{fokus}}

Transkription:
{{transcript}}`

const ACTION_ITEMS = `Du plockar ut allt som någon ska göra efter ett möte. Skriv i Markdown.

## Actionpunkter
En punkt per uppgift, i formen "- Uppgift — Ägare (deadline)". Utelämna ägare eller
deadline när de inte framgår, i stället för att gissa. Sätt de uppgifter som har
deadline först. Skriv "Inga actionpunkter." om inga finns.

## Oklart ansvar
Punktlista med uppgifter där det inte framgår vem som ska göra dem. Skriv
"Inga oklara ansvar." om allt är tilldelat.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Ta bara med det som någon faktiskt åtog sig eller fick — inte idéer som nämndes i förbigående.
- Hitta aldrig på namn, uppgifter eller datum.

{{ordlista}}

{{fokus}}

Transkription:
{{transcript}}`

const DECISION_LOG = `Du för beslutslogg åt ett arkiv. Skriv i Markdown, ett avsnitt per beslut.

För varje beslut:
### Beslutet i en mening
- **Motivering:** varför det blev så, med de argument som faktiskt framfördes.
- **Bortvalt alternativ:** vad mer som diskuterades, eller "Inga nämnda".
- **Vem som beslutade:** namn eller roll när det framgår, annars "Framgår inte".

Skriv "Inga beslut fattades." om mötet inte ledde till några beslut.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Ta bara med det som faktiskt avgjordes, inte det som lämnades öppet.
- Hitta aldrig på motiveringar som inte sades.

{{ordlista}}

{{fokus}}

Transkription:
{{transcript}}`

const FOLLOW_UP_EMAIL = `Du skriver ett uppföljningsmejl efter ett möte, riktat till en extern mottagare —
en kund, en leverantör eller en samarbetspartner.

Skriv i Markdown: först en rad "**Ämne:** …" med en konkret ämnesrad, sedan själva
mejlet. Mejlet har en kort inledning, det ni kom överens om, vad som händer härnäst
och vem som gör vad, och en avslutande mening. Håll det under 200 ord.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Utelämna interna resonemang och allt annat som mottagaren inte ska läsa.
- Lova ingenting som inte sades på mötet, och hitta aldrig på datum eller priser.
- Avsluta utan hälsningsfras och avsändarnamn — det fyller användaren i själv.

{{ordlista}}

{{fokus}}

Transkription:
{{transcript}}`

/** The seeded templates, in the order they appear in every picker. */
export function builtInTemplates(): SummaryTemplate[] {
  return [
    {
      id: DEFAULT_TEMPLATE_ID,
      name: 'Protokoll',
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      builtIn: true
    },
    { id: 'sammandrag', name: 'Snabbt sammandrag', promptTemplate: QUICK_SUMMARY, builtIn: true },
    { id: 'actionpunkter', name: 'Actionpunkter', promptTemplate: ACTION_ITEMS, builtIn: true },
    { id: 'beslutslogg', name: 'Beslutslogg', promptTemplate: DECISION_LOG, builtIn: true },
    {
      id: 'uppfoljningsmejl',
      name: 'Uppföljningsmejl',
      promptTemplate: FOLLOW_UP_EMAIL,
      builtIn: true
    }
  ]
}
