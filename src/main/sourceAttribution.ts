// Tell the person at the microphone apart from everyone coming through the
// system audio, without diarization. The recorder already measures both
// sources for the level meters; recording that envelope means each transcript
// segment can be attributed to whichever side was actually loud during it.
//
// This is a weaker signal than diarization — it separates two sides, not
// individual voices — but the microphone side is the one identity in the whole
// pipeline that is known rather than guessed.

import type { Transcript, TranscriptSegment } from '../shared/types'
import type { LevelEnvelope } from '../shared/levels'
import { levelToDb } from '../shared/levels'

export const MIC_SPEAKER = 'MIC'
export const SYSTEM_SPEAKER = 'SYS'

const DEFAULT_NAMES: Record<string, string> = {
  [MIC_SPEAKER]: 'Jag',
  [SYSTEM_SPEAKER]: 'Övriga'
}

/**
 * How much louder one source must be before a segment is attributed to it.
 * Open speakers bleed into the microphone even with echo cancellation on, so a
 * segment where the two sides are close is left unattributed: a missing label
 * is honest, a wrong one in a protocol is not.
 */
const MARGIN_DB = 6

/** Below this both sides are effectively silent and there is nothing to judge. */
const SILENCE_DB = -55

/**
 * Loudness of one source over a time range, as the mean of the louder half of
 * its samples. A plain mean would be dragged down by the pauses inside a
 * segment, and equally so for both sides, but the trimmed value tracks "how
 * loud did this source actually get" — which is the question being asked.
 *
 * Returns null when the range falls outside the recorded envelope.
 */
function loudnessDb(levels: number[], rate: number, fromSec: number, toSec: number): number | null {
  const start = Math.max(0, Math.floor(fromSec * rate))
  const end = Math.min(levels.length, Math.ceil(toSec * rate))
  if (end <= start) return null
  const values = levels.slice(start, end).map(levelToDb)
  values.sort((a, b) => b - a)
  const take = Math.max(1, Math.ceil(values.length / 2))
  let sum = 0
  for (let i = 0; i < take; i++) sum += values[i]
  return sum / take
}

/** Which side owns this segment, or undefined when the envelope cannot say. */
function pickSource(segment: TranscriptSegment, envelope: LevelEnvelope): string | undefined {
  const { rate } = envelope
  const mic = loudnessDb(envelope.mic, rate, segment.startSec, segment.endSec)
  const system = loudnessDb(envelope.system, rate, segment.startSec, segment.endSec)
  if (mic === null || system === null) return undefined
  if (mic < SILENCE_DB && system < SILENCE_DB) return undefined
  if (mic - system >= MARGIN_DB) return MIC_SPEAKER
  if (system - mic >= MARGIN_DB) return SYSTEM_SPEAKER
  return undefined
}

/**
 * Attribute each segment to the microphone or the system audio. Returns the
 * transcript unchanged — the same object — whenever the envelope cannot
 * support an answer, so callers can skip the write.
 */
export function attributeBySource(transcript: Transcript, envelope: LevelEnvelope): Transcript {
  // A meeting recorded without system audio is all microphone. Saying so adds
  // no information, and everyone in the room would be labelled as the user.
  if (envelope.mic.length === 0 || envelope.system.length === 0) return transcript
  if (!(envelope.rate > 0)) return transcript
  if (transcript.segments.length === 0) return transcript
  // Diarization, when it ran, knows more than this does.
  if (transcript.segments.some((seg) => seg.speaker)) return transcript

  const segments = transcript.segments.map((seg) => {
    const speaker = pickSource(seg, envelope)
    return speaker ? { ...seg, speaker } : seg
  })
  if (!segments.some((seg) => seg.speaker)) return transcript

  const previous = transcript.speakers ?? {}
  const speakers: Record<string, string> = {}
  for (const id of [MIC_SPEAKER, SYSTEM_SPEAKER]) {
    if (segments.some((seg) => seg.speaker === id)) {
      speakers[id] = previous[id] ?? DEFAULT_NAMES[id]
    }
  }
  return { ...transcript, segments, speakers }
}
