import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarSelection, Project } from './types'
import {
  EMPTY_SELECTION,
  START_GRACE_MS,
  dueEvent,
  eventKey,
  groupByDay,
  isRecorded,
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

describe('groupByDay', () => {
  it('groups by local start day in time order', () => {
    const groups = groupByDay([tue, single, mon])
    expect(groups.map((g) => g.events)).toEqual([[mon, single], [tue]])
  })
})
