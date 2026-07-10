import { describe, it, expect } from 'vitest'
import { formatRelativeDate, formatDuration, formatTimestamp } from './format'

// A fixed "now" in local time so relative-date output is deterministic.
const now = new Date(2026, 6, 10, 14, 32) // 10 July 2026, 14:32 local

describe('formatRelativeDate', () => {
  it('shows "idag HH:MM" for the same day', () => {
    const iso = new Date(2026, 6, 10, 14, 32).toISOString()
    expect(formatRelativeDate(iso, now)).toBe('idag 14:32')
  })

  it('shows "igår HH:MM" for the previous day and zero-pads', () => {
    const iso = new Date(2026, 6, 9, 9, 5).toISOString()
    expect(formatRelativeDate(iso, now)).toBe('igår 09:05')
  })

  it('shows "D månad" earlier in the same year', () => {
    const iso = new Date(2026, 6, 3, 10, 0).toISOString()
    expect(formatRelativeDate(iso, now)).toBe('3 juli')
  })

  it('appends the year when it differs from now', () => {
    const iso = new Date(2024, 6, 3, 10, 0).toISOString()
    expect(formatRelativeDate(iso, now)).toBe('3 juli 2024')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeDate('not-a-date', now)).toBe('')
  })
})

describe('formatDuration', () => {
  it('formats mm:ss under an hour', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(599)).toBe('09:59')
  })

  it('formats h:mm:ss at or above an hour', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(3600)).toBe('1:00:00')
  })

  it('clamps negatives and floors fractional seconds', () => {
    expect(formatDuration(-5)).toBe('00:00')
    expect(formatDuration(65.9)).toBe('01:05')
  })
})

describe('formatTimestamp', () => {
  it('always renders mm:ss', () => {
    expect(formatTimestamp(5)).toBe('00:05')
    expect(formatTimestamp(125)).toBe('02:05')
    expect(formatTimestamp(-1)).toBe('00:00')
  })
})
