import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useApp, applyTheme } from './store'
import { strings } from './strings'
import { SideMenu } from './components/SideMenu'
import { Toasts } from './components/Toasts'
import { Home } from './views/Home'
import { Recording } from './views/Recording'
import { Meeting } from './views/Meeting'
import { Settings } from './views/Settings'
import { Search } from './views/Search'
import { Dictations } from './views/Dictations'
import { Onboarding } from './views/Onboarding'
import { Spinner } from './components/ui/Spinner'

/**
 * Calm, persistent banner shown once an update has downloaded. It never appears
 * over the recording view (would interrupt a live meeting); because the ready
 * flag lives in state, leaving the recording view reveals it automatically.
 */
function UpdateReadyToast(): JSX.Element | null {
  const view = useApp((s) => s.view)
  const [ready, setReady] = useState(false)

  useEffect(() => window.api.onUpdateDownloaded(() => setReady(true)), [])

  if (!ready || view === 'recording') return null

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 pl-4 pr-2 h-11 rounded-full shadow-float bg-fg text-bg text-sm font-medium animate-pop-in">
      <span>{strings.update.ready}</span>
      <button
        type="button"
        onClick={() => void window.api.installUpdateNow()}
        className="px-3 h-8 rounded-full bg-bg/15 hover:bg-bg/25 transition-colors font-semibold"
      >
        {strings.update.restartNow}
      </button>
    </div>
  )
}

/**
 * The top of the window, drawn by referat instead of Windows so it is one piece
 * with the app. It is a transparent drag area: the side menu runs up under it
 * and the content starts below it (below-title-bar). Windows still draws the
 * window buttons over its right end (titleBarOverlay in the main process).
 */
function TitleBar(): JSX.Element {
  return <div className="title-bar" />
}

/** A view with the title bar laid over its top. */
function Frame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="relative h-full">
      {children}
      <TitleBar />
    </div>
  )
}

function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const navigate = useApp((s) => s.navigate)
  const setCall = useApp((s) => s.setCall)

  // A call in a meeting app: Home offers to record it until it ends.
  useEffect(
    () =>
      window.api.onCallDetected((e) => {
        if (e.active) setCall(e.app)
        else if (useApp.getState().call === e.app) setCall(undefined)
      }),
    [setCall]
  )

  // A dictation notification was clicked: show the dictation settings.
  const openSettings = useApp((s) => s.openSettings)
  useEffect(
    () => window.api.onOpenDictationSettings(() => openSettings('dictation')),
    [openSettings]
  )

  // Load settings once, resolve theme and route to onboarding on first launch.
  useEffect(() => {
    let cancelled = false
    void window.api.getSettings().then((s) => {
      if (cancelled) return
      setSettings(s)
      applyTheme(s.theme)
      if (!s.onboardingCompleted) navigate('onboarding')
    })
    return () => {
      cancelled = true
    }
  }, [setSettings, navigate])

  // Keep 'system' theme in sync with OS changes.
  useEffect(() => {
    if (settings?.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings?.theme])

  if (!settings) {
    return (
      <Frame>
        <div className="h-full flex items-center justify-center">
          <Spinner size={28} />
        </div>
      </Frame>
    )
  }

  // The recording and onboarding views own the full frame (no chrome distractions).
  if (view === 'onboarding') {
    return (
      <Frame>
        <div className="below-title-bar h-[calc(100%-var(--title-bar-height))] overflow-y-auto">
          <Onboarding />
          <Toasts />
        </div>
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="h-full flex flex-col overflow-hidden md:flex-row">
        {view !== 'recording' && <SideMenu />}
        <main className="below-title-bar flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          {view === 'home' && <Home />}
          {view === 'recording' && <Recording />}
          {view === 'meeting' && <Meeting />}
          {view === 'settings' && <Settings />}
          {view === 'search' && <Search />}
          {view === 'dictations' && <Dictations />}
        </main>
        <Toasts />
        <UpdateReadyToast />
      </div>
    </Frame>
  )
}

export default App
