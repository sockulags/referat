// Renderer state: the tiny router + app-wide settings/theme. No react-router.
import { create } from 'zustand'
import type { AppSettings } from '../../shared/types'

export type View = 'home' | 'recording' | 'meeting' | 'settings' | 'onboarding'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'error'
}

interface AppState {
  view: View
  meetingId?: string
  /** Title carried from Home into the recording flow. */
  pendingTitle: string
  settings?: AppSettings
  settingsLoaded: boolean
  toasts: Toast[]

  navigate: (view: View, meetingId?: string) => void
  openMeeting: (meetingId: string) => void
  setPendingTitle: (title: string) => void
  setSettings: (settings: AppSettings) => void
  patchSettings: (partial: Partial<AppSettings>) => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useApp = create<AppState>((set) => ({
  view: 'home',
  meetingId: undefined,
  pendingTitle: '',
  settings: undefined,
  settingsLoaded: false,
  toasts: [],

  navigate: (view, meetingId): void => set({ view, meetingId }),
  openMeeting: (meetingId): void => set({ view: 'meeting', meetingId }),
  setPendingTitle: (pendingTitle): void => set({ pendingTitle }),
  setSettings: (settings): void => set({ settings, settingsLoaded: true }),
  patchSettings: (partial): void =>
    set((s) => (s.settings ? { settings: { ...s.settings, ...partial } } : {})),
  toast: (message, tone = 'success'): void => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2600)
  },
  dismissToast: (id): void => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Resolve settings theme to a concrete 'light' | 'dark' and apply to <html>. */
export function applyTheme(theme: AppSettings['theme']): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}
