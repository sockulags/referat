import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import type { CalendarEvent } from '../../../shared/types'
import { Wordmark, IconHome, IconSettings, IconSearch, IconMic, IconCalendar } from './icons'
import { cn } from './ui/cn'
import { when } from '../calendarTime'

/**
 * The app's main navigation. Views that own the whole window (recording,
 * onboarding) render without it.
 */
export function SideMenu(): JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  // Only for those who dictate: someone who just records meetings never sees it.
  const dictating = useApp((s) => s.settings?.dictation.enabled ?? false)

  return (
    <nav
      aria-label={strings.nav.label}
      className="shrink-0 border-b border-border bg-surface md:w-56 md:border-b-0 md:border-r"
    >
      <div className="flex h-full flex-row flex-wrap items-center gap-1 px-3 py-3 md:flex-col md:flex-nowrap md:items-stretch md:px-3 md:py-5">
        <div className="flex items-center gap-2 px-3 pb-0 text-accent md:pb-5">
          <Wordmark size={22} />
          <span className="text-[19px] font-semibold tracking-tight text-fg lowercase">
            {strings.app.name}
          </span>
        </div>
        <MenuItem
          icon={<IconHome size={18} />}
          active={view === 'home'}
          onClick={() => navigate('home')}
        >
          {strings.nav.home}
        </MenuItem>
        <MenuItem
          icon={<IconCalendar size={18} />}
          active={view === 'calendar'}
          onClick={() => navigate('calendar')}
        >
          {strings.nav.calendar}
        </MenuItem>
        <MenuItem
          icon={<IconSearch size={18} />}
          active={view === 'search'}
          onClick={() => navigate('search')}
        >
          {strings.nav.search}
        </MenuItem>
        {dictating && (
          <MenuItem
            icon={<IconMic size={18} />}
            active={view === 'dictations'}
            onClick={() => navigate('dictations')}
          >
            {strings.nav.dictations}
          </MenuItem>
        )}
        <div className="hidden flex-1 md:block" />
        <NextRecording onOpen={() => navigate('calendar')} />
        <MenuItem
          icon={<IconSettings size={18} />}
          active={view === 'settings'}
          onClick={() => navigate('settings')}
        >
          {strings.nav.settings}
        </MenuItem>
      </div>
    </nav>
  )
}

/**
 * The calendar meeting referat records next, so it is always in view what
 * will start by itself. Nothing when nothing is ticked.
 */
function NextRecording({ onOpen }: { onOpen: () => void }): JSX.Element | null {
  const [next, setNext] = useState<CalendarEvent | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      setNow(new Date())
      void window.api.getNextCalendarRecording().then((e) => active && setNext(e))
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    const unsubscribe = window.api.onCalendarChanged(refresh)
    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [])

  if (!next) return null
  const started = Date.parse(next.start) <= now.getTime()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'mb-2 hidden flex-col gap-0.5 rounded-[10px] border border-border px-3 py-2.5 text-left md:flex',
        'transition-colors hover:bg-surface-2',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rec" />
        {strings.nav.nextRecording}
      </span>
      <span className="truncate text-[13px] font-medium text-fg">
        {next.subject || strings.recording.untitled}
      </span>
      <span className="text-xs text-fg-muted">
        {started ? strings.nav.startsNow : when(next.start, now)}
      </span>
    </button>
  )
}

function MenuItem({
  icon,
  active,
  disabled,
  onClick,
  children
}: {
  icon: ReactNode
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50 disabled:pointer-events-none',
        active
          ? 'bg-accent-soft text-accent-soft-fg'
          : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      {icon}
      {children}
    </button>
  )
}
