// Playback of a meeting's recording. The recorder writes one file per
// ~10-minute segment; this joins them into one timeline, the same one the
// transcript's timestamps use.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MeetingDetail } from '../../../shared/types'
import { SEGMENT_SEC } from './recorder'

export interface MeetingAudio {
  /** False when the meeting has no recorded audio. */
  available: boolean
  playing: boolean
  /** Seconds into the meeting. */
  position: number
  /** The meeting's length in seconds. */
  duration: number
  /** Jump to a time and play from there. */
  playFrom: (sec: number) => void
  /** Jump to a time without changing whether it plays. */
  seek: (sec: number) => void
  toggle: () => void
}

/**
 * Where each segment starts. Transcripts made since playback existed record
 * it; older ones assume the recorder's segment length, which can be a few
 * seconds off late in a long meeting.
 */
export function segmentStarts(stored: number[] | undefined, segmentCount: number): number[] {
  if (stored && stored.length === segmentCount) return stored
  return Array.from({ length: segmentCount }, (_, i) => i * SEGMENT_SEC)
}

/** The segment a meeting time falls in, and the time inside that segment. */
export function locate(starts: number[], sec: number): { index: number; offset: number } {
  let index = 0
  for (let i = 0; i < starts.length; i++) if (starts[i] <= sec) index = i
  return { index, offset: Math.max(0, sec - (starts[index] ?? 0)) }
}

function segmentUrl(meetingId: string, index: number): string {
  return `referat-media://meeting/${encodeURIComponent(meetingId)}/${index}`
}

export function useMeetingAudio(meeting: MeetingDetail | null): MeetingAudio {
  const meetingId = meeting?.id ?? ''
  const count = meeting?.audioSegments ?? 0
  const stored = meeting?.transcript?.segmentStartsSec
  // Keyed on the values: every reload of the meeting brings a new transcript
  // object, and recreating the element would stop playback mid-sentence.
  const storedKey = stored?.join(',') ?? ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const starts = useMemo(() => segmentStarts(stored, count), [storedKey, count])
  const startsRef = useRef(starts)
  useEffect(() => {
    startsRef.current = starts
  }, [starts])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const segmentRef = useRef(-1)
  // Kept per meeting, so moving to another meeting starts from nothing
  // without resetting state inside the effect.
  const [state, setState] = useState({ meetingId: '', playing: false, position: 0 })
  const current = state.meetingId === meetingId ? state : { playing: false, position: 0 }

  // One element per meeting, dropped when the meeting changes or the view goes.
  useEffect(() => {
    if (!meetingId || count === 0) return
    const audio = new Audio()
    audio.preload = 'metadata'
    audioRef.current = audio
    segmentRef.current = -1
    const update = (patch: { playing?: boolean; position?: number }): void =>
      setState((s) => ({
        meetingId,
        playing: s.meetingId === meetingId ? s.playing : false,
        position: s.meetingId === meetingId ? s.position : 0,
        ...patch
      }))
    const onTime = (): void => {
      update({ position: (startsRef.current[segmentRef.current] ?? 0) + audio.currentTime })
    }
    const onEnded = (): void => {
      const next = segmentRef.current + 1
      if (next < count) {
        segmentRef.current = next
        audio.src = segmentUrl(meetingId, next)
        void audio.play()
      } else {
        update({ playing: false })
      }
    }
    const onPlay = (): void => update({ playing: true })
    const onPause = (): void => update({ playing: false })
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [meetingId, count])

  const seek = useCallback(
    (sec: number): void => {
      const audio = audioRef.current
      if (!audio) return
      const { index, offset } = locate(starts, sec)
      if (index !== segmentRef.current) {
        segmentRef.current = index
        audio.src = segmentUrl(meetingId, index)
      }
      audio.currentTime = offset
      setState((s) => ({
        meetingId,
        playing: s.meetingId === meetingId ? s.playing : false,
        position: sec
      }))
    },
    [meetingId, starts]
  )

  const playFrom = useCallback(
    (sec: number): void => {
      seek(sec)
      void audioRef.current?.play()
    },
    [seek]
  )

  const toggle = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    if (segmentRef.current < 0) {
      playFrom(0)
      return
    }
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [playFrom])

  return {
    available: count > 0,
    playing: current.playing,
    position: current.position,
    duration: meeting?.durationSec ?? 0,
    playFrom,
    seek,
    toggle
  }
}
