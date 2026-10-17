// Swedish date/time and duration formatting helpers.

const MONTHS = [
  'jan',
  'feb',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec'
]

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** "idag 14:32", "igår 09:05", "3 juli", "3 juli 2024". */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000)

  if (dayDiff === 0) return `idag ${time}`
  if (dayDiff === 1) return `igår ${time}`

  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`
}

/** "YYYY-MM-DD" → "17 okt", with the year when it is not this year. '' for anything else. */
export function formatDueDate(date: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return ''
  const year = Number(m[1])
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim()
  return year === now.getFullYear() ? day : `${day} ${year}`
}

/** Seconds → "mm:ss" or "h:mm:ss" with tabular alignment in mind. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}

/** Seconds → "mm:ss" always, for transcript timestamps. */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}
