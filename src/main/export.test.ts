import { describe, expect, it, vi } from 'vitest'
import type { ActionItem, MeetingDetail } from '../shared/types'

vi.mock('electron', () => ({ dialog: {}, clipboard: {}, BrowserWindow: {} }))
vi.mock('./storage', () => ({}))

const { actionItemsAsList, actionItemsAsCsv, exportedMarkdown } = await import('./export')

const items: ActionItem[] = [
  { id: 'a1', text: 'Skicka kravlistan', owner: 'Anna', due: '2026-10-17', atSec: 790 },
  { id: 'a2', text: 'Boka workshop; navigation', owner: '', due: '' },
  { id: 'a3', text: '   ', owner: 'Jonas', due: '' }
]

const meeting = {
  id: 'm1',
  title: 'Styrgrupp "intranät"',
  createdAt: '2026-10-10T08:00:00.000Z'
} as MeetingDetail

describe('actionItemsAsList', () => {
  it('writes one line per item with owner and date when there are any', () => {
    expect(actionItemsAsList(items, new Date(2026, 9, 17))).toBe(
      '- Skicka kravlistan — Anna (senast 17 okt)\n- Boka workshop; navigation'
    )
  })
})

describe('exportedMarkdown', () => {
  const now = new Date(2026, 9, 17)
  const summary = {
    id: 's1',
    fileName: 'protocol.md',
    templateId: 'protokoll',
    templateName: 'Protokoll',
    focus: '',
    createdAt: '',
    markdown: '## Sammanfattning\n\nText.\n'
  }
  const withItems = { ...meeting, actionItems: items }

  it('adds the corrected action items to the protocol under their own heading', () => {
    expect(exportedMarkdown(withItems, summary, now)).toBe(
      '## Sammanfattning\n\nText.\n\n## Actionpunkter\n\n' +
        '- Skicka kravlistan — Anna (senast 17 okt)\n- Boka workshop; navigation\n'
    )
  })

  it('leaves a protocol that already has the heading as it is', () => {
    const old = { ...summary, markdown: '## Actionpunkter\n\n- Gammal punkt' }
    expect(exportedMarkdown(withItems, old, now)).toBe(old.markdown)
  })

  it('leaves other templates and meetings without items as they are', () => {
    expect(exportedMarkdown(withItems, { ...summary, templateId: 'uppfoljningsmejl' }, now)).toBe(
      summary.markdown
    )
    expect(exportedMarkdown({ ...meeting, actionItems: [] }, summary, now)).toBe(summary.markdown)
  })
})

describe('actionItemsAsCsv', () => {
  it('writes a header and one row per item, quoting what needs it', () => {
    const csv = actionItemsAsCsv(items, meeting)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Uppgift;Ansvarig;Senast;Möte;Mötesdatum;Sades vid',
      'Skicka kravlistan;Anna;2026-10-17;"Styrgrupp ""intranät""";2026-10-10;13:10',
      '"Boka workshop; navigation";;;"Styrgrupp ""intranät""";2026-10-10;',
      ''
    ])
  })
})
