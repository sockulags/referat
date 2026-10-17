import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import { Wordmark, IconHome, IconDocument, IconSettings, IconSearch } from './icons'
import { cn } from './ui/cn'

/**
 * The app's main navigation. Views that own the whole window (recording,
 * onboarding) render without it.
 */
export function SideMenu(): JSX.Element {
  const view = useApp((s) => s.view)
  const meetingId = useApp((s) => s.meetingId)
  const navigate = useApp((s) => s.navigate)
  const [latestId, setLatestId] = useState<string | null>(null)

  // Meetings are listed newest first; refreshed whenever the user moves on,
  // which covers a recording that just finished.
  useEffect(() => {
    let cancelled = false
    void window.api.listMeetings().then((meetings) => {
      if (!cancelled) setLatestId(meetings[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [view, meetingId])

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
          icon={<IconDocument size={18} />}
          active={view === 'meeting' && meetingId === latestId}
          disabled={!latestId}
          onClick={() => latestId && navigate('meeting', latestId)}
        >
          {strings.nav.latestMeeting}
        </MenuItem>
        <MenuItem
          icon={<IconSearch size={18} />}
          active={view === 'search'}
          onClick={() => navigate('search')}
        >
          {strings.nav.search}
        </MenuItem>
        <div className="hidden flex-1 md:block" />
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
