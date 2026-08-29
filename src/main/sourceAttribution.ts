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
import { isDefaultSpeakerName, speakerOrder } from './diarize'

export const MIC_SPEAKER = 'MIC'
export const SYSTEM_SPEAKER = 'SYS'

/** What the microphone's speaker is called before the user gives a name. */
export const MIC_FALLBACK_NAME = 'Jag'

const SYSTEM_NAME = 'Övriga'

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
export function attributeBySource(
  transcript: Transcript,
  envelope: LevelEnvelope,
  micName: string = MIC_FALLBACK_NAME
): Transcript {
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
      speakers[id] = previous[id] ?? (id === MIC_SPEAKER ? micName : SYSTEM_NAME)
    }
  }
  return { ...transcript, segments, speakers }
}

// ---- Combined with diarization ----
//
// Diarization clusters voices but cannot say which cluster is the person
// holding the meeting. The envelope can: whichever cluster spoke through the
// microphone is the user. That turns the hardest label to assign — your own —
// into the only one that is known rather than inferred.

/** A cluster needs this much attributed speech before it is judged at all. */
const MIN_ATTRIBUTED_SEC = 5

/** How much of a cluster's attributed speech must have come from the microphone. */
const MIC_SHARE = 0.7

/**
 * And how far ahead of the runner-up it has to be. Two people sharing one
 * laptop microphone would otherwise turn into a coin flip over which is "you".
 */
const SHARE_LEAD = 0.25

/**
 * Which diarized speaker is the person at the microphone, or undefined when
 * the envelope cannot say so with confidence.
 */
export function identifyMicSpeaker(
  transcript: Transcript,
  envelope: LevelEnvelope
): string | undefined {
  if (envelope.mic.length === 0 || envelope.system.length === 0) return undefined
  if (!(envelope.rate > 0)) return undefined

  const tally = new Map<string, { mic: number; total: number }>()
  for (const seg of transcript.segments) {
    if (!seg.speaker) continue
    const source = pickSource(seg, envelope)
    if (!source) continue
    const duration = seg.endSec - seg.startSec
    if (!(duration > 0)) continue
    const entry = tally.get(seg.speaker) ?? { mic: 0, total: 0 }
    entry.total += duration
    if (source === MIC_SPEAKER) entry.mic += duration
    tally.set(seg.speaker, entry)
  }

  const scored = [...tally.entries()]
    .filter(([, counts]) => counts.total >= MIN_ATTRIBUTED_SEC)
    .map(([id, counts]) => ({ id, share: counts.mic / counts.total }))
    .sort((a, b) => b.share - a.share)

  const best = scored[0]
  if (!best || best.share < MIC_SHARE) return undefined
  const runnerUp = scored[1]
  if (runnerUp && best.share - runnerUp.share < SHARE_LEAD) return undefined
  return best.id
}

/**
 * Give the microphone's speaker its own name and renumber the rest, so the
 * user is not left working out which of 'Talare 1..N' is themselves. A name
 * the user chose is kept; the automatic ones are reassigned.
 */
export function nameMicSpeaker(
  transcript: Transcript,
  micSpeaker: string,
  micName: string
): Transcript {
  const order = speakerOrder(transcript.segments)
  if (!order.includes(micSpeaker)) return transcript

  const previous = transcript.speakers ?? {}
  const speakers: Record<string, string> = {}
  let index = 0
  for (const id of order) {
    const chosen = previous[id]
    if (id === micSpeaker) {
      // 'Jag' is this module's own placeholder, so it gives way to a real name
      // once the user sets one — unlike a name they typed themselves.
      const automatic = !chosen || isDefaultSpeakerName(chosen) || chosen === MIC_FALLBACK_NAME
      speakers[id] = automatic ? micName : chosen
      continue
    }
    index += 1
    speakers[id] = chosen && !isDefaultSpeakerName(chosen) ? chosen : `Talare ${index}`
  }
  return { ...transcript, speakers }
}
