import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarSelection, Project } from './types'
import {
  EMPTY_SELECTION,
  START_GRACE_MS,
  END_STOP_GRACE_MS,
  REMINDER_LEAD_MS,
  endOfMeetingStep,
  remindersDue,
  dueEvent,
  eventKey,
  calendarRows,
  isRecorded,
  nextRecording,
  pruneSelection,
  seriesProject,
  withMeetingRecorded,
  withSeriesRecorded
} from './calendar'

function meeting(
  seriesId: string,
  start: string,
  opts: Partial<CalendarEvent> = {}
): CalendarEvent {
  const end = new Date(Date.parse(start) + 60 * 60_000).toISOString()
  return {
    key: eventKey(seriesId, start),
    seriesId,
    subject: 'Styrgrupp',
    start,
    end,
    recurring: false,
    teamsUrl: '',
    location: '',
    ...opts
  }
}

const mon = meeting('S', '2026-10-26T08:00:00.000Z', { recurring: true })
const tue = meeting('S', '2026-10-27T08:00:00.000Z', { recurring: true })
const single = meeting('X', '2026-10-26T12:00:00.000Z')

describe('ticking meetings', () => {
  it('records nothing until something is ticked', () => {
    expect(isRecorded(single, EMPTY_SELECTION)).toBe(false)
  })

  it('ticks and unticks one meeting', () => {
    const on = withMeetingRecorded(EMPTY_SELECTION, single, true)
    expect(isRecorded(single, on)).toBe(true)
    expect(isRecorded(single, withMeetingRecorded(on, single, false))).toBe(false)
  })

  it('a ticked series covers every occurrence', () => {
    const sel = withSeriesRecorded(EMPTY_SELECTION, 'S', true)
    expect(isRecorded(mon, sel)).toBe(true)
    expect(isRecorded(tue, sel)).toBe(true)
  })

  it('unticking one meeting of a ticked series skips only that one, and ticking it brings it back', () => {
    const sel = withMeetingRecorded(withSeriesRecorded(EMPTY_SELECTION, 'S', true), mon, false)
    expect(isRecorded(mon, sel)).toBe(false)
    expect(isRecorded(tue, sel)).toBe(true)
    expect(isRecorded(mon, withMeetingRecorded(sel, mon, true))).toBe(true)
  })

  it('ticking or unticking a series forgets the one-by-one ticks in it', () => {
    let sel = withMeetingRecorded(EMPTY_SELECTION, mon, true)
    sel = withMeetingRecorded(sel, single, true)
    sel = withSeriesRecorded(sel, 'S', true)
    sel = withMeetingRecorded(sel, tue, false)
    const off = withSeriesRecorded(sel, 'S', false)
    expect(off.occurrences).toEqual([single.key])
    expect(off.skipped).toEqual([])
    expect(isRecorded(mon, off)).toBe(false)
  })

  it('a series tick does not apply to a non-recurring meeting that shares the id', () => {
    const sel = withSeriesRecorded(EMPTY_SELECTION, 'X', true)
    expect(isRecorded(single, sel)).toBe(false)
  })

  it('keeps the series project when the series is unticked', () => {
    const sel: CalendarSelection = { ...EMPTY_SELECTION, series: ['S'], seriesProjects: { S: 'p' } }
    expect(withSeriesRecorded(sel, 'S', false).seriesProjects).toEqual({ S: 'p' })
  })

  it('forgets ticks of meetings more than two days old', () => {
    const sel = { ...EMPTY_SELECTION, occurrences: [mon.key, tue.key], skipped: [mon.key] }
    const pruned = pruneSelection(sel, Date.parse('2026-10-29T00:00:00Z'))
    expect(pruned.occurrences).toEqual([tue.key])
    expect(pruned.skipped).toEqual([])
  })
})

