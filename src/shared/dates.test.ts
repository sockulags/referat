import { describe, it, expect } from 'vitest'
import { formatDueDate } from './dates'

const now = new Date(2026, 6, 10, 14, 32) // 10 July 2026, local time

describe('formatDueDate', () => {
  it('shows day and month, and the year only when it differs', () => {
    expect(formatDueDate('2026-10-17', now)).toBe('17 okt')
    expect(formatDueDate('2027-03-05', now)).toBe('5 mars 2027')
  })

  it('is empty for anything that is not a date', () => {
    expect(formatDueDate('', now)).toBe('')
    expect(formatDueDate('fredag', now)).toBe('')
  })
})
