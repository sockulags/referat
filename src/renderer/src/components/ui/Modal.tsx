import type { JSX, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'
import { IconButton } from './Button'
import { IconX } from '../icons'
import { strings } from '../../strings'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** Max width class, defaults to a comfortable dialog width. */
  widthClass?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  widthClass = 'max-w-md'
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Focus the first focusable element for keyboard users.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          'relative w-full bg-surface border border-border rounded-2xl shadow-float animate-pop-in',
          widthClass
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <IconButton label={strings.common.close} size="sm" onClick={onClose}>
              <IconX size={18} />
            </IconButton>
          </div>
        )}
        <div className={cn('px-5', title ? 'pb-1' : 'pt-5 pb-1')}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
