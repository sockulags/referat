import { describe, it, expect } from 'vitest'
import type { Transcript } from '../shared/types'
import type { LevelEnvelope } from '../shared/levels'
import { encodeLevel, LEVEL_RATE_HZ } from '../shared/levels'
import {
  attributeBySource,
  identifyMicSpeaker,
  MIC_SPEAKER,
  nameMicSpeaker,
  SYSTEM_SPEAKER
} from './sourceAttribution'

/** Build one second's worth of samples at a given loudness in dBFS. */
function seconds(count: number, db: number): number[] {
  return Array.from({ length: count * LEVEL_RATE_HZ }, () => encodeLevel(10 ** (db / 20)))
}

const LOUD = -12
const QUIET = -40
const SILENT = -90

function envelope(mic: number[], system: number[]): LevelEnvelope {
  return { rate: LEVEL_RATE_HZ, mic, system }
}

/** Two 5-second segments back to back. */
function transcript(over: Partial<Transcript> = {}): Transcript {
  return {
    language: 'sv',
    text: 'Ett Två',
    segments: [
      { startSec: 0, endSec: 5, text: 'Ett' },
      { startSec: 5, endSec: 10, text: 'Två' }
    ],
    ...over
  }
}

describe('attributeBySource', () => {
  it('labels the segment where the microphone is louder as the user', () => {
    const result = attributeBySource(
      transcript(),
      envelope([...seconds(10, LOUD)], [...seconds(10, QUIET)])
    )
    expect(result.segments.map((s) => s.speaker)).toEqual([MIC_SPEAKER, MIC_SPEAKER])
    expect(result.speakers).toEqual({ MIC: 'Jag' })
  })

  it('labels the segment where the system audio is louder as everyone else', () => {
    const result = attributeBySource(
      transcript(),
      envelope([...seconds(10, QUIET)], [...seconds(10, LOUD)])
    )
    expect(result.segments.map((s) => s.speaker)).toEqual([SYSTEM_SPEAKER, SYSTEM_SPEAKER])
    expect(result.speakers).toEqual({ SYS: 'Övriga' })
  })

  it('splits a meeting where the two sides take turns', () => {
    const result = attributeBySource(
      transcript(),
      envelope(
        [...seconds(5, LOUD), ...seconds(5, QUIET)],
        [...seconds(5, QUIET), ...seconds(5, LOUD)]
      )
    )
    expect(result.segments.map((s) => s.speaker)).toEqual([MIC_SPEAKER, SYSTEM_SPEAKER])
    expect(result.speakers).toEqual({ MIC: 'Jag', SYS: 'Övriga' })
  })

  it('leaves a segment unlabelled when the two sides are too close to call', () => {
    // Open speakers bleed into the microphone: both sides are loud, and a
    // guess here would put the wrong name in the protocol.
    const input = transcript()
    const result = attributeBySource(input, envelope(seconds(10, LOUD), seconds(10, LOUD - 3)))
    expect(result).toBe(input)
  })

  it('leaves silence alone', () => {
    const input = transcript()
    expect(attributeBySource(input, envelope(seconds(10, SILENT), seconds(10, SILENT)))).toBe(input)
  })

  it('does nothing without system audio — everyone would become the user', () => {
    const input = transcript()
    expect(attributeBySource(input, envelope(seconds(10, LOUD), []))).toBe(input)
  })

  it('stands down when diarization already attributed the segments', () => {
    const input = transcript({
      segments: [
        { startSec: 0, endSec: 5, text: 'Ett', speaker: 'S1' },
        { startSec: 5, endSec: 10, text: 'Två', speaker: 'S2' }
      ]
    })
    expect(attributeBySource(input, envelope(seconds(10, LOUD), seconds(10, QUIET)))).toBe(input)
  })

  it('keeps a name the user has already chosen', () => {
    const result = attributeBySource(
      transcript({ speakers: { [MIC_SPEAKER]: 'Lucas' } }),
      envelope(seconds(10, LOUD), seconds(10, QUIET))
    )
    expect(result.speakers).toEqual({ MIC: 'Lucas' })
  })

  it('leaves segments that fall outside the recorded envelope alone', () => {
    // The envelope covers the first segment only; the second is past its end.
    const result = attributeBySource(transcript(), envelope(seconds(5, LOUD), seconds(5, QUIET)))
    expect(result.segments.map((s) => s.speaker)).toEqual([MIC_SPEAKER, undefined])
  })

  it('is a no-op for an empty envelope or an empty transcript', () => {
    const input = transcript()
    expect(attributeBySource(input, envelope([], []))).toBe(input)
    const empty = transcript({ segments: [], text: '' })
    expect(attributeBySource(empty, envelope(seconds(10, LOUD), seconds(10, QUIET)))).toBe(empty)
  })
})

