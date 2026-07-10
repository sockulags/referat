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
  const restoreRef = useRef<HTMLElement | null>(null)
  // Keep the latest onClose without re-running the focus effect on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    // Remember what had focus so we can restore it when the dialog closes.
    restoreRef.current = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      // Trap Tab / Shift+Tab within the dialog.
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        panel?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel?.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    // Focus the first focusable element for keyboard users.
    focusable()[0]?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      // Restore focus to the element that opened the dialog.
      restoreRef.current?.focus?.()
    }
  }, [open])

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
        tabIndex={-1}
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
