import type { JSX } from 'react'
import { cn } from './cn'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  id?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id
}: ToggleProps): JSX.Element {
  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-accent' : 'bg-border-strong'
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )

  if (!label && !description) return control

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {label}
          </label>
        )}
        {description && <p className="text-xs text-fg-muted leading-relaxed">{description}</p>}
      </div>
      {control}
    </div>
  )
}
