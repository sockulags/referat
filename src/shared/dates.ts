// Swedish date words shared by the meeting view and the exports.

export const MONTHS_SHORT = [
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

/** "YYYY-MM-DD" → "17 okt", with the year when it is not this year. '' for anything else. */
export function formatDueDate(date: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return ''
  const year = Number(m[1])
  const day = `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1] ?? ''}`.trim()
  return year === now.getFullYear() ? day : `${day} ${year}`
}
