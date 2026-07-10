import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import { cn } from './cn'
import { IconSpinner } from '../icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-[10px] ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'select-none whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none ' +
  'active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active shadow-card',
  secondary:
    'bg-surface text-fg border border-border-strong hover:bg-surface-2 hover:border-border-strong',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover shadow-card'
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  className,
  children,
  disabled,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <IconSpinner size={size === 'sm' ? 15 : 17} className="animate-spin-slow" />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  )
}

/** Square icon-only button. */
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  label: string
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  label,
  className,
  children,
  ...props
}: IconButtonProps): JSX.Element {
  const dims = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], dims, 'px-0', className)}
      {...props}
    >
      {children}
    </button>
  )
}
