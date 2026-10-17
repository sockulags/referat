import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { cn } from './cn'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}

/**
 * Lightweight hover/focus tooltip — no external primitives. Focus shows it only
 * when the focus is visible, so a dialog moving focus to its close button
 * after a click does not pop the tooltip up.
 */
export function Tooltip({ label, children, side = 'top' }: TooltipProps): JSX.Element {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={(e) => setShow((e.target as Element).matches(':focus-visible'))}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={cn(
            'absolute left-1/2 -translate-x-1/2 z-40 whitespace-nowrap pointer-events-none',
            'px-2 py-1 rounded-md text-xs font-medium bg-fg text-bg shadow-float animate-fade-in',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}
