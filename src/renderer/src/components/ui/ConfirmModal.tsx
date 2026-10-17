import type { JSX, ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { strings } from '../../strings'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** What will happen, shown as the dialog's text. */
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
}

/** Ask before something that cannot be undone: cancel closes, the danger button goes ahead. */
export function ConfirmModal({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  cancelLabel = strings.common.cancel,
  onConfirm
}: ConfirmModalProps): JSX.Element | null {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted leading-relaxed">{children}</p>
    </Modal>
  )
}
