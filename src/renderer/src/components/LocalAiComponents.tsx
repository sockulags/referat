import type { JSX } from 'react'
import type { LocalAiComponent } from '../../../shared/types'
import { strings } from '../strings'
import { Button } from './ui/Button'
import type { LocalAiManager } from './useLocalAiComponents'

/** One component: install it, follow the download, or remove it again. */
export function ComponentInstallCard({
  component,
  title,
  description,
  detail,
  manager,
  removable = true
}: {
  component: LocalAiComponent
  title: string
  description: string
  detail?: string
  manager: LocalAiManager
  /** false shows an installed component as done instead of offering to remove it. */
  removable?: boolean
}): JSX.Element {
  const status = manager.statuses.find((item) => item.component === component)
  const busy = status?.state === 'downloading' || status?.state === 'installing'
  const installed = status?.state === 'installed' || status?.state === 'running'

  return (
    <div className="rounded-xl border border-border-strong bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{description}</p>
          {detail && <p className="mt-1 text-xs text-fg-subtle">{detail}</p>}
          {status?.message && <p className="mt-1 text-xs text-accent">{status.message}</p>}
          {status?.detail && <p className="mt-1 text-xs text-danger">{status.detail}</p>}
        </div>
        {installed && !removable ? (
          <Button variant="secondary" size="sm" disabled>
            Installerad
          </Button>
        ) : installed ? (
          <Button variant="ghost" size="sm" onClick={() => void manager.remove(component)}>
            {strings.common.delete}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() => void manager.install(component)}
          >
            Installera
          </Button>
        )}
      </div>
      {busy && status?.progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round(status.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
