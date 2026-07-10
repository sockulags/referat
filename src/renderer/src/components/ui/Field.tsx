import type {
  InputHTMLAttributes,
  JSX,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'
import { useId } from 'react'
import { cn } from './cn'
import { IconChevronDown } from '../icons'

const controlBase =
  'w-full bg-surface text-fg placeholder:text-fg-subtle border border-border-strong rounded-[10px] ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

/** Label + optional hint wrapper. */
export function Field({
  label,
  hint,
  htmlFor,
  children
}: {
  label?: string
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-fg-muted leading-relaxed">{hint}</p>}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: ReactNode
  iconLeft?: ReactNode
}

export function Input({ label, hint, iconLeft, className, id, ...props }: InputProps): JSX.Element {
  const autoId = useId()
  const inputId = id ?? autoId
  const control = (
    <div className="relative">
      {iconLeft && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none">
          {iconLeft}
        </span>
      )}
      <input
        id={inputId}
        className={cn(controlBase, 'h-10 px-3 text-sm', iconLeft ? 'pl-9' : undefined, className)}
        {...props}
      />
    </div>
  )
  if (!label && !hint) return control
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {control}
    </Field>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: ReactNode
}

export function Textarea({ label, hint, className, id, ...props }: TextareaProps): JSX.Element {
  const autoId = useId()
  const textId = id ?? autoId
  const control = (
    <textarea
      id={textId}
      className={cn(
        controlBase,
        'px-3 py-2.5 text-sm leading-relaxed resize-y min-h-24',
        className
      )}
      {...props}
    />
  )
  if (!label && !hint) return control
  return (
    <Field label={label} hint={hint} htmlFor={textId}>
      {control}
    </Field>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: ReactNode
}

export function Select({
  label,
  hint,
  className,
  id,
  children,
  ...props
}: SelectProps): JSX.Element {
  const autoId = useId()
  const selectId = id ?? autoId
  const control = (
    <div className="relative">
      <select
        id={selectId}
        className={cn(
          controlBase,
          'h-10 pl-3 pr-9 text-sm appearance-none cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown
        size={18}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
      />
    </div>
  )
  if (!label && !hint) return control
  return (
    <Field label={label} hint={hint} htmlFor={selectId}>
      {control}
    </Field>
  )
}
