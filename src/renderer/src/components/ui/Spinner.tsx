import type { JSX } from 'react'
import { IconSpinner } from '../icons'
import { cn } from './cn'

export function Spinner({
  size = 20,
  className
}: {
  size?: number
  className?: string
}): JSX.Element {
  return <IconSpinner size={size} className={cn('animate-spin-slow text-fg-subtle', className)} />
}
