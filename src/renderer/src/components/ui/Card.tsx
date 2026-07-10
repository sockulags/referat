import type { HTMLAttributes, JSX } from 'react'
import { cn } from './cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export function Card({ interactive, className, children, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-xl shadow-card',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-150 hover:border-border-strong hover:shadow-float',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