/** A diarized transcript: `plan` is one entry per 10-second speaker turn. */
function diarized(plan: string[]): Transcript {
  return {
    language: 'sv',
    text: plan.join(' '),
    segments: plan.map((speaker, i) => ({
      startSec: i * 10,
      endSec: (i + 1) * 10,
      text: `Tur ${i + 1}`,
      speaker
    })),
    speakers: Object.fromEntries([...new Set(plan)].map((id, i) => [id, `Talare ${i + 1}`]))
  }
}

/** Levels for a plan: each 10-second turn is loud on one side, quiet on the other. */
function planEnvelope(plan: string[], micSpeaker: string): LevelEnvelope {
  const mic: number[] = []
  const system: number[] = []
  for (const speaker of plan) {
    const isMic = speaker === micSpeaker
    mic.push(...seconds(10, isMic ? LOUD : QUIET))
    system.push(...seconds(10, isMic ? QUIET : LOUD))
  }
  return { rate: LEVEL_RATE_HZ, mic, system }
}

describe('identifyMicSpeaker', () => {
  it('finds the diarized speaker who spoke through the microphone', () => {
    const plan = ['S1', 'S2', 'S1', 'S3']
    expect(identifyMicSpeaker(diarized(plan), planEnvelope(plan, 'S2'))).toBe('S2')
  })

  it('is undecided when two speakers share the microphone', () => {
    // Two people at one laptop: both clusters are mostly mic-side, and picking
    // one of them as "you" would be a coin flip.
    const plan = ['S1', 'S2', 'S1', 'S2']
    const envelope = planEnvelope(plan, 'S1')
    // Make S2 mic-side too.
    envelope.mic = [...seconds(40, LOUD)]
    envelope.system = [...seconds(40, QUIET)]
    expect(identifyMicSpeaker(diarized(plan), envelope)).toBeUndefined()
  })

  it('is undecided when nobody is clearly on the microphone', () => {
    const plan = ['S1', 'S2']
    const envelope: LevelEnvelope = {
      rate: LEVEL_RATE_HZ,
      mic: seconds(20, QUIET),
      system: seconds(20, LOUD)
    }
    expect(identifyMicSpeaker(diarized(plan), envelope)).toBeUndefined()
  })

  it('ignores a speaker with too little attributed speech to judge', () => {
    // S2 says two seconds through the mic; that is not enough to call them you.
    const transcript: Transcript = {
      language: 'sv',
      text: 'Ett Två',
      segments: [
        { startSec: 0, endSec: 20, text: 'Ett', speaker: 'S1' },
        { startSec: 20, endSec: 22, text: 'Två', speaker: 'S2' }
      ]
    }
    const envelope: LevelEnvelope = {
      rate: LEVEL_RATE_HZ,
      mic: [...seconds(20, QUIET), ...seconds(2, LOUD)],
      system: [...seconds(20, LOUD), ...seconds(2, QUIET)]
    }
    expect(identifyMicSpeaker(transcript, envelope)).toBeUndefined()
  })

  it('says nothing without system audio or without diarization', () => {
    const plan = ['S1', 'S2']
    expect(
      identifyMicSpeaker(diarized(plan), {
        rate: LEVEL_RATE_HZ,
        mic: seconds(20, LOUD),
        system: []
      })
    ).toBeUndefined()
    expect(identifyMicSpeaker(transcript(), planEnvelope(plan, 'S1'))).toBeUndefined()
  })
})

describe('nameMicSpeaker', () => {
  it('names the user and renumbers everyone else', () => {
    const result = nameMicSpeaker(diarized(['S1', 'S2', 'S3']), 'S2', 'Lucas')
    expect(result.speakers).toEqual({ S1: 'Talare 1', S2: 'Lucas', S3: 'Talare 2' })
  })

  it('keeps a name the user typed for another speaker', () => {
    const input = diarized(['S1', 'S2'])
    input.speakers = { S1: 'Anna', S2: 'Talare 2' }
    expect(nameMicSpeaker(input, 'S2', 'Lucas').speakers).toEqual({ S1: 'Anna', S2: 'Lucas' })
  })

  it('replaces its own placeholder once a real name exists', () => {
    const input = diarized(['S1'])
    input.speakers = { S1: 'Jag' }
    expect(nameMicSpeaker(input, 'S1', 'Lucas').speakers).toEqual({ S1: 'Lucas' })
  })

  it('does not overwrite a name the user typed for themselves', () => {
    const input = diarized(['S1'])
    input.speakers = { S1: 'Ordföranden' }
    expect(nameMicSpeaker(input, 'S1', 'Lucas').speakers).toEqual({ S1: 'Ordföranden' })
  })

  it('leaves the transcript alone for a speaker that is not there', () => {
    const input = diarized(['S1'])
    expect(nameMicSpeaker(input, 'S9', 'Lucas')).toBe(input)
  })
})
