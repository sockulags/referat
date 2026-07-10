import type { JSX } from 'react'
import { cn } from './ui/cn'

interface LevelMeterProps {
  /** 0..1 instantaneous level. */
  level: number
  label: string
  icon?: JSX.Element
  tone?: 'accent' | 'rec'
  /** Dim the meter when the source is unavailable. */
  muted?: boolean
}

const SEGMENTS = 32

/** Segmented, softly-breathing audio level meter. */
export function LevelMeter({
  level,
  label,
  icon,
  tone = 'accent',
  muted = false
}: LevelMeterProps): JSX.Element {
  const lit = Math.round(level * SEGMENTS)
  const fillClass = tone === 'rec' ? 'bg-rec' : 'bg-accent'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'flex items-end gap-[3px] h-10 px-3 rounded-[10px] bg-surface-2 border border-border',
          muted && 'opacity-40'
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-label={label}
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const on = i < lit
          // Height eases up toward the current level for a breathing feel.
          const h = on ? 30 + (i / SEGMENTS) * 55 : 16
          return (
            <span
              key={i}
              className={cn(
                'flex-1 rounded-full transition-all duration-100 ease-out',
                on ? fillClass : 'bg-border-strong/60'
              )}
              style={{ height: `${h}%`, opacity: on ? 0.55 + (i / SEGMENTS) * 0.45 : 0.5 }}
            />
          )
        })}
      </div>
    </div>
  )
}
