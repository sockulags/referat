import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { strings } from '../../strings'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { cn } from '../../components/ui/cn'
import {
  hotkeyFromKey,
  hotkeyFromMouse,
  hotkeyLabel,
  isModifierOnly,
  type CaughtHotkey
} from './hotkey'

/**
 * The dictation key: shown as the user reads it, changed by pressing the new
 * key or mouse button rather than typing its name. Esc leaves it as it was.
 */
export function HotkeyField({
  value,
  onChange
}: {
  value: string
  onChange: (hotkey: string) => void
}): JSX.Element {
  const d = strings.settings.dictation
  const [catching, setCatching] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!catching) return
    const take = (caught: CaughtHotkey): void => {
      if ('hotkey' in caught) {
        onChange(caught.hotkey)
        setProblem(null)
        setCatching(false)
      } else {
        setProblem(caught.error === 'needsModifier' ? d.hotkeyNeedsModifier : d.hotkeyUnsupported)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setProblem(null)
        setCatching(false)
        return
      }
      if (isModifierOnly(event.code)) return
      take(hotkeyFromKey(event))
    }
    const onMouse = (event: MouseEvent): void => {
      const caught = hotkeyFromMouse(event.button)
      if (!caught) return
      event.preventDefault()
      event.stopPropagation()
      take(caught)
    }
    // Capture, so nothing else on the page acts on the key or button first.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('auxclick', onMouse, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('auxclick', onMouse, true)
    }
  }, [catching, onChange, d])

  return (
    <Field label={d.hotkey} hint={problem ?? (catching ? d.hotkeyCatching : d.hotkeyHint)}>
      <div className="flex items-center gap-3">
        <kbd
          aria-live="polite"
          className={cn(
            'min-w-[96px] rounded-[10px] border px-3 py-2 text-sm font-medium',
            catching
              ? 'border-accent bg-surface-2 text-fg-muted'
              : 'border-border-strong bg-surface text-fg'
          )}
        >
          {catching ? d.hotkeyWaiting : hotkeyLabel(value) || '—'}
        </kbd>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setProblem(null)
            setCatching(!catching)
          }}
        >
          {catching ? strings.common.cancel : d.hotkeyChange}
        </Button>
      </div>
    </Field>
  )
}
