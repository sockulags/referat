import { useEffect } from 'react'
import { resolveStartTemplateId } from '../../shared/projects'
import { useApp } from './store'

/**
 * Starts recording a ticked calendar meeting when main says it has begun:
 * named after the meeting, in its series' project with that project's
 * template. The recording view shows the consent reminder as usual.
 */
export function useCalendarRecordings(): void {
  useEffect(
    () =>
      window.api.onCalendarRecordingDue((e) => {
        const { view, settings, setPendingTitle, setPendingStart, setCall, navigate } =
          useApp.getState()
        if (view === 'recording' || view === 'onboarding' || !settings) return
        void window.api.listProjects().then((projects) => {
          const project = projects.find((p) => p.id === e.projectId)
          const templateId = resolveStartTemplateId(settings.summary.templates, {
            project,
            lastUsed: settings.summary.defaultTemplateId
          })
          if (useApp.getState().view === 'recording') return
          setPendingTitle(e.title)
          setPendingStart({ templateId, projectId: project?.id ?? '' })
          setCall(undefined)
          navigate('recording')
        })
      }),
    []
  )
}
