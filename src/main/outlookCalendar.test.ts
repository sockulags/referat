import { describe, expect, it } from 'vitest'
import { eventsFromOutlookJson } from './outlookCalendar'

// Shaped like the PowerShell script's ConvertTo-Json output.
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '040000008200E00074C5B7101A82E008000000005B2C',
    entryId: '00000000ABC',
    subject: ' Styrgrupp ',
    start: '2026-10-26T08:00:00.0000000Z',
    end: '2026-10-26T09:00:00.0000000Z',
    recurring: true,
    allDay: false,
    meetingStatus: 3,
    location: 'Microsoft Teams-möte',
    teamsUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
    ...overrides
  }
}

describe('eventsFromOutlookJson', () => {
  it('maps a meeting, keyed by series and start', () => {
    const [event] = eventsFromOutlookJson(JSON.stringify([row()]))
    expect(event).toEqual({
      key: '040000008200E00074C5B7101A82E008000000005B2C|2026-10-26T08:00:00.000Z',
      seriesId: '040000008200E00074C5B7101A82E008000000005B2C',
      subject: 'Styrgrupp',
      start: '2026-10-26T08:00:00.000Z',
      end: '2026-10-26T09:00:00.000Z',
      recurring: true,
      teamsUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
      location: 'Microsoft Teams-möte'
    })
  })

  it('gives occurrences of a series the same series id and their own keys', () => {
    const events = eventsFromOutlookJson(
      JSON.stringify([row(), row({ start: '2026-10-27T08:00:00Z', end: '2026-10-27T09:00:00Z' })])
    )
    expect(new Set(events.map((e) => e.seriesId)).size).toBe(1)
    expect(new Set(events.map((e) => e.key)).size).toBe(2)
  })

  it('reads a single object, which ConvertTo-Json can print for one row', () => {
    expect(eventsFromOutlookJson(JSON.stringify(row()))).toHaveLength(1)
  })

  it('reads empty output as no meetings', () => {
    expect(eventsFromOutlookJson('')).toEqual([])
    expect(eventsFromOutlookJson('[]')).toEqual([])
  })

  it('leaves out all-day events and canceled meetings', () => {
    const json = JSON.stringify([
      row({ allDay: true }),
      row({ meetingStatus: 5 }),
      row({ meetingStatus: 7 })
    ])
    expect(eventsFromOutlookJson(json)).toEqual([])
  })

  it('falls back to the EntryID without a GlobalAppointmentID, and drops rows without times', () => {
    const events = eventsFromOutlookJson(JSON.stringify([row({ id: '' }), row({ start: 'x' })]))
    expect(events).toHaveLength(1)
    expect(events[0].seriesId).toBe('00000000ABC')
  })

  it('keeps only real Teams links', () => {
    const [event] = eventsFromOutlookJson(
      JSON.stringify([row({ teamsUrl: 'javascript:alert(1)' })])
    )
    expect(event.teamsUrl).toBe('')
  })

  it('sorts by start', () => {
    const json = JSON.stringify([
      row({ id: 'B', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z' }),
      row({ id: 'A' })
    ])
    expect(eventsFromOutlookJson(json).map((e) => e.seriesId)).toEqual(['A', 'B'])
  })
})
