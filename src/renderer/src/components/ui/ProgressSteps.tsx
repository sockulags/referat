import type { JSX } from 'react'
import type { MeetingStatus } from '../../../../shared/types'
import { strings } from '../../strings'
import { cn } from './cn'
import { IconCheck } from '../icons'

type StepKey = 'recorded' | 'transcribing' | 'diarizing' | 'summarizing' | 'done'

const BASE_STEPS: { key: StepKey; label: string }[] = [
  { key: 'recorded', label: strings.meeting.steps.recorded },
  { key: 'transcribing', label: strings.meeting.steps.transcribing },
  { key: 'summarizing', label: strings.meeting.steps.summarizing },
  { key: 'done', label: strings.meeting.steps.done }
]

/** Same steps with the optional diarizing step between transcribing and summarizing. */
const DIARIZING_STEPS: { key: StepKey; label: string }[] = [
  BASE_STEPS[0],
  BASE_STEPS[1],
  { key: 'diarizing', label: strings.meeting.steps.diarizing },
  BASE_STEPS[2],
  BASE_STEPS[3]
]

/** The step a given status belongs to, or null when no step is active. */
function stepKey(status: MeetingStatus): StepKey | null {
  switch (status) {
    case 'recording':
    case 'recorded':
      return 'recorded'
    case 'transcribing':
      return 'transcribing'
    case 'diarizing':
      return 'diarizing'
    case 'summarizing':
      return 'summarizing'
    case 'done':
      return 'done'
    case 'error':
      return null
  }
}

export function ProgressSteps({
  status,
  showDiarizing = false
}: {
  status: MeetingStatus
  /** Include the diarizing step; it is always shown while diarizing is active. */
  showDiarizing?: boolean
}): JSX.Element {
  const steps = showDiarizing || status === 'diarizing' ? DIARIZING_STEPS : BASE_STEPS
  const key = stepKey(status)
  const active = key === null ? -1 : steps.findIndex((s) => s.key === key)
  const isDone = status === 'done'

  return (
    <ol className="flex items-start">
      {steps.map((step, i) => {
        const complete = i < active || isDone
        const current = i === active && !isDone
        const isLast = i === steps.length - 1
        return (
          <li key={step.key} className="flex-1 flex flex-col items-center">
            <div className="flex items-center w-full">
              <div className="flex-1 h-px">
                {i > 0 && (
                  <div
                    className={cn(
                      'h-px w-full transition-colors duration-500',
                      i <= active || isDone ? 'bg-accent' : 'bg-border-strong'
                    )}
                  />
                )}
              </div>
              <div
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300',
                  complete
                    ? 'bg-accent border-accent text-accent-fg'
                    : current
                      ? 'border-accent text-accent bg-accent-soft'
                      : 'border-border-strong text-fg-subtle bg-surface'
                )}
              >
                {complete ? (
                  <IconCheck size={16} />
                ) : current ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-accent animate-breathe" />
                ) : (
                  <span className="text-xs font-semibold">{i + 1}</span>
                )}
              </div>
              <div className="flex-1 h-px">
                {!isLast && (
                  <div
                    className={cn(
                      'h-px w-full transition-colors duration-500',
                      i < active || isDone ? 'bg-accent' : 'bg-border-strong'
                    )}
                  />
                )}
              </div>
            </div>
            <span
              className={cn(
                'mt-2 text-xs font-medium text-center',
                complete || current ? 'text-fg' : 'text-fg-subtle'
              )}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
