// Renderer state: the tiny router + app-wide settings/theme. No react-router.
import { create } from 'zustand'
import type { AppSettings, CallApp } from '../../shared/types'

type View = 'home' | 'recording' | 'meeting' | 'settings' | 'onboarding' | 'search' | 'dictations'

/** Where a meeting opens: a tab, and in the transcript a moment to go to. */
export interface MeetingFocus {
  tab: 'protocol' | 'transcript'
  atSec?: number
}

/** The tabs of the settings page. */
export type SettingsTab = 'general' | 'speech' | 'meetings' | 'dictation' | 'ai' | 'glossary'

/** Which meetings Home lists: all of them, those outside any project, or one project's id. */
export type ProjectFilter = 'all' | 'none' | (string & {})

const FILTER_KEY = 'referat.projectFilter'

/** The remembered filter is a convenience: unavailable storage just means 'all'. */
function readFilter(): ProjectFilter {
  try {
    return window.localStorage.getItem(FILTER_KEY) || 'all'
  } catch {
    return 'all'
  }
}

function writeFilter(filter: ProjectFilter): void {
  try {
    window.localStorage.setItem(FILTER_KEY, filter)
  } catch {
    /* not remembered, nothing else lost */
  }
}

interface Toast {
  id: number
  message: string
  tone: 'success' | 'error'
}

interface AppState {
  view: View
  meetingId?: string
  /** Title carried from Home into the recording flow. */
  pendingTitle: string
  /**
   * The template the user picked on Home. '' = not picked, so the project's
   * default (or the last used one) applies. Cleared when the project changes.
   */
  pendingTemplateId: string
  /** What the recording starts with, resolved on Home when Start is pressed. */
  pendingStart: { templateId: string; projectId: string }
  projectFilter: ProjectFilter
  settings?: AppSettings
  toasts: Toast[]
  /** Set by openMeetingAt, read once by the meeting view. */
  meetingFocus?: MeetingFocus
  /** A call going on in a meeting app, which Home offers to record. */
  call?: CallApp
  settingsTab: SettingsTab

  navigate: (view: View, meetingId?: string) => void
  /** Open a meeting at a tab and, in the transcript, at a moment. */
  openMeetingAt: (meetingId: string, focus: MeetingFocus) => void
  clearMeetingFocus: () => void
  setCall: (call: CallApp | undefined) => void
  /** Open the settings page at a tab. */
  openSettings: (tab: SettingsTab) => void
  setSettingsTab: (tab: SettingsTab) => void
  setPendingTitle: (title: string) => void
  setPendingTemplateId: (templateId: string) => void
  setPendingStart: (start: { templateId: string; projectId: string }) => void
  setProjectFilter: (filter: ProjectFilter) => void
  setSettings: (settings: AppSettings) => void
  patchSettings: (partial: Partial<AppSettings>) => void
  toast: (message: string, tone?: Toast['tone']) => void
}

let toastSeq = 0

export const useApp = create<AppState>((set) => ({
  view: 'home',
  meetingId: undefined,
  pendingTitle: '',
  pendingTemplateId: '',
  pendingStart: { templateId: '', projectId: '' },
  projectFilter: readFilter(),
  settings: undefined,
  toasts: [],
  settingsTab: 'general',

  navigate: (view, meetingId): void => set({ view, meetingId, meetingFocus: undefined }),
  openMeetingAt: (meetingId, meetingFocus): void =>
    set({ view: 'meeting', meetingId, meetingFocus }),
  clearMeetingFocus: (): void => set({ meetingFocus: undefined }),
  setCall: (call): void => set({ call }),
  openSettings: (settingsTab): void =>
    set({ view: 'settings', settingsTab, meetingId: undefined, meetingFocus: undefined }),
  setSettingsTab: (settingsTab): void => set({ settingsTab }),
  setPendingTitle: (pendingTitle): void => set({ pendingTitle }),
  setPendingTemplateId: (pendingTemplateId): void => set({ pendingTemplateId }),
  setPendingStart: (pendingStart): void => set({ pendingStart }),
  setProjectFilter: (projectFilter): void => {
    writeFilter(projectFilter)
    // A pick made for one project should not carry over to the next.
    set({ projectFilter, pendingTemplateId: '' })
  },
  setSettings: (settings): void => set({ settings }),
  patchSettings: (partial): void =>
    set((s) => (s.settings ? { settings: { ...s.settings, ...partial } } : {})),
  toast: (message, tone = 'success'): void => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2600)
  }
}))

/** Resolve settings theme to a concrete 'light' | 'dark' and apply to <html>. */
export function applyTheme(theme: AppSettings['theme']): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}
