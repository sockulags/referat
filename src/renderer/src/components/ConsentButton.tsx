import type { JSX } from 'react'
import { useState } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import { Button } from './ui/Button'
import { IconCheck, IconCopy } from './icons'

/**
 * Copies the user's text about the recording, ready to paste into the
 * meeting's chat. Nothing to copy, nothing shown.
 */
export function ConsentButton({ size = 'sm' }: { size?: 'sm' | 'md' }): JSX.Element | null {
  const message = useApp((s) => s.settings?.consentMessage ?? '')
  const toast = useApp((s) => s.toast)
  const [copied, setCopied] = useState(false)
  if (!message.trim()) return null

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast(strings.consent.copyFailed, 'error')
    }
  }

  return (
    <Button
      variant="secondary"
      size={size}
      onClick={() => void copy()}
      iconLeft={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
    >
      {copied ? strings.consent.copied : strings.consent.copy}
    </Button>
  )
}
