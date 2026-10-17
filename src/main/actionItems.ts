// Action items as data: what someone took on during the meeting, with owner,
// due date and where in the recording it was agreed. Taken from the
// transcript by the summary model, once; afterwards they belong to the user,
// who edits them and hands them off to other tools. referat does not track
// them, so there is no status.

import { randomUUID } from 'crypto'
import type { ActionItem, Transcript } from '../shared/types'
import { readActionItems, readMeta, readTranscript, writeActionItems } from './storage'
import { getSummaryConfig } from './settings'
import { glossaryPromptBlock, termsForProject } from './glossary'
import { summarize } from './providers/summary'
import { UserFacingError } from './providers/shared'

/** More than this is a model listing every sentence, not a meeting's action items. */
const MAX_ITEMS = 50
const MAX_TEXT = 500
const MAX_OWNER = 80

export const ACTION_ITEMS_PROMPT = `Ta fram mötets actionpunkter ur transkriptet nedan: sådant som någon åtog sig eller fick i uppdrag att göra efter mötet. Ta inte med beslut, information eller sådant som redan är gjort.

Svara endast med en JSON-lista, utan annan text. Varje punkt är ett objekt med fälten:
- "text": vad som ska göras, kort, t.ex. "Skicka kravlistan till Webbyrån".
- "owner": namnet på den som ska göra det, så som det står i transkriptet. Tom sträng om det inte framgår.
- "due": senaste datum som ÅÅÅÅ-MM-DD om ett datum nämns. Räkna om relativa datum ("på fredag", "nästa vecka") utifrån att mötet hölls {{mötesdatum}}. Tom sträng om inget datum nämns.
- "at": tidsstämpeln (mm:ss) för raden där punkten bestämdes.

Finns inga actionpunkter, svara [].

{{ordlista}}

Transkript:
{{transcript}}`

function timestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * The transcript as "[mm:ss] Namn: text" lines, one per speaker turn, so the
 * model can say who took something on and when. Without speakers, one line
 * per segment.
 */
export function timestampedTranscript(transcript: Transcript): string {
  const names = transcript.speakers ?? {}
  const lines: string[] = []
  let current: { speaker?: string; startSec: number; texts: string[] } | null = null
  const flush = (): void => {
    if (!current) return
    const text = current.texts.join(' ').trim()
    if (text) {
      const name = current.speaker ? names[current.speaker] || current.speaker : ''
      lines.push(`[${timestamp(current.startSec)}] ${name ? `${name}: ` : ''}${text}`)
    }
    current = null
  }
  for (const seg of transcript.segments) {
    if (current && (!seg.speaker || seg.speaker !== current.speaker)) flush()
    if (!current) current = { speaker: seg.speaker, startSec: seg.startSec, texts: [] }
    current.texts.push(seg.text)
  }
  flush()
  return lines.length > 0 ? lines.join('\n') : transcript.text
}

/** "fredag 10 oktober 2026 (2026-10-10)", the meeting day the model counts from. */
export function meetingDateText(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'okänt datum'
  const long = date.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  return `${long} (${isoDate(date)})`
}

function isoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/** "mm:ss", "h:mm:ss" or a number of seconds; undefined for anything else. */
function parseAt(value: unknown, durationSec: number): number | undefined {
  let sec: number | undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    sec = value
  } else if (typeof value === 'string' && /^\d{1,2}(:\d{2}){1,2}$/.test(value.trim())) {
    sec = value
      .trim()
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0)
  }
  if (sec === undefined || sec < 0) return undefined
  return durationSec > 0 ? Math.min(Math.round(sec), Math.round(durationSec)) : Math.round(sec)
}

function parseDue(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return ''
  const due = value.trim()
  // Rejects 2026-02-30 and the like, which Date would quietly roll over.
  return isoDate(new Date(`${due}T12:00:00`)) === due ? due : ''
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * The model's answer as action items. Tolerates text or code fences around
 * the list; drops entries without text. Throws when there is no list at all,
 * so a confused answer is reported instead of stored as "no action items".
 */
export function parseActionItems(answer: string, durationSec: number): ActionItem[] {
  const start = answer.indexOf('[')
  const end = answer.lastIndexOf(']')
  const failure = new UserFacingError(
    'Modellen svarade inte med en lista över actionpunkter',
    answer.slice(0, 2000)
  )
  if (start < 0 || end < start) throw failure
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.slice(start, end + 1))
  } catch {
    throw failure
  }
  if (!Array.isArray(parsed)) throw failure
  const items: ActionItem[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const text = clean(raw.text, MAX_TEXT)
    if (!text) continue
    const atSec = parseAt(raw.at, durationSec)
    items.push({
      id: randomUUID(),
      text,
      owner: clean(raw.owner, MAX_OWNER),
      due: parseDue(raw.due),
      ...(atSec !== undefined ? { atSec } : {})
    })
    if (items.length === MAX_ITEMS) break
  }
  return items
}

/**
 * Take the meeting's action items from its transcript and store them,
 * replacing any earlier ones. Rejects when there is no transcript or the
 * model's answer cannot be read.
 */
export async function extractActionItems(meetingId: string): Promise<ActionItem[]> {
  const meta = readMeta(meetingId)
  const transcript = readTranscript(meetingId)
  if (!meta || !transcript) {
    throw new UserFacingError('Transkript saknas — kan inte ta fram actionpunkter')
  }
  const answer = await summarize(timestampedTranscript(transcript), getSummaryConfig(), {
    promptTemplate: ACTION_ITEMS_PROMPT.replace('{{mötesdatum}}', meetingDateText(meta.createdAt)),
    glossary: glossaryPromptBlock(termsForProject(meta.projectId))
  })
  const items = parseActionItems(answer, meta.durationSec)
  writeActionItems(meetingId, items)
  return items
}

/** Whether the pipeline still has to extract this meeting's action items. */
export function needsActionItems(meetingId: string): boolean {
  return readActionItems(meetingId) === undefined
}
