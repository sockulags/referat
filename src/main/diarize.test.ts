import { describe, it, expect } from 'vitest'
import type { Transcript } from '../shared/types'
import type { DiarizationTurn } from './providers/diarization'
import {
  cosineSimilarity,
  dismissSuggestionInTranscript,
  isDefaultSpeakerName,
  matchSpeakerProfiles,
  mergeDiarization,
  renameSpeakerInTranscript,
  speakerAttributedText,
  type ProfileWithEmbedding
} from './diarize'

function transcriptOf(segments: { startSec: number; endSec: number; text: string }[]): Transcript {
  return {
    language: 'sv',
    segments,
    text: segments
      .map((s) => s.text)
      .join(' ')
      .trim()
  }
}

function turn(startSec: number, endSec: number, speaker: string): DiarizationTurn {
  return { startSec, endSec, speaker }
}

describe('mergeDiarization', () => {
  it('assigns each segment the speaker with the largest overlap across a multi-file timeline', () => {
    // Two recorded files concatenated: file 1 covers 0-12, file 2 covers 12-24.
    const t = transcriptOf([
      { startSec: 0, endSec: 6, text: 'A' },
      { startSec: 6, endSec: 12, text: 'B' },
      { startSec: 12, endSec: 18, text: 'C' },
      { startSec: 18, endSec: 24, text: 'D' }
    ])
    const merged = mergeDiarization(t, [
      turn(0, 6, 'S1'),
      turn(6, 12, 'S2'),
      turn(12, 18, 'S1'),
      turn(18, 24, 'S2')
    ])

    expect(merged.segments.map((s) => s.speaker)).toEqual(['S1', 'S2', 'S1', 'S2'])
    expect(merged.speakers).toEqual({ S1: 'Talare 1', S2: 'Talare 2' })
  })

  it('resolves partial overlaps in favor of the larger one', () => {
    // Segment 0-10: S1 overlaps 4s, S2 overlaps 6s -> S2 wins.
    const t = transcriptOf([{ startSec: 0, endSec: 10, text: 'Hej' }])
    const merged = mergeDiarization(t, [turn(0, 4, 'S1'), turn(4, 12, 'S2')])
    expect(merged.segments[0].speaker).toBe('S2')
  })

  it('absorbs timeline drift at file boundaries via overlap matching', () => {
    // Diarization timeline is shifted ~1s versus the transcript offsets.
    const t = transcriptOf([
      { startSec: 12, endSec: 18, text: 'C' },
      { startSec: 18, endSec: 24, text: 'D' }
    ])
    const merged = mergeDiarization(t, [turn(13, 19, 'S1'), turn(19, 25, 'S2')])
    expect(merged.segments.map((s) => s.speaker)).toEqual(['S1', 'S2'])
  })

  it('falls back to the turn with the nearest midpoint when a segment has no overlap', () => {
    // Segment sits in a gap between turns; midpoint 15 is closer to S2 (mid 21)
    // than to S1 (mid 2.5).
    const t = transcriptOf([{ startSec: 14, endSec: 16, text: 'Gap' }])
    const merged = mergeDiarization(t, [turn(0, 5, 'S1'), turn(18, 24, 'S2')])
    expect(merged.segments[0].speaker).toBe('S2')
  })

  it('returns the transcript unchanged when there are no turns', () => {
    const t = transcriptOf([{ startSec: 0, endSec: 5, text: 'Hej' }])
    const merged = mergeDiarization(t, [])
    expect(merged).toBe(t)
    expect(merged.segments[0]).not.toHaveProperty('speaker')
    expect(merged).not.toHaveProperty('speakers')
  })

  it('numbers default names by order of first appearance in the merged segments', () => {
    // S2 speaks first, so it becomes 'Talare 1'.
    const t = transcriptOf([
      { startSec: 0, endSec: 5, text: 'A' },
      { startSec: 5, endSec: 10, text: 'B' }
    ])
    const merged = mergeDiarization(t, [turn(0, 5, 'S2'), turn(5, 10, 'S1')])
    expect(merged.speakers).toEqual({ S2: 'Talare 1', S1: 'Talare 2' })
  })

  it('keeps existing names on re-diarization for speaker ids that still exist', () => {
    const t: Transcript = {
      ...transcriptOf([
        { startSec: 0, endSec: 5, text: 'A' },
        { startSec: 5, endSec: 10, text: 'B' }
      ]),
      speakers: { S1: 'Anna', S3: 'Bertil' }
    }
    const merged = mergeDiarization(t, [turn(0, 5, 'S1'), turn(5, 10, 'S2')])
    // S1 keeps its rename, S2 is new and gets a default, S3 no longer exists.
    expect(merged.speakers).toEqual({ S1: 'Anna', S2: 'Talare 2' })
  })
})

