import type { JSX } from 'react'
import { useEffect } from 'react'
import { useApp, applyTheme } from './store'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/Toasts'
import { Home } from './views/Home'
import { Recording } from './views/Recording'
import { Meeting } from './views/Meeting'
import { Settings } from './views/Settings'
import { Onboarding } from './views/Onboarding'
import { Spinner } from './components/ui/Spinner'

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
    </div>
  )
}

export default App
