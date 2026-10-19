import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { rmSync } from 'node:fs'
import {
  KEEP_DAYS,
  addDictation,
  clearDictations,
  deleteDictation,
  listDictations
} from './dictationHistory'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-dictations-'))
  return { app: { getPath: (): string => dir } }
})

const userData = app.getPath('userData')
const DAY = 24 * 60 * 60 * 1000

afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

beforeEach(() => clearDictations())

describe('dictation history', () => {
  it('lists the newest dictation first, with the app it went to', () => {
    const t0 = new Date('2026-10-20T08:00:00Z')
    addDictation('Hej Anna', 'Microsoft Outlook', t0)
    addDictation('Klart.', null, new Date(t0.getTime() + 60_000))
    expect(listDictations(t0).map((e) => [e.text, e.app])).toEqual([
      ['Klart.', null],
      ['Hej Anna', 'Microsoft Outlook']
    ])
  })

  it(`forgets dictations older than ${KEEP_DAYS} days`, () => {
    const now = new Date('2026-10-20T08:00:00Z')
    addDictation('gammal', null, new Date(now.getTime() - (KEEP_DAYS + 1) * DAY))
    addDictation('ny', null, now)
    expect(listDictations(now).map((e) => e.text)).toEqual(['ny'])
  })

  it('deletes one dictation or all of them', () => {
    const first = addDictation('ett', null)
    addDictation('två', null)
    deleteDictation(first.id)
    expect(listDictations().map((e) => e.text)).toEqual(['två'])
    clearDictations()
    expect(listDictations()).toEqual([])
  })
})
