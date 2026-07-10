import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

/**
 * Move focus to a view's primary heading when it mounts, so keyboard and
 * screen-reader users land inside the new view instead of on <body> after a
 * navigation. Attach the returned ref to the heading and give it tabIndex={-1}
 * (keeps it out of the tab order). Programmatic focus does not trigger
 * :focus-visible, so mouse users see no outline — see main.css `:focus`.
 */
export function useAutofocusHeading<
  T extends HTMLElement = HTMLHeadingElement
>(): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return ref
}
