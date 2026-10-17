// Full-text search across every meeting's transcript and protocols, on this
// computer. No AI: every word of the query has to be there, in any order, and
// case does not matter (å, ä and ö stay their own letters). The text of each
// meeting is cached and read again only when its files change.

import type { SearchFilter, SearchHit, SearchResult } from '../shared/types'
import { listMeetings, listSummaries, readTranscript, textStamp } from './storage'

const HITS_PER_MEETING = 5
const MAX_RESULTS = 50

interface IndexedText {
  stamp: string
  segments: { startSec: number; speaker?: string; text: string; lower: string }[]
  protocols: { summaryId: string; templateName: string; text: string; lower: string }[]
}

const cache = new Map<string, IndexedText>()

function lower(text: string): string {
  return text.toLocaleLowerCase('sv')
}

/** One protocol line as readable text: no heading marks, bullets or bold. */
function plainLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()
}

function indexed(meetingId: string): IndexedText {
  const stamp = textStamp(meetingId)
  const cached = cache.get(meetingId)
  if (cached && cached.stamp === stamp) return cached
  const transcript = readTranscript(meetingId)
  const names = transcript?.speakers ?? {}
  const entry: IndexedText = {
    stamp,
    segments: (transcript?.segments ?? []).map((seg) => ({
      startSec: seg.startSec,
      speaker: seg.speaker ? names[seg.speaker] || seg.speaker : undefined,
      text: seg.text,
      lower: lower(seg.text)
    })),
    protocols: listSummaries(meetingId).flatMap((summary) =>
      summary.markdown
        .split(/\r?\n/)
        .map(plainLine)
        .filter(Boolean)
        .map((text) => ({
          summaryId: summary.id,
          templateName: summary.templateName,
          text,
          lower: lower(text)
        }))
    )
  }
  cache.set(meetingId, entry)
  return entry
}

function inFilter(
  meta: { projectId?: string; createdAt: string },
  filter: SearchFilter,
  now: number
): boolean {
  if (filter.projectId === 'none' && meta.projectId) return false
  if (filter.projectId !== 'all' && filter.projectId !== 'none') {
    if (meta.projectId !== filter.projectId) return false
  }
  if (filter.sinceDays !== null) {
    const since = now - filter.sinceDays * 86_400_000
    if (Date.parse(meta.createdAt) < since) return false
  }
  return true
}

export function searchMeetings(
  query: string,
  filter: SearchFilter,
  now: number = Date.now()
): SearchResult[] {
  const terms = lower(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const matches = (text: string): boolean => terms.every((term) => text.includes(term))

  const results: SearchResult[] = []
  // Newest first, the way listMeetings returns them.
  for (const meta of listMeetings()) {
    if (!inFilter(meta, filter, now)) continue
    const text = indexed(meta.id)
    const hits: SearchHit[] = [
      ...text.segments
        .filter((seg) => matches(seg.lower))
        .map((seg): SearchHit => ({
          kind: 'transcript',
          startSec: seg.startSec,
          ...(seg.speaker ? { speaker: seg.speaker } : {}),
          text: seg.text
        })),
      ...text.protocols
        .filter((line) => matches(line.lower))
        .map((line): SearchHit => ({
          kind: 'protocol',
          summaryId: line.summaryId,
          templateName: line.templateName,
          text: line.text
        }))
    ]
    if (hits.length === 0) continue
    results.push({
      meetingId: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      ...(meta.projectId ? { projectId: meta.projectId } : {}),
      hits: hits.slice(0, HITS_PER_MEETING),
      total: hits.length
    })
    if (results.length === MAX_RESULTS) break
  }
  return results
}
