import type { JSX } from 'react'
import type { MeetingStatus } from '../../../../shared/types'
import { strings } from '../../strings'
import { cn } from './cn'
import { IconCheck, IconAlert, IconMic, IconClock } from '../icons'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'rec'

const config: Record<
  MeetingStatus,
  { label: string; tone: Tone; icon: 'dot' | 'check' | 'alert' | 'mic' | 'clock'; pulse?: boolean }
> = {
  recording: { label: strings.status.recording, tone: 'rec', icon: 'mic', pulse: true },
  recorded: { label: strings.status.recorded, tone: 'neutral', icon: 'check' },
  transcribing: { label: strings.status.transcribing, tone: 'accent', icon: 'clock', pulse: true },
  summarizing: { label: strings.status.summarizing, tone: 'accent', icon: 'clock', pulse: true },
  done: { label: strings.status.done, tone: 'success', icon: 'check' },
  error: { label: strings.status.error, tone: 'danger', icon: 'alert' }
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  rec: 'bg-rec-soft text-rec'
}

export function StatusChip({ status }: { status: MeetingStatus }): JSX.Element {
  const c = config[status]
  const iconSize = 13
  const icon =
    c.icon === 'check' ? (
      <IconCheck size={iconSize} />
    ) : c.icon === 'alert' ? (
      <IconAlert size={iconSize} />
    ) : c.icon === 'mic' ? (
      <IconMic size={iconSize} />
    ) : c.icon === 'clock' ? (
      <IconClock size={iconSize} className={c.pulse ? 'animate-breathe' : undefined} />
    ) : null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-xs font-medium',
        toneClasses[c.tone]
      )}
    >
      {icon}
      {c.label}
    </span>
  )
}
