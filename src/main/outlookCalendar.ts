// Reads the coming days' meetings from classic Outlook through its COM object
// model, the way Outlook add-ins do. Nothing to sign in to and nothing for IT
// to approve: Outlook is already signed in. Windows PowerShell does the COM
// part, so referat needs no native module. The new Outlook has no COM; there
// this reports 'unavailable'.

import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import type { CalendarEvent, CalendarFetch } from '../shared/types'
import { eventKey } from '../shared/calendar'

/** How many days ahead the calendar view and the scheduler look. */
export const CALENDAR_DAYS = 7

const TEAMS_URL_PROP =
  'http://schemas.microsoft.com/mapi/string/{00020329-0000-0000-C000-000000000046}/SkypeTeamsMeetingUrl'

/**
 * Prints the default calendar's meetings from today to `days` ahead as JSON,
 * recurring ones expanded into occurrences. With $launch false it only talks
 * to an Outlook that is already running. Exit code 3: no classic Outlook.
 * Body and recipients are never read; those trigger Outlook's security prompt.
 */
function script(days: number, launch: boolean): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
} catch {
  if (-not $${launch}) { exit 3 }
  try { $ol = New-Object -ComObject Outlook.Application } catch { exit 3 }
}
$items = $ol.GetNamespace('MAPI').GetDefaultFolder(9).Items
$items.Sort('[Start]')
$items.IncludeRecurrences = $true
$from = (Get-Date).Date
$to = $from.AddDays(${days})
$filter = "[Start] < '" + $to.ToString('g') + "' AND [End] > '" + $from.ToString('g') + "'"
$out = New-Object System.Collections.ArrayList
foreach ($a in $items.Restrict($filter)) {
  if ($out.Count -ge 500) { break }
  $teams = ''
  try { $teams = [string]$a.PropertyAccessor.GetProperty('${TEAMS_URL_PROP}') } catch {}
  [void]$out.Add([ordered]@{
    id = [string]$a.GlobalAppointmentID
    entryId = [string]$a.EntryID
    subject = [string]$a.Subject
    start = $a.Start.ToUniversalTime().ToString('o')
    end = $a.End.ToUniversalTime().ToString('o')
    recurring = [bool]$a.IsRecurring
    allDay = [bool]$a.AllDayEvent
    meetingStatus = [int]$a.MeetingStatus
    location = [string]$a.Location
    teamsUrl = $teams
  })
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
`
}

/** Outlook's OlMeetingStatus values for a meeting the organizer called off. */
const CANCELED = new Set([5, 7])

/** A COM date is to the second; trim .0000000 so keys stay the same across reads. */
function isoSeconds(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(Math.floor(ms / 1000) * 1000).toISOString()
}

/**
 * The script's JSON as calendar events, in start order. Leaves out all-day
 * events (no meeting to record) and canceled meetings. Rows with no usable
 * times are dropped; a missing GlobalAppointmentID falls back to the EntryID.
 */
export function eventsFromOutlookJson(json: string): CalendarEvent[] {
  const parsed = JSON.parse(json.trim() || '[]') as unknown
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[]
  const events: CalendarEvent[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.allDay === true || CANCELED.has(Number(row.meetingStatus))) continue
    const start = isoSeconds(row.start)
    const end = isoSeconds(row.end)
    const seriesId = String(row.id || row.entryId || '')
    if (!start || !end || !seriesId) continue
    events.push({
      key: eventKey(seriesId, start),
      seriesId,
      subject: String(row.subject ?? '').trim(),
      start,
      end,
      recurring: row.recurring === true,
      teamsUrl: /^https:\/\/teams\.microsoft\.com\//.test(String(row.teamsUrl ?? ''))
        ? String(row.teamsUrl)
        : '',
      location: String(row.location ?? '').trim()
    })
  }
  return events.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * The coming days' meetings. `launch` lets the read start Outlook when it is
 * not running; the background scheduler passes false so it never does.
 */
export function readOutlookCalendar(launch: boolean): Promise<CalendarFetch> {
  // REFERAT_CALENDAR_FIXTURE: a JSON file shaped like the script's output,
  // read instead of Outlook, to try the calendar on a machine without it.
  const fixture = process.env.REFERAT_CALENDAR_FIXTURE?.trim()
  if (fixture) {
    try {
      return Promise.resolve({
        status: 'ok',
        events: eventsFromOutlookJson(readFileSync(fixture, 'utf-8'))
      })
    } catch (err) {
      return Promise.resolve({ status: 'error', message: String(err) })
    }
  }
  if (process.platform !== 'win32') return Promise.resolve({ status: 'unavailable' })
  const command = Buffer.from(script(CALENDAR_DAYS, launch), 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', command],
      { windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as { code?: unknown }).code
          if (code === 3) return resolve({ status: 'unavailable' })
          return resolve({ status: 'error', message: (stderr || err.message).trim() })
        }
        try {
          resolve({ status: 'ok', events: eventsFromOutlookJson(stdout) })
        } catch (parseErr) {
          resolve({ status: 'error', message: String(parseErr) })
        }
      }
    )
  })
}
