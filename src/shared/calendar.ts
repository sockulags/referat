// Which calendar meetings referat records by itself, and when. Pure, so main
// (which starts the recordings) and the calendar view agree on every tick.

import type { CalendarEvent, CalendarSelection, Project } from './types'

/** How long after a ticked meeting's start referat still starts recording it. */
export const START_GRACE_MS = 10 * 60 * 1000

/** Ticks older than this are forgotten, so the file does not grow forever. */
const KEEP_PAST_MS = 2 * 24 * 60 * 60 * 1000

export const EMPTY_SELECTION: CalendarSelection = {
  occurrences: [],
  series: [],
  skipped: [],
  seriesProjects: {}
}

/** An occurrence is a series at a start time; a moved meeting gets a new key. */
export function eventKey(seriesId: string, start: string): string {
  return `${seriesId}|${start}`
}

function seriesOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf('|'))
}

function startOfKey(key: string): number {
  return Date.parse(key.slice(key.lastIndexOf('|') + 1))
}

export function isRecorded(event: CalendarEvent, selection: CalendarSelection): boolean {
  if (selection.skipped.includes(event.key)) return false
  if (event.recurring && selection.series.includes(event.seriesId)) return true
  return selection.occurrences.includes(event.key)
}

/** Tick or untick one meeting. Unticking one meeting of a ticked series skips just that one. */
export function withMeetingRecorded(
  selection: CalendarSelection,
  event: CalendarEvent,
  recorded: boolean
): CalendarSelection {
  const inSeries = event.recurring && selection.series.includes(event.seriesId)
  const occurrences = selection.occurrences.filter((k) => k !== event.key)
  const skipped = selection.skipped.filter((k) => k !== event.key)
  if (recorded && !inSeries) occurrences.push(event.key)
  if (!recorded && inSeries) skipped.push(event.key)
  return { ...selection, occurrences, skipped }
}

/**
 * Tick or untick a whole series. Either way the meetings ticked or skipped one
 * by one before are forgotten: the series' tick is what counts from now on.
 * The series keeps its project, so ticking it again records into the same one.
 */
export function withSeriesRecorded(
  selection: CalendarSelection,
  seriesId: string,
  recorded: boolean
): CalendarSelection {
  const other = (k: string): boolean => seriesOfKey(k) !== seriesId
  const series = selection.series.filter((id) => id !== seriesId)
  if (recorded) series.push(seriesId)
  return {
    ...selection,
    series,
    occurrences: selection.occurrences.filter(other),
    skipped: selection.skipped.filter(other)
  }
}

/** Drops ticks of meetings that are long over. Series ticks stay. */
export function pruneSelection(selection: CalendarSelection, now: number): CalendarSelection {
  const recent = (k: string): boolean => !(startOfKey(k) < now - KEEP_PAST_MS)
  return {
    ...selection,
    occurrences: selection.occurrences.filter(recent),
    skipped: selection.skipped.filter(recent)
  }
}

/**
 * The ticked meeting to start recording now, if any: one that has started,
 * at most START_GRACE_MS ago and is not over, and was not already started
 * (`handled`). The earliest wins when two overlap.
 */
export function dueEvent(
  events: CalendarEvent[],
  selection: CalendarSelection,
  now: number,
  handled: ReadonlySet<string>
): CalendarEvent | undefined {
  return events
    .filter((e) => {
      const start = Date.parse(e.start)
      const end = Date.parse(e.end)
      return (
        isRecorded(e, selection) &&
        !handled.has(e.key) &&
        start <= now &&
        now < Math.min(end, start + START_GRACE_MS)
      )
    })
    .sort((a, b) => a.start.localeCompare(b.start))[0]
}

/** The local calendar day of an ISO time, "YYYY-MM-DD". */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * One row of the calendar view: a single meeting, or a recurring series shown
 * by its next occurrence (for a recorded series, the next one not skipped).
 */
export interface CalendarRow {
  kind: 'single' | 'series'
  event: CalendarEvent
  recorded: boolean
  /** Occurrences of a recorded series the user skipped, still ahead. */
  skipped: string[]
}

/**
 * The view's two lists, soonest first: what referat will record, and the
 * other meetings. Meetings that are over are left out. A recurring series is
 * one row, and a recorded one stays among the recorded even with every
 * occurrence in view skipped. An occurrence ticked on its own (outside a recorded series) gets a
 * row of its own among the recorded ones.
 */
export function calendarRows(
  events: CalendarEvent[],
  selection: CalendarSelection,
  now: number
): { recorded: CalendarRow[]; other: CalendarRow[] } {
  const ahead = events
    .filter((e) => Date.parse(e.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
  const rows: CalendarRow[] = []
  const series = new Map<string, CalendarEvent[]>()
  for (const e of ahead) {
    if (!e.recurring) {
      rows.push({ kind: 'single', event: e, recorded: isRecorded(e, selection), skipped: [] })
    } else {
      series.set(e.seriesId, [...(series.get(e.seriesId) ?? []), e])
    }
  }
  for (const [id, list] of series) {
    if (selection.series.includes(id)) {
      const skipped = list.filter((e) => selection.skipped.includes(e.key)).map((e) => e.key)
      const next = list.find((e) => !skipped.includes(e.key))
      rows.push({ kind: 'series', event: next ?? list[0], recorded: true, skipped })
      continue
    }
    for (const e of list.filter((o) => selection.occurrences.includes(o.key))) {
      rows.push({ kind: 'single', event: e, recorded: true, skipped: [] })
    }
    rows.push({ kind: 'series', event: list[0], recorded: false, skipped: [] })
  }
  rows.sort((a, b) => a.event.start.localeCompare(b.event.start))
  return { recorded: rows.filter((r) => r.recorded), other: rows.filter((r) => !r.recorded) }
}

/**
 * Where a recurring series' recordings go: the project referat made for it
 * when it still exists, else a project with the series' name, else a new one.
 */
export function seriesProject(
  projects: Project[],
  rememberedId: string | undefined,
  subject: string
): { id: string } | { create: string } {
  if (rememberedId && projects.some((p) => p.id === rememberedId)) return { id: rememberedId }
  const name = subject.trim()
  const named = projects.find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
  return named ? { id: named.id } : { create: name }
}
