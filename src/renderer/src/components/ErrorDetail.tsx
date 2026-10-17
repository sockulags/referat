import type { JSX } from 'react'
import { cn } from './ui/cn'
import { strings } from '../strings'

/**
 * The technical side of an error, folded away behind "Visa detaljer". A native
 * <details>, so keyboard and screen-reader behaviour come with the element.
 */
export function ErrorDetail({
  detail,
  className
}: {
  detail: string
  className?: string
}): JSX.Element {
  return (
    <details className={cn('group', className)}>
      <summary className="w-fit cursor-pointer list-none rounded text-xs text-fg-subtle hover:text-fg-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <span className="group-open:hidden">{strings.common.showDetails}</span>
        <span className="hidden group-open:inline">{strings.common.hideDetails}</span>
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs text-fg-muted font-mono">
        {detail}
      </pre>
    </details>
  )
}