describe('renameSpeakerInTranscript', () => {
  const base: Transcript = {
    ...transcriptOf([
      { startSec: 0, endSec: 5, text: 'A' },
      { startSec: 5, endSec: 10, text: 'B' }
    ]),
    segments: [
      { startSec: 0, endSec: 5, text: 'A', speaker: 'S1' },
      { startSec: 5, endSec: 10, text: 'B', speaker: 'S2' }
    ],
    speakers: { S1: 'Talare 1', S2: 'Talare 2' }
  }

  it('sets a trimmed display name', () => {
    const renamed = renameSpeakerInTranscript(base, 'S1', '  Anna  ')
    expect(renamed.speakers).toEqual({ S1: 'Anna', S2: 'Talare 2' })
    // Original is untouched (pure function).
    expect(base.speakers).toEqual({ S1: 'Talare 1', S2: 'Talare 2' })
  })

  it('reverts to the default name when given an empty/whitespace name', () => {
    const renamed = renameSpeakerInTranscript(base, 'S2', 'Bertil')
    const reverted = renameSpeakerInTranscript(renamed, 'S2', '   ')
    expect(reverted.speakers).toEqual({ S1: 'Talare 1', S2: 'Talare 2' })
  })

  it('is a no-op for an unknown speaker id or a transcript without speakers', () => {
    expect(renameSpeakerInTranscript(base, 'S9', 'Anna')).toBe(base)
    const plain = transcriptOf([{ startSec: 0, endSec: 5, text: 'A' }])
    expect(renameSpeakerInTranscript(plain, 'S1', 'Anna')).toBe(plain)
  })
})

describe('dismissSuggestionInTranscript', () => {
  const base: Transcript = {
    ...transcriptOf([{ startSec: 0, endSec: 5, text: 'A' }]),
    speakers: { S1: 'Talare 1', S2: 'Talare 2' },
    speakerSuggestions: { S1: 'Anna', S2: 'Bertil' }
  }

  it('removes the suggestion for the given speaker only', () => {
    const next = dismissSuggestionInTranscript(base, 'S1')
    expect(next.speakerSuggestions).toEqual({ S2: 'Bertil' })
    // Original untouched (pure function).
    expect(base.speakerSuggestions).toEqual({ S1: 'Anna', S2: 'Bertil' })
  })

  it('drops the whole suggestions map when the last suggestion is removed', () => {
    const one: Transcript = { ...base, speakerSuggestions: { S1: 'Anna' } }
    const next = dismissSuggestionInTranscript(one, 'S1')
    expect(next).not.toHaveProperty('speakerSuggestions')
  })

  it('is a no-op when there is no suggestion for the speaker', () => {
    expect(dismissSuggestionInTranscript(base, 'S9')).toBe(base)
    const plain = transcriptOf([{ startSec: 0, endSec: 5, text: 'A' }])
    expect(dismissSuggestionInTranscript(plain, 'S1')).toBe(plain)
  })
})

describe('isDefaultSpeakerName', () => {
  it('matches only the untouched "Talare N" pattern', () => {
    expect(isDefaultSpeakerName('Talare 1')).toBe(true)
    expect(isDefaultSpeakerName('Talare 12')).toBe(true)
    expect(isDefaultSpeakerName('Anna')).toBe(false)
    expect(isDefaultSpeakerName('Talare')).toBe(false)
    expect(isDefaultSpeakerName('Talare 1 (ordförande)')).toBe(false)
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical directions and -1 for opposite ones', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [-3, 0])).toBeCloseTo(-1)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('is 0 on dimension mismatch', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('is 0 when either vector has zero norm', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0)
  })
})

