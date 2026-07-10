// Pure diarization merge logic — no Electron imports, unit-tested in isolation.
// Turns come from the diarization server on the same global timeline as the
// transcript's concatenated segments. The small drift at file boundaries
// (transcript offsets use last-segment-end, the server uses real audio length)
// is absorbed by largest-overlap matching rather than exact boundaries.

import type { Transcript, TranscriptSegment } from '../shared/types'
import type { DiarizationTurn } from './providers/diarization'

function overlapSec(seg: TranscriptSegment, turn: DiarizationTurn): number {
  return Math.min(seg.endSec, turn.endSec) - Math.max(seg.startSec, turn.startSec)
}

/**
 * The speaker with the largest temporal overlap; a segment with no overlap at
 * all falls back to the turn whose midpoint is nearest the segment's midpoint.
 */
function pickSpeaker(seg: TranscriptSegment, turns: DiarizationTurn[]): string {
  let best = ''
  let bestOverlap = 0
  for (const turn of turns) {
    const o = overlapSec(seg, turn)
    if (o > bestOverlap) {
      bestOverlap = o
      best = turn.speaker
    }
  }
  if (best) return best

  const segMid = (seg.startSec + seg.endSec) / 2
  let nearest = turns[0]
  let nearestDist = Infinity
  for (const turn of turns) {
    const d = Math.abs((turn.startSec + turn.endSec) / 2 - segMid)
    if (d < nearestDist) {
      nearestDist = d
      nearest = turn
    }
  }
  return nearest.speaker
}

/** Order of first appearance of speaker ids across the segments. */
function speakerOrder(segments: TranscriptSegment[]): string[] {
  const order: string[] = []
  for (const seg of segments) {
    if (seg.speaker && !order.includes(seg.speaker)) order.push(seg.speaker)
  }
  return order
}

/**
 * Merge diarization turns into a transcript, additively: every segment gets
 * the best-matching speaker id and the transcript gets a speakers map with
 * default display names 'Talare 1', 'Talare 2', … numbered by order of first
 * appearance. Names from an existing speakers map (user renames) are kept for
 * ids that still exist. Empty turns leave the transcript unchanged.
 */
export function mergeDiarization(transcript: Transcript, turns: DiarizationTurn[]): Transcript {
  if (turns.length === 0 || transcript.segments.length === 0) return transcript

  const segments = transcript.segments.map((seg) => ({
    ...seg,
    speaker: pickSpeaker(seg, turns)
  }))

  const previous = transcript.speakers ?? {}
  const speakers: Record<string, string> = {}
  for (const [index, id] of speakerOrder(segments).entries()) {
    speakers[id] = previous[id] ?? `Talare ${index + 1}`
  }

  return { ...transcript, segments, speakers }
}

/**
 * Set a speaker's display name (trimmed). An empty name reverts to the
 * default 'Talare N' for that speaker's first-appearance position.
 * No-op when the transcript has no such speaker.
 */
export function renameSpeakerInTranscript(
  transcript: Transcript,
  speakerId: string,
  name: string
): Transcript {
  const current = transcript.speakers
  if (!current || !(speakerId in current)) return transcript

  const trimmed = name.trim()
  let next: string
  if (trimmed) {
    next = trimmed
  } else {
    const order = speakerOrder(transcript.segments)
    const index = order.indexOf(speakerId)
    // Speaker in the map but not in any segment: number it after the rest.
    next = `Talare ${index >= 0 ? index + 1 : order.length + 1}`
  }

  return { ...transcript, speakers: { ...current, [speakerId]: next } }
}

/**
 * Remove a recognition suggestion for one speaker. Returns the same object
 * when there is nothing to remove; drops the whole map when it becomes empty.
 */
export function dismissSuggestionInTranscript(
  transcript: Transcript,
  speakerId: string
): Transcript {
  const suggestions = transcript.speakerSuggestions
  if (!suggestions || !(speakerId in suggestions)) return transcript
  const rest = { ...suggestions }
  delete rest[speakerId]
  const next = { ...transcript }
  if (Object.keys(rest).length > 0) next.speakerSuggestions = rest
  else delete next.speakerSuggestions
  return next
}

// ---- Voice recognition across meetings (pure matching logic) ----

/**
 * Minimum cosine similarity for a profile match. Calibrated against the
 * community-1 pipeline's 256-dim centroids: same voice across meetings
 * measured ≥0.95, different voices ≤0.17 — 0.6 favors recall (matches are
 * only ever shown as suggestions) while keeping a wide margin both ways.
 */
export const RECOGNITION_THRESHOLD = 0.6

/** Display names still on the default 'Talare N' pattern are safe to suggest over. */
export function isDefaultSpeakerName(name: string): boolean {
  return /^Talare \d+$/.test(name)
}

/**
 * Cosine similarity in [-1, 1]. Vectors of different length (e.g. after a
 * model change on the server) or with zero norm compare as 0 — never a match.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface ProfileWithEmbedding {
  id: string
  name: string
  embedding: number[]
}

/**
 * Match this meeting's speakers against stored voice profiles. Greedy
 * best-first UNIQUE assignment: all speaker×profile pairs are ranked by
 * similarity, and a pair is assigned only when both sides are still unused
 * and the similarity clears the threshold. Two speakers can therefore never
 * be suggested the same profile name. Returns speaker id -> profile name.
 */
export function matchSpeakerProfiles(
  embeddings: Record<string, number[]>,
  profiles: ProfileWithEmbedding[],
  threshold: number
): Record<string, string> {
  interface Pair {
    speakerId: string
    profile: ProfileWithEmbedding
    similarity: number
  }
  const pairs: Pair[] = []
  for (const [speakerId, embedding] of Object.entries(embeddings)) {
    for (const profile of profiles) {
      const similarity = cosineSimilarity(embedding, profile.embedding)
      if (similarity >= threshold) pairs.push({ speakerId, profile, similarity })
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity)

  const usedSpeakers = new Set<string>()
  const usedProfiles = new Set<string>()
  const suggestions: Record<string, string> = {}
  for (const { speakerId, profile } of pairs) {
    if (usedSpeakers.has(speakerId) || usedProfiles.has(profile.id)) continue
    usedSpeakers.add(speakerId)
    usedProfiles.add(profile.id)
    suggestions[speakerId] = profile.name
  }
  return suggestions
}

/**
 * Transcript text with speaker attribution, for the {{transcript}} slot in
 * the prompt template. Consecutive segments by the same speaker are grouped
 * into one "Name: text" paragraph; paragraphs are separated by blank lines.
 * Transcripts without speakers return the plain text unchanged.
 */
export function speakerAttributedText(transcript: Transcript): string {
  if (!transcript.segments.some((seg) => seg.speaker)) return transcript.text

  const names = transcript.speakers ?? {}
  const paragraphs: string[] = []
  let currentSpeaker: string | undefined
  let currentTexts: string[] = []

  const flush = (): void => {
    const joined = currentTexts.join(' ').trim()
    currentTexts = []
    if (!joined) return
    const name = currentSpeaker ? names[currentSpeaker] || currentSpeaker : ''
    paragraphs.push(name ? `${name}: ${joined}` : joined)
  }

  for (const seg of transcript.segments) {
    if (currentTexts.length > 0 && seg.speaker !== currentSpeaker) flush()
    currentSpeaker = seg.speaker
    currentTexts.push(seg.text)
  }
  flush()

  return paragraphs.join('\n\n')
}
