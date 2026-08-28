import { describe, it, expect } from 'vitest'
import type { Transcript } from '../shared/types'
import type { LevelEnvelope } from '../shared/levels'
import { encodeLevel, LEVEL_RATE_HZ } from '../shared/levels'
import { attributeBySource, MIC_SPEAKER, SYSTEM_SPEAKER } from './sourceAttribution'

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