describe('dueEvent', () => {
  const sel = withMeetingRecorded(EMPTY_SELECTION, single, true)
  const start = Date.parse(single.start)

  it('is nothing before a ticked meeting starts', () => {
    expect(dueEvent([single], sel, start - 1000, new Set())).toBeUndefined()
  })

  it('is the meeting from its start time', () => {
    expect(dueEvent([single], sel, start, new Set())).toBe(single)
  })

  it('stops offering it once the grace period has passed', () => {
    expect(dueEvent([single], sel, start + START_GRACE_MS - 1, new Set())).toBe(single)
    expect(dueEvent([single], sel, start + START_GRACE_MS, new Set())).toBeUndefined()
  })

  it('never offers a meeting that is over, even inside the grace period', () => {
    const short = meeting('Y', single.start, { end: new Date(start + 5 * 60_000).toISOString() })
    const s = withMeetingRecorded(EMPTY_SELECTION, short, true)
    expect(dueEvent([short], s, start + 5 * 60_000, new Set())).toBeUndefined()
  })

  it('offers a meeting once', () => {
    expect(dueEvent([single], sel, start, new Set([single.key]))).toBeUndefined()
  })

  it('ignores meetings that are not ticked and takes the earliest of overlapping ones', () => {
    const early = meeting('E', new Date(start - 60_000).toISOString())
    const both = withMeetingRecorded(sel, early, true)
    const other = meeting('O', single.start)
    expect(dueEvent([single, other, early], both, start, new Set())).toBe(early)
    expect(dueEvent([other], both, start, new Set())).toBeUndefined()
  })
})

describe('nextRecording', () => {
  const sel = withMeetingRecorded(withMeetingRecorded(EMPTY_SELECTION, single, true), tue, true)
  const start = Date.parse(single.start)

  it('is the soonest recorded meeting ahead, ignoring the others', () => {
    expect(nextRecording([tue, mon, single], sel, start - 60_000)).toBe(single)
  })

  it('keeps a meeting that just started, then moves on', () => {
    expect(nextRecording([tue, single], sel, start + START_GRACE_MS - 1)).toBe(single)
    expect(nextRecording([tue, single], sel, start + START_GRACE_MS)).toBe(tue)
  })

  it('is nothing when nothing ahead is recorded', () => {
    expect(nextRecording([mon], sel, start)).toBeUndefined()
  })
})

describe('remindersDue', () => {
  const sel = withSeriesRecorded(withMeetingRecorded(EMPTY_SELECTION, single, true), 'S', true)
  const start = Date.parse(single.start)

  it('reminds a minute before a recorded meeting starts, not earlier', () => {
    expect(remindersDue([single], sel, start - REMINDER_LEAD_MS - 1, new Set())).toEqual([])
    expect(remindersDue([single], sel, start - REMINDER_LEAD_MS, new Set())).toEqual([single])
    expect(remindersDue([single], sel, start - 1, new Set())).toEqual([single])
  })

  it('does not remind once the meeting has started', () => {
    expect(remindersDue([single], sel, start, new Set())).toEqual([])
  })

  it('reminds once per occurrence', () => {
    expect(remindersDue([single], sel, start - 1000, new Set([single.key]))).toEqual([])
  })

  it('leaves out meetings that are not recorded or are skipped', () => {
    const other = meeting('O', single.start)
    expect(remindersDue([other], sel, start - 1000, new Set())).toEqual([])
    const skipped = withMeetingRecorded(sel, mon, false)
    const monStart = Date.parse(mon.start)
    expect(remindersDue([mon], skipped, monStart - 1000, new Set())).toEqual([])
    expect(remindersDue([mon], sel, monStart - 1000, new Set())).toEqual([mon])
  })
})

