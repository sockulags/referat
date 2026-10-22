// How the calendar names a meeting's time: "idag 09:00", "tor 23 okt 09:00".

import { localDay } from '../../shared/calendar'
import { MONTHS_SHORT } from '../../shared/dates'
import { strings } from './strings'

const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör']

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

/** "idag 09:00", "imorgon 09:00" or "tor 23 okt 09:00". */
export function when(iso: string, now: Date): string {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const day = localDay(iso)
  const d = new Date(iso)
  const label =
    day === localDay(now.toISOString())
      ? strings.calendar.today
      : day === localDay(tomorrow.toISOString())
        ? strings.calendar.tomorrow
        : `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  return `${label} ${clock(iso)}`
}
