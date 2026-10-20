import type { JSX } from 'react'
import { useApp } from '../../store'
import { Button } from '../../components/ui/Button'

/** A way to the speech recognition tab, from a tab that depends on it. */
export function OpenSpeechTab({ label }: { label: string }): JSX.Element {
  const setSettingsTab = useApp((s) => s.setSettingsTab)
  return (
    <div>
      <Button variant="secondary" size="sm" onClick={() => setSettingsTab('speech')}>
        {label}
      </Button>
    </div>
  )
}
