import type { JSX } from 'react'
import type { MeetingStatus } from '../../../../shared/types'
import { strings } from '../../strings'
import { cn } from './cn'
import { IconCheck } from '../icons'

const STEPS: { key: string; label: string }[] = [
  { key: 'recorded', label: strings.meeting.steps.recorded },
  { key: 'transcribing', label: strings.meeting.steps.transcribing },
  { key: 'summarizing', label: strings.meeting.steps.summarizing },
  { key: 'done', label: strings.meeting.steps.done }
]

/** Index of the currently-active step for a given status. */
function activeIndex(status: MeetingStatus): number {
  switch (status) {
    case 'recording':
    case 'recorded':
      return 0
    case 'transcribing':
      return 1
    case 'summarizing':
      return 2
    case 'done':
      return 3
    case 'error':
      return -1
    default:
      return 0
  }
}

export function ProgressSteps({ status }: { status: MeetingStatus }): JSX.Element {
  const active = activeIndex(status)
  const isDone = status === 'done'

  return (
    <ol className="flex items-start">
      {STEPS.map((step, i) => {
        const complete = i < active || isDone
        const current = i === active && !isDone
        const isLast = i === STEPS.length - 1
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
