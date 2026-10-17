import type { JSX } from 'react'
import { useMemo } from 'react'
import type { Transcript } from '../../../shared/types'
import type { MeetingAudio } from '../audio/meetingAudio'
import { strings } from '../strings'
import { formatDuration } from '../format'
import { IconButton } from './ui/Button'
import { IconPause, IconPlay } from './icons'
import { cn } from './ui/cn'

/** Speaker colours, in order of first appearance; told apart by lightness too. */
const SPEAKER_COLORS = ['#2d6a4f', '#b7791f', '#3b6ea8', '#8a4f9e', '#b5452c']

interface Turn {
  left: number
  width: number
  color: string
}

/** The speaker strip: who talked when, as coloured spans across the meeting. */
function speakerTurns(
  transcript: Transcript | undefined,
  duration: number
): { turns: Turn[]; legend: { name: string; color: string }[] } {
  if (!transcript || duration <= 0) return { turns: [], legend: [] }
  const order: string[] = []
  const turns: Turn[] = []
  for (const seg of transcript.segments) {
    if (!seg.speaker) continue
    if (!order.includes(seg.speaker)) order.push(seg.speaker)
    const color = SPEAKER_COLORS[order.indexOf(seg.speaker) % SPEAKER_COLORS.length]
    turns.push({
      left: (seg.startSec / duration) * 100,
      width: (Math.max(0, seg.endSec - seg.startSec) / duration) * 100,
      color
    })
  }
  const names = transcript.speakers ?? {}
  const legend = order.slice(0, SPEAKER_COLORS.length).map((id, i) => ({
    name: names[id] || id,
    color: SPEAKER_COLORS[i]
  }))
  return { turns, legend }
}

/** Play/pause, position and a speaker-coloured timeline for the meeting's recording. */
export function AudioPlayer({
  audio,
  transcript
}: {
  audio: MeetingAudio
  transcript?: Transcript
}): JSX.Element {
  const { turns, legend } = useMemo(
    () => speakerTurns(transcript, audio.duration),
    [transcript, audio.duration]
  )
  const position = Math.min(audio.position, audio.duration)

  return (
    <section
      aria-label={strings.meeting.audioTitle}
      className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border-strong bg-surface px-4 py-3 shadow-float"
    >
      <IconButton
        variant="primary"
        label={audio.playing ? strings.meeting.audioPause : strings.meeting.audioPlay}
        onClick={audio.toggle}
        className="rounded-full"
      >
        {audio.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </IconButton>
      <span className="shrink-0 text-sm tabular-nums text-fg-muted">
        {formatDuration(position)} / {formatDuration(audio.duration)}
      </span>
      <div className="relative min-w-[200px] flex-1">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2"
        >
          {turns.map((turn, i) => (
            <span
              key={i}
              className="absolute top-0 h-full opacity-70"
              style={{ left: `${turn.left}%`, width: `${turn.width}%`, background: turn.color }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(audio.duration))}
          step={1}
          value={Math.round(position)}
          onChange={(e) => audio.seek(Number(e.target.value))}
          aria-label={strings.meeting.audioPosition}
          aria-valuetext={formatDuration(position)}
          className={cn(
            'relative block h-5 w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-runnable-track]:bg-transparent',
            '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface',
            '[&::-webkit-slider-thumb]:bg-fg [&::-webkit-slider-thumb]:shadow-card',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-full'
          )}
        />
      </div>
      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {legend.map((entry) => (
            <li key={entry.name} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: entry.color }}
              />
              {entry.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
