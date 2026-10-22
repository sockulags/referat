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

/** Events grouped by the local day they start, days and events in time order. */
export function groupByDay(events: CalendarEvent[]): { day: string; events: CalendarEvent[] }[] {
  const days = new Map<string, CalendarEvent[]>()
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = localDay(e.start)
    days.set(day, [...(days.get(day) ?? []), e])
  }
  return [...days].map(([day, list]) => ({ day, events: list }))
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
