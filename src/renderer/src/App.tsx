import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useApp, applyTheme } from './store'
import { strings } from './strings'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/Toasts'
import { Home } from './views/Home'
import { Recording } from './views/Recording'
import { Meeting } from './views/Meeting'
import { Settings } from './views/Settings'
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

function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const settingsLoaded = useApp((s) => s.settingsLoaded)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const navigate = useApp((s) => s.navigate)

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

  if (!settingsLoaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={28} />
      </div>
    )
  }

  // The recording and onboarding views own the full frame (no chrome distractions).
  if (view === 'onboarding') {
    return (
      <div className="h-full overflow-y-auto">
        <Onboarding />
        <Toasts />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === 'home' && <Home />}
        {view === 'recording' && <Recording />}
        {view === 'meeting' && <Meeting />}
        {view === 'settings' && <Settings />}
      </main>
      <Toasts />
      <UpdateReadyToast />
    </div>
  )
}

export default App
