import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingMeta, MeetingSummary, Transcript } from '../shared/types'

const DAY = 86_400_000
const now = Date.parse('2026-10-18T12:00:00Z')

let metas: MeetingMeta[] = []
const transcripts = new Map<string, Transcript>()
const summaries = new Map<string, MeetingSummary[]>()
const stamps = new Map<string, string>()
const readTranscript = vi.fn((id: string) => transcripts.get(id))

vi.mock('./storage', () => ({
  listMeetings: () => metas,
  readTranscript: (id: string) => readTranscript(id),
  listSummaries: (id: string) => summaries.get(id) ?? [],
  textStamp: (id: string) => stamps.get(id) ?? '1'
}))

const { searchMeetings } = await import('./search')

function meeting(id: string, daysAgo: number, projectId?: string): MeetingMeta {
  return {
    id,
    title: `Möte ${id}`,
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
    durationSec: 60,
    status: 'done',
    ...(projectId ? { projectId } : {})
  }
}

const all = { projectId: 'all', sinceDays: null }

beforeEach(() => {
  metas = [meeting('m1', 1, 'p1'), meeting('m2', 100)]
  transcripts.clear()
  summaries.clear()
  stamps.clear()
  readTranscript.mockClear()
  transcripts.set('m1', {
    language: 'sv',
    text: '',
    speakers: { S1: 'Maria Lind' },
    segments: [
      { startSec: 742, endSec: 750, text: 'Vi kör ett avrop på ramavtalet.', speaker: 'S1' },
      { startSec: 790, endSec: 800, text: 'Jag skickar KRAVLISTAN på fredag.' }
    ]
  })
  transcripts.set('m2', {
    language: 'sv',
    text: '',
    segments: [{ startSec: 5, endSec: 9, text: 'Kravlistan är försenad.' }]
  })
  summaries.set('m1', [
    {
      id: 's1',
      fileName: 'protocol.md',
      templateId: 'protokoll',
      templateName: 'Protokoll',
      focus: '',
      createdAt: '',
      markdown: '## Beslut\n\n- **Avrop** på ramavtalet.'
    }
  ])
})

describe('searchMeetings', () => {
  it('finds every word in any order and case, newest meeting first', () => {
    const results = searchMeetings('kravlistan', all, now)
    expect(results.map((r) => r.meetingId)).toEqual(['m1', 'm2'])
    expect(results[0].hits).toEqual([
      { kind: 'transcript', startSec: 790, text: 'Jag skickar KRAVLISTAN på fredag.' }
    ])
    expect(searchMeetings('fredag kravlistan', all, now)).toHaveLength(1)
    expect(searchMeetings('fredag kravlistan försenad', all, now)).toHaveLength(0)
  })

  it('keeps å, ä and ö apart from a, a and o', () => {
    expect(searchMeetings('pa fredag', all, now)).toHaveLength(0)
    expect(searchMeetings('PÅ FREDAG', all, now)).toHaveLength(1)
  })

  it('names the speaker and finds protocol lines as readable text', () => {
    const [result] = searchMeetings('avrop ramavtalet', all, now)
    expect(result.hits).toEqual([
      {
        kind: 'transcript',
        startSec: 742,
        speaker: 'Maria Lind',
        text: 'Vi kör ett avrop på ramavtalet.'
      },
      { kind: 'protocol', summaryId: 's1', templateName: 'Protokoll', text: 'Avrop på ramavtalet.' }
    ])
    expect(result.total).toBe(2)
  })

  it('filters by project and by time', () => {
    expect(searchMeetings('kravlistan', { projectId: 'p1', sinceDays: null }, now)).toHaveLength(1)
    expect(
      searchMeetings('kravlistan', { projectId: 'none', sinceDays: null }, now)[0].meetingId
    ).toBe('m2')
    expect(searchMeetings('kravlistan', { projectId: 'all', sinceDays: 30 }, now)).toHaveLength(1)
  })

  it('reads a meeting again only when its files changed', () => {
    // New stamps, so what earlier tests cached does not count.
    stamps.set('m1', 'a')
    stamps.set('m2', 'a')
    searchMeetings('kravlistan', all, now)
    searchMeetings('fredag', all, now)
    expect(readTranscript).toHaveBeenCalledTimes(2)

    transcripts.set('m2', {
      language: 'sv',
      text: '',
      segments: [{ startSec: 0, endSec: 1, text: 'Ny text' }]
    })
    stamps.set('m2', '2')
    expect(searchMeetings('ny text', all, now).map((r) => r.meetingId)).toEqual(['m2'])
    expect(readTranscript).toHaveBeenCalledTimes(3)
  })

  it('is empty for an empty query', () => {
    expect(searchMeetings('   ', all, now)).toEqual([])
  })
})
