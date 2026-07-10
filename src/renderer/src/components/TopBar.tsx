import type { JSX } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import { Wordmark, IconSettings, IconArrowLeft } from './icons'
import { IconButton } from './ui/Button'
import { Tooltip } from './ui/Tooltip'

export function TopBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)

  const onHome = view === 'home'
  const isRecording = view === 'recording'
  const isOnboarding = view === 'onboarding'

  return (
    <header className="shrink-0 h-14 border-b border-border bg-bg/80 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl h-full px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!onHome && !isRecording && !isOnboarding && (
            <Tooltip label={strings.topbar.backHome} side="bottom">
              <IconButton
                label={strings.topbar.backHome}
                size="sm"
                onClick={() => navigate('home')}
              >
                <IconArrowLeft size={18} />
              </IconButton>
            </Tooltip>
          )}
          <button
            className="flex items-center gap-2 text-accent disabled:opacity-100"
            onClick={() => !isRecording && navigate('home')}
            disabled={isRecording || isOnboarding}
            aria-label={strings.app.name}
          >
            <Wordmark size={22} />
            <span className="text-[19px] font-semibold tracking-tight text-fg lowercase">
              {strings.app.name}
            </span>
          </button>
        </div>

        {!isRecording && !isOnboarding && (
          <Tooltip label={strings.topbar.settings} side="bottom">
            <IconButton
              label={strings.topbar.openSettings}
              onClick={() => navigate('settings')}
              className={view === 'settings' ? 'bg-surface-2 text-fg' : undefined}
            >
              <IconSettings size={20} />
            </IconButton>
          </Tooltip>
        )}
      </div>
    </header>
  )
}