describe('matchSpeakerProfiles', () => {
  const profile = (id: string, name: string, embedding: number[]): ProfileWithEmbedding => ({
    id,
    name,
    embedding
  })

  it('suggests the profile name for a speaker above the threshold', () => {
    const suggestions = matchSpeakerProfiles(
      { S1: [1, 0, 0] },
      [profile('p1', 'Anna', [1, 0, 0])],
      0.5
    )
    expect(suggestions).toEqual({ S1: 'Anna' })
  })

  it('makes no suggestion below the threshold', () => {
    // Similarity 0 < 0.5.
    const suggestions = matchSpeakerProfiles(
      { S1: [1, 0, 0] },
      [profile('p1', 'Anna', [0, 1, 0])],
      0.5
    )
    expect(suggestions).toEqual({})
  })

  it('a similarity exactly at the threshold counts as a match', () => {
    // cos([1,0],[1,1]) = 1/sqrt(2) ≈ 0.7071
    const sim = cosineSimilarity([1, 0], [1, 1])
    const suggestions = matchSpeakerProfiles({ S1: [1, 0] }, [profile('p1', 'Anna', [1, 1])], sim)
    expect(suggestions).toEqual({ S1: 'Anna' })
  })

  it('assigns each profile at most once — the closer speaker wins', () => {
    // Both speakers resemble Anna, S2 more so; only S2 gets the suggestion.
    const suggestions = matchSpeakerProfiles(
      { S1: [1, 0.5], S2: [1, 0.1] },
      [profile('p1', 'Anna', [1, 0])],
      0.5
    )
    expect(suggestions).toEqual({ S2: 'Anna' })
  })

  it('assigns each speaker at most once — best profile wins, next profile goes to the next speaker', () => {
    const anna = [1, 0, 0]
    const bertil = [0.8, 0.6, 0]
    const suggestions = matchSpeakerProfiles(
      { S1: [1, 0.05, 0], S2: [0.9, 0.4, 0] },
      [profile('p1', 'Anna', anna), profile('p2', 'Bertil', bertil)],
      0.5
    )
    // S1 is nearest Anna; S2 then takes Bertil even though S2 is also Anna-like.
    expect(suggestions).toEqual({ S1: 'Anna', S2: 'Bertil' })
  })

  it('never matches profiles with a different embedding dimension', () => {
    const suggestions = matchSpeakerProfiles(
      { S1: [1, 0, 0] },
      [profile('p1', 'Anna', [1, 0])],
      0.1
    )
    expect(suggestions).toEqual({})
  })

  it('returns empty for empty inputs', () => {
    expect(matchSpeakerProfiles({}, [profile('p1', 'Anna', [1, 0])], 0.5)).toEqual({})
    expect(matchSpeakerProfiles({ S1: [1, 0] }, [], 0.5)).toEqual({})
  })
})

describe('speakerAttributedText', () => {
  it('returns plain text unchanged when the transcript has no speakers', () => {
    const t = transcriptOf([{ startSec: 0, endSec: 5, text: 'Hej på er' }])
    expect(speakerAttributedText(t)).toBe('Hej på er')
  })

  it('groups consecutive segments by speaker into named paragraphs', () => {
    const t: Transcript = {
      language: 'sv',
      text: 'A B C D',
      segments: [
        { startSec: 0, endSec: 2, text: 'A', speaker: 'S1' },
        { startSec: 2, endSec: 4, text: 'B', speaker: 'S1' },
        { startSec: 4, endSec: 6, text: 'C', speaker: 'S2' },
        { startSec: 6, endSec: 8, text: 'D', speaker: 'S1' }
      ],
      speakers: { S1: 'Anna', S2: 'Talare 2' }
    }
    expect(speakerAttributedText(t)).toBe('Anna: A B\n\nTalare 2: C\n\nAnna: D')
  })

  it('falls back to the raw speaker id when the speakers map lacks a name', () => {
    const t: Transcript = {
      language: 'sv',
      text: 'A',
      segments: [{ startSec: 0, endSec: 2, text: 'A', speaker: 'S1' }],
      speakers: {}
    }
    expect(speakerAttributedText(t)).toBe('S1: A')
  })
})
