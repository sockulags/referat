// The calendar's ticks and the timer that acts on them. Which meetings the
// user ticked lives in userData/calendar.json. While anything is ticked,
// referat rereads Outlook now and then and, when a ticked meeting starts,
// asks the window to record it: named after the meeting, and for a recurring
// series in that series' project. It reminds a minute before a ticked
// meeting starts, and when the meeting of a recording it started is over it
// asks whether to stop, stopping by itself when nobody answers.

import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type {
  CalendarEvent,
  CalendarFetch,
  CalendarRecordingEnd,
  CalendarRecordingEvent,
  CalendarSelection
} from '../shared/types'
import {
  EMPTY_SELECTION,
  END_STOP_GRACE_MS,
  dueEvent,
  endOfMeetingStep,
  remindersDue,
  nextRecording,
  pruneSelection,
  seriesProject,
  withMeetingRecorded,
  withSeriesRecorded
} from '../shared/calendar'
import { writeJsonAtomic } from './jsonFile'
import { createProject, listProjects } from './projects'
import { readOutlookCalendar } from './outlookCalendar'
import { IPC } from './ipc'

const TICK_MS = 15_000
const REFRESH_MS = 10 * 60_000
const UNTITLED = 'Möte från kalendern'
/** How long a calendar recording may take to start before referat stops waiting for it. */
const START_WAIT_MS = 60_000

function selectionPath(): string {
  return join(app.getPath('userData'), 'calendar.json')
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** The saved ticks; a missing or broken file is no ticks at all. */
export function getCalendarSelection(): CalendarSelection {
  try {
    if (!existsSync(selectionPath())) return EMPTY_SELECTION
    const raw = JSON.parse(readFileSync(selectionPath(), 'utf-8')) as Record<string, unknown>
    const projects =
      raw.seriesProjects && typeof raw.seriesProjects === 'object' ? raw.seriesProjects : {}
    return {
      occurrences: strings(raw.occurrences),
      series: strings(raw.series),
      skipped: strings(raw.skipped),
      seriesProjects: Object.fromEntries(
        Object.entries(projects).filter((e): e is [string, string] => typeof e[1] === 'string')
      )
    }
  } catch (err) {
    console.error('Could not read calendar.json, treating it as empty', err)
    return EMPTY_SELECTION
  }
}

/** Tells every window the calendar changed, so the menu's next recording follows. */
function announceChange(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.calendarChanged)
}

function saveSelection(selection: CalendarSelection): CalendarSelection {
  const pruned = pruneSelection(selection, Date.now())
  writeJsonAtomic(selectionPath(), pruned)
  announceChange()
  return pruned
}

export function setCalendarMeetingRecorded(
  event: CalendarEvent,
  recorded: boolean
): CalendarSelection {
  return saveSelection(withMeetingRecorded(getCalendarSelection(), event, recorded))
}

export function setCalendarSeriesRecorded(seriesId: string, recorded: boolean): CalendarSelection {
  return saveSelection(withSeriesRecorded(getCalendarSelection(), seriesId, recorded))
}

/** The last meetings read from Outlook; the timer works from these between reads. */
let known: CalendarEvent[] = []

/** Read Outlook for the calendar view, starting it when it is not running. */
export async function listCalendarEvents(): Promise<CalendarFetch> {
  const result = await readOutlookCalendar(true)
  if (result.status === 'ok') {
    known = result.events
    announceChange()
  }
  return result
}

export function getNextCalendarRecording(): CalendarEvent | null {
  return nextRecording(known, getCalendarSelection(), Date.now()) ?? null
}

/**
 * The recording the calendar started: its meeting, and the recorded meeting's
 * id once the window has started it. Recordings started by hand never get one.
 */
interface CalendarSession {
  event: CalendarEvent
  title: string
  dueAt: number
  meetingId: string | null
  askedAt: number | null
  kept: boolean
}

let session: CalendarSession | null = null

/** The user chose to keep recording after the meeting ended; nothing more is asked. */
export function keepCalendarRecording(): void {
  if (session) session.kept = true
}

function hasTicks(selection: CalendarSelection): boolean {
  return selection.occurrences.length > 0 || selection.series.length > 0
}

/** The project a recurring series records into, made at its first recording. */
function projectFor(event: CalendarEvent, title: string): string {
  if (!event.recurring) return ''
  const selection = getCalendarSelection()
  const target = seriesProject(listProjects(), selection.seriesProjects[event.seriesId], title)
  const id = 'id' in target ? target.id : createProject(target.create).id
  if (selection.seriesProjects[event.seriesId] !== id) {
    saveSelection({
      ...selection,
      seriesProjects: { ...selection.seriesProjects, [event.seriesId]: id }
    })
  }
  return id
}

/**
 * Starts the timer. `onDue` gets a ticked meeting once, when it starts and no
 * other recording is going on. Outlook is reread in the background only while
 * something is ticked, and never started for it.
 */
export function watchCalendar(opts: {
  recording: () => boolean
  activeRecordingIds: () => string[]
  onDue: (e: CalendarRecordingEvent) => void
  onRemind: (event: CalendarEvent) => void
  onEnd: (e: CalendarRecordingEnd) => void
}): () => void {
  if (process.platform !== 'win32') return () => {}
  const handled = new Set<string>()
  const reminded = new Set<string>()
  let lastRead = 0
  let reading = false

  const refresh = async (): Promise<void> => {
    if (reading || !hasTicks(getCalendarSelection())) return
    reading = true
    lastRead = Date.now()
    try {
      const result = await readOutlookCalendar(false)
      // Outlook closed or busy: keep working from the meetings read before.
      if (result.status === 'ok') {
        known = result.events
        announceChange()
      }
    } finally {
      reading = false
    }
  }

  /** Ties the session to the recording the window started, and acts when its meeting is over. */
  const follow = (now: number): void => {
    if (!session) return
    const active = opts.activeRecordingIds()
    if (!session.meetingId) {
      // onDue only fires with nothing recording, so the first recording is the calendar's.
      if (active.length > 0) session.meetingId = active[0]
      else if (now - session.dueAt > START_WAIT_MS) session = null
      return
    }
    if (!active.includes(session.meetingId)) {
      session = null
      return
    }
    const step = endOfMeetingStep(Date.parse(session.event.end), now, session)
    if (step === 'ask') {
      session.askedAt = now
      opts.onEnd({
        state: 'ask',
        title: session.title,
        stopAt: new Date(now + END_STOP_GRACE_MS).toISOString()
      })
    } else if (step === 'stop') {
      // Asked once, stopped once: a stop the window could not carry out is not repeated.
      session.kept = true
      opts.onEnd({ state: 'stop' })
    }
  }

  const tick = (): void => {
    const now = Date.now()
    if (now - lastRead >= REFRESH_MS) void refresh()
    const selection = getCalendarSelection()
    for (const event of remindersDue(known, selection, now, reminded)) {
      reminded.add(event.key)
      opts.onRemind(event)
    }
    follow(now)
    if (opts.recording()) return
    const event = dueEvent(known, selection, now, handled)
    if (!event) return
    handled.add(event.key)
    const title = event.subject || UNTITLED
    try {
      opts.onDue({ title, projectId: projectFor(event, title) })
      session = { event, title, dueAt: now, meetingId: null, askedAt: null, kept: false }
    } catch (err) {
      console.error('Could not start the calendar recording', err)
    }
  }

  const timer = setInterval(tick, TICK_MS)
  return () => clearInterval(timer)
}
