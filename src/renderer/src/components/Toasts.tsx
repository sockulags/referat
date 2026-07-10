import type { JSX } from 'react'
import { useApp } from '../store'
import { cn } from './ui/cn'
import { IconCheck, IconAlert } from './icons'

export function Toasts(): JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2 px-4 h-11 rounded-full shadow-float text-sm font-medium animate-pop-in',
            t.tone === 'error' ? 'bg-danger text-danger-fg' : 'bg-fg text-bg'
          )}
        >
          {t.tone === 'error' ? <IconAlert size={16} /> : <IconCheck size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  )
}
