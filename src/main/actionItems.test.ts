import { describe, expect, it, vi } from 'vitest'
import type { Transcript } from '../shared/types'

// Only the pure helpers are tested here; extraction itself runs through the
// pipeline, whose test replaces this module.
vi.mock('./storage', () => ({}))
vi.mock('./settings', () => ({}))
vi.mock('./glossary', () => ({}))
vi.mock('./providers/summary', () => ({}))

const { parseActionItems, timestampedTranscript, meetingDateText, sanitizeActionItems } =
  await import('./actionItems')

describe('parseActionItems', () => {
  it('reads the list from an answer with text and code fences around it', () => {
    const answer =
      'Här är punkterna:\n```json\n[{"text":"Skicka kravlistan","owner":"Anna","due":"2026-10-17","at":"13:10"}]\n```'
    const [item] = parseActionItems(answer, 2528)
    expect(item).toMatchObject({
      text: 'Skicka kravlistan',
      owner: 'Anna',
      due: '2026-10-17',
      atSec: 790
    })
    expect(item.id).toEqual(expect.any(String))
  })

  it('is an empty list when the meeting had no action items', () => {
    expect(parseActionItems('[]', 60)).toEqual([])
  })

  it('rejects an answer without a list instead of storing "none"', () => {
    expect(() => parseActionItems('Inga actionpunkter.', 60)).toThrow(/lista/)
    expect(() => parseActionItems('[{"text": "trasig"', 60)).toThrow(/lista/)
  })

  it('drops entries without text and cleans the rest', () => {
    const items = parseActionItems(
      JSON.stringify([
        { text: '   ', owner: 'Anna' },
        'ingen punkt',
        { text: '  Boka\n workshop  ', owner: 42, due: 'fredag', at: 'snart' }
      ]),
      60
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: 'Boka workshop', owner: '', due: '' })
    expect(items[0].atSec).toBeUndefined()
  })

  it('accepts real dates only', () => {
    const items = parseActionItems(
      JSON.stringify([
        { text: 'a', due: '2026-02-28' },
        { text: 'b', due: '2026-02-30' }
      ]),
      60
    )
    expect(items.map((i) => i.due)).toEqual(['2026-02-28', ''])
  })

  it('reads h:mm:ss and seconds, and keeps times inside the recording', () => {
    const items = parseActionItems(
      JSON.stringify([
        { text: 'a', at: '1:02:03' },
        { text: 'b', at: 75 },
        { text: 'c', at: '99:00' }
      ]),
      3600
    )
    expect(items.map((i) => i.atSec)).toEqual([3600, 75, 3600])
  })

  it('caps a runaway list', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ text: `punkt ${i}` }))
    expect(parseActionItems(JSON.stringify(many), 60)).toHaveLength(50)
  })
})

describe('sanitizeActionItems', () => {
  it('keeps what the user typed, including an item still without text', () => {
    const items = [
      { id: 'a1', text: 'Skicka kravlistan', owner: 'Anna', due: '2026-10-17', atSec: 790 },
      { id: 'a2', text: '', owner: '', due: '' }
    ]
    expect(sanitizeActionItems(items)).toEqual(items)
  })

  it('cleans what it cannot trust and drops what is not an item', () => {
    const [item, ...rest] = sanitizeActionItems([
      { text: 'Boka workshop', owner: '  Jonas  ', due: '2026-02-30', atSec: -3 },
      'inte en punkt',
      null
    ])
    expect(rest).toEqual([])
    expect(item).toMatchObject({ text: 'Boka workshop', owner: 'Jonas', due: '' })
    expect(item.id).toEqual(expect.any(String))
    expect(item.atSec).toBeUndefined()
  })

  it('is empty for anything that is not a list', () => {
    expect(sanitizeActionItems({ text: 'x' })).toEqual([])
  })
})

describe('timestampedTranscript', () => {
  it('writes one line per speaker turn with the turn start time and name', () => {
    const transcript: Transcript = {
      language: 'sv',
      text: '',
      speakers: { S1: 'Maria Lind' },
      segments: [
        { startSec: 742, endSec: 750, text: 'Då återstår upphandlingen.', speaker: 'S1' },
        { startSec: 750, endSec: 755, text: 'Vi kör ett avrop.', speaker: 'S1' },
        { startSec: 790, endSec: 800, text: 'Jag skickar kravlistan.', speaker: 'S2' }
      ]
    }
    expect(timestampedTranscript(transcript)).toBe(
      '[12:22] Maria Lind: Då återstår upphandlingen. Vi kör ett avrop.\n[13:10] S2: Jag skickar kravlistan.'
    )
  })

  it('writes one line per segment without speakers', () => {
    const transcript: Transcript = {
      language: 'sv',
      text: 'hej då',
      segments: [
        { startSec: 0, endSec: 2, text: 'hej' },
        { startSec: 3725, endSec: 3726, text: 'då' }
      ]
    }
    expect(timestampedTranscript(transcript)).toBe('[0:00] hej\n[1:02:05] då')
  })
})

describe('meetingDateText', () => {
  it('names the weekday and gives the ISO date to count from', () => {
    expect(meetingDateText('2026-10-10T08:00:00')).toBe('lördag 10 oktober 2026 (2026-10-10)')
  })
})