describe('endOfMeetingStep', () => {
  const end = Date.parse('2026-10-26T09:00:00Z')
  const fresh = { askedAt: null, kept: false }

  it('waits until the meeting ends, then asks', () => {
    expect(endOfMeetingStep(end, end - 1, fresh)).toBe('wait')
    expect(endOfMeetingStep(end, end, fresh)).toBe('ask')
  })

  it('stops when nobody answered within the grace period after asking', () => {
    const asked = { askedAt: end + 30_000, kept: false }
    expect(endOfMeetingStep(end, end + 30_000 + END_STOP_GRACE_MS - 1, asked)).toBe('wait')
    expect(endOfMeetingStep(end, end + 30_000 + END_STOP_GRACE_MS, asked)).toBe('stop')
  })

  it('asks first even when it notices the end late', () => {
    expect(endOfMeetingStep(end, end + 60 * 60_000, fresh)).toBe('ask')
  })

  it('does nothing more once the user chose to keep recording', () => {
    expect(endOfMeetingStep(end, end + 60 * 60_000, { askedAt: end, kept: true })).toBe('wait')
  })
})

describe('seriesProject', () => {
  const projects: Project[] = [
    { id: 'p1', name: 'Styrgrupp', defaultTemplateId: '', description: '', createdAt: '' }
  ]

  it('uses the project made for the series while it exists', () => {
    const own = { ...projects[0], id: 'own', name: 'Omdöpt' }
    expect(seriesProject([...projects, own], 'own', 'Styrgrupp')).toEqual({ id: 'own' })
  })

  it('falls back to a project with the series name, ignoring case', () => {
    expect(seriesProject(projects, 'deleted', ' styrgrupp ')).toEqual({ id: 'p1' })
  })

  it('creates a project named after the series otherwise', () => {
    expect(seriesProject(projects, undefined, 'Veckomöte')).toEqual({ create: 'Veckomöte' })
  })
})

describe('calendarRows', () => {
  const now = Date.parse('2026-10-26T07:00:00Z')
  const wed = meeting('S', '2026-10-28T08:00:00.000Z', { recurring: true })
  const past = meeting('P', '2026-10-25T08:00:00.000Z')
  const later = meeting('L', '2026-10-29T08:00:00.000Z')
  const events = [later, tue, wed, past, single, mon]

  it('shows a series once, by its next occurrence, and leaves out what is over, soonest first', () => {
    const { recorded, other } = calendarRows(events, EMPTY_SELECTION, now)
    expect(recorded).toEqual([])
    expect(other.map((r) => [r.kind, r.event.key])).toEqual([
      ['series', mon.key],
      ['single', single.key],
      ['single', later.key]
    ])
  })

  it('moves recorded meetings and series to their own list', () => {
    let sel = withSeriesRecorded(EMPTY_SELECTION, 'S', true)
    sel = withMeetingRecorded(sel, later, true)
    const { recorded, other } = calendarRows(events, sel, now)
    expect(recorded.map((r) => r.event.key)).toEqual([mon.key, later.key])
    expect(other.map((r) => r.event.key)).toEqual([single.key])
  })

  it('shows a recorded series by its next occurrence that is not skipped', () => {
    const sel = withMeetingRecorded(withSeriesRecorded(EMPTY_SELECTION, 'S', true), mon, false)
    const [row] = calendarRows(events, sel, now).recorded
    expect(row.event.key).toBe(tue.key)
    expect(row.skipped).toEqual([mon.key])
  })

  it('keeps a recorded series listed when every occurrence in view is skipped', () => {
    let sel = withSeriesRecorded(EMPTY_SELECTION, 'S', true)
    for (const e of [mon, tue, wed]) sel = withMeetingRecorded(sel, e, false)
    const [row] = calendarRows(events, sel, now).recorded
    expect(row.kind).toBe('series')
    expect(row.skipped).toHaveLength(3)
  })

  it('lists an occurrence ticked on its own next to its unrecorded series', () => {
    const sel = withMeetingRecorded(EMPTY_SELECTION, tue, true)
    const { recorded, other } = calendarRows(events, sel, now)
    expect(recorded.map((r) => [r.kind, r.event.key])).toEqual([['single', tue.key]])
    expect(other[0]).toMatchObject({ kind: 'series', event: mon })
  })
})
