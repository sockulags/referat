import type { JSX, ReactNode } from 'react'
import type { MeetingStatus } from '../../../../shared/types'
import { strings } from '../../strings'
import { cn } from './cn'
import { IconCheck, IconAlert, IconMic, IconClock } from '../icons'

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'rec'

const ICON_SIZE = 13
const working = <IconClock size={ICON_SIZE} className="animate-breathe" />

const config: Record<MeetingStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  recording: { label: strings.status.recording, tone: 'rec', icon: <IconMic size={ICON_SIZE} /> },
  recorded: {
    label: strings.status.recorded,
    tone: 'neutral',
    icon: <IconCheck size={ICON_SIZE} />
  },
  transcribing: { label: strings.status.transcribing, tone: 'accent', icon: working },
  diarizing: { label: strings.status.diarizing, tone: 'accent', icon: working },
  summarizing: { label: strings.status.summarizing, tone: 'accent', icon: working },
  done: { label: strings.status.done, tone: 'success', icon: <IconCheck size={ICON_SIZE} /> },
  error: { label: strings.status.error, tone: 'danger', icon: <IconAlert size={ICON_SIZE} /> }
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  rec: 'bg-rec-soft text-rec'
}

export function StatusChip({ status }: { status: MeetingStatus }): JSX.Element {
  const c = config[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-xs font-medium',
        toneClasses[c.tone]
      )}
    >
      {c.icon}
      {c.label}
    </span>
  )
}
