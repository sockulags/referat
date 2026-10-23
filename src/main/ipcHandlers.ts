// Registers every IPC handler in the RendererApi contract.

import { ipcMain, app, clipboard } from 'electron'
import type { RendererApi } from '../shared/types'
import {
  applyDictationSettings,
  applySpeechModel,
  dictationMicrophone,
  listDictationMicrophones,
  syncDictationGlossary
} from './dictationService'
import { IPC, type InvokeName } from './ipc'
import * as storage from './storage'
import * as settings from './settings'
import * as speakerProfiles from './speakerProfiles'
import * as glossary from './glossary'
import * as dictationHistory from './dictationHistory'
import * as projects from './projects'
import * as projectSummary from './projectSummary'
import {
  applyGlossaryToMeeting,
  generateProjectOverview,
  enqueue,
  generateSummary,
  retryPipeline,
  resummarize
} from './pipeline'
import { exportProtocol, copyProtocol, exportActionItems, openFollowUpEmail } from './export'
import { extractActionItems, saveActionItems } from './actionItems'
import { searchMeetings } from './search'
import { applyOpenAtLogin } from './background'
import { testTranscriptionConnection, transcribeLiveWindow } from './providers/transcription'
import { testSummaryConnection } from './providers/summary'
import { testDiarizationConnection } from './providers/diarization'
import { openExternalSafe } from './security'
import * as calendar from './calendar'
import { applyNativeTheme, setTitleBarTheme } from './titleBar'
import {
  installLocalAiComponent,
  listLocalAiComponents,
  removeLocalAiComponent
} from './localAiComponents'

type Handler<K extends InvokeName> = (
  ...args: Parameters<RendererApi[K]>
) => ReturnType<RendererApi[K]> | Awaited<ReturnType<RendererApi[K]>>

/**
 * Register the handler for one RendererApi method. Its arguments and result
 * are checked against the contract the preload exposes. Handlers pass on
 * the arguments they name, so a stray extra argument from the renderer never
 * reaches a function with more optional parameters than the contract.
 */
function handle<K extends InvokeName>(name: K, fn: Handler<K>): void {
  ipcMain.handle(IPC[name], (_e, ...args) => fn(...(args as Parameters<RendererApi[K]>)))
}

/**
 * A glossary change reaches a running dictation engine too, so a word fixed
 * from the Diktat page is right in the very next dictation.
 */
function withDictationGlossary<T>(result: T): T {
  syncDictationGlossary().catch((error) =>
    console.error('Kunde inte skicka ordlistan till dikteringen', error)
  )
  return result
}

/** Called after app is ready. Registers all handlers exactly once. */
export function registerIpcHandlers(): void {
  // ---- Meetings ----
  handle('listMeetings', () => storage.listMeetings())
  handle('getMeeting', (id) => storage.getMeeting(id))
  handle('deleteMeeting', (id) => storage.deleteMeeting(id))
  handle('searchMeetings', (query, filter) => searchMeetings(query, filter))
  handle('renameMeeting', (id, title) => storage.renameMeeting(id, title))
  handle('retryPipeline', (id) => retryPipeline(id))
  handle('resummarize', (id) => resummarize(id))
  handle('generateSummary', (meetingId, templateId, focus) =>
    generateSummary(meetingId, templateId, focus)
  )
  handle('deleteSummary', (meetingId, summaryId) => storage.deleteSummary(meetingId, summaryId))
  handle('extractActionItems', (meetingId) => extractActionItems(meetingId))
  handle('updateActionItems', (meetingId, items) => saveActionItems(meetingId, items))
  handle('exportActionItems', (meetingId, format) => exportActionItems(meetingId, format))

  // ---- Speakers ----
  handle('renameSpeaker', (meetingId, speakerId, name) =>
    storage.renameSpeaker(meetingId, speakerId, name)
  )
  handle('dismissSpeakerSuggestion', (meetingId, speakerId) =>
    storage.dismissSpeakerSuggestion(meetingId, speakerId)
  )
  handle('listSpeakerProfiles', () => speakerProfiles.listSpeakerProfiles())
  handle('deleteSpeakerProfile', (id) => speakerProfiles.deleteSpeakerProfile(id))
  handle('deleteAllSpeakerProfiles', () => speakerProfiles.deleteAllSpeakerProfiles())

  // ---- Glossary ----
  handle('listGlossaryTerms', () => glossary.listGlossaryTerms())
  handle('addGlossaryEntry', (canonical, variant, projectId) =>
    withDictationGlossary(glossary.addGlossaryEntry(canonical, variant, projectId))
  )
  handle('updateGlossaryTerm', (id, patch) =>
    withDictationGlossary(glossary.updateGlossaryTerm(id, patch))
  )
  handle('deleteGlossaryTerm', (id) => withDictationGlossary(glossary.deleteGlossaryTerm(id)))
  handle('applyGlossary', (meetingId) => applyGlossaryToMeeting(meetingId))

  // ---- Projects ----
  handle('listProjects', () => projects.listProjects())
  handle('createProject', (name) => projects.createProject(name))
  handle('updateProject', (id, patch) => projects.updateProject(id, patch))
  handle('deleteProject', (id) => {
    // Meetings first: if this is interrupted, the project still exists and
    // the user can delete it again; the other way round would leave meetings
    // pointing at a project that is gone.
    storage.clearProject(id)
    glossary.deleteProjectTerms(id)
    projectSummary.deleteProjectSummaries(id)
    projects.deleteProject(id)
  })
  handle('setMeetingProject', (meetingId, projectId) => {
    if (projectId && !projects.getProject(projectId)) throw new Error('Projektet finns inte')
    storage.setMeetingProject(meetingId, projectId)
  })
  handle('listProjectSummaries', (projectId) => projectSummary.listProjectSummaries(projectId))
  handle('generateProjectSummary', (projectId, focus) => generateProjectOverview(projectId, focus))
  handle('deleteProjectSummary', (projectId, summaryId) =>
    projectSummary.deleteProjectSummary(projectId, summaryId)
  )
  handle('copyProjectSummary', (projectId, summaryId) => {
    const summary = projectSummary.listProjectSummaries(projectId).find((s) => s.id === summaryId)
    clipboard.writeText(summary?.markdown ?? '')
  })

  // ---- Recording ----
  handle('startRecording', (title, templateId, projectId) => {
    const project = projects.getProject(projectId)
    // Outside a project the chosen template becomes the preselection for
    // the next recording. A project keeps its own default instead, so one
    // odd meeting does not change what the next one starts with.
    if (templateId && !project) settings.setDefaultSummaryTemplate(templateId)
    const meta = storage.createMeeting(title, templateId, project?.id)
    return { meetingId: meta.id }
  })
  handle('appendAudioChunk', (meetingId, chunk, segmentIndex) =>
    storage.appendAudioChunk(meetingId, chunk, segmentIndex)
  )
  handle('finishRecording', async (meetingId, durationSec) => {
    await storage.finishRecording(meetingId, durationSec)
    enqueue(meetingId, 'full')
  })
  handle('saveLevelEnvelope', (meetingId, envelope) =>
    storage.writeLevelEnvelope(meetingId, envelope)
  )
  handle('cancelRecording', (meetingId) => storage.cancelRecording(meetingId))
  handle('transcribeLive', async (audio, meetingId) => {
    const config = settings.getTranscriptionConfig()
    // Checked here, not only in the renderer: this is what decides whether
    // audio leaves the computer while the meeting is still going on.
    if (!config.live) throw new Error('Live-transkribering är avstängd')
    const text = await transcribeLiveWindow(audio, config)
    const { transcript } = glossary.applyGlossary(
      { language: config.language, segments: [], text },
      glossary.termsForProject(meetingId ? storage.readMeta(meetingId)?.projectId : undefined)
    )
    return transcript.text
  })

  // ---- Settings ----
  handle('getSettings', () => settings.getSettings())
  handle('saveTranscriptionSettings', (s) => settings.saveTranscriptionSettings(s))
  handle('saveSummarySettings', (s) => settings.saveSummarySettings(s))
  handle('saveDiarizationSettings', (s) => settings.saveDiarizationSettings(s))
  handle('saveGeneralSettings', async (s) => {
    settings.saveGeneralSettings(s)
    if (s.openAtLogin !== undefined) applyOpenAtLogin(s.openAtLogin)
    if (s.theme !== undefined) applyNativeTheme()
    if (s.speechModel !== undefined) await applySpeechModel()
  })
  handle('saveDictationSettings', async (s) => {
    settings.saveDictationSettings(s)
    await applyDictationSettings(settings.getSettings().dictation)
  })
  handle('listDictationMicrophones', () => listDictationMicrophones())
  handle('getDictationMicrophone', () => dictationMicrophone())
  handle('listDictations', () => dictationHistory.listDictations())
  handle('deleteDictation', (id) => dictationHistory.deleteDictation(id))
  handle('clearDictations', () => dictationHistory.clearDictations())
  handle('testTranscriptionConnection', () =>
    testTranscriptionConnection(settings.getTranscriptionConfig())
  )
  handle('testSummaryConnection', () => testSummaryConnection(settings.getSummaryConfig()))
  handle('testDiarizationConnection', () =>
    testDiarizationConnection(settings.getDiarizationConfig())
  )
  handle('listLocalAiComponents', () => listLocalAiComponents())
  handle('installLocalAiComponent', (component) => installLocalAiComponent(component))
  handle('removeLocalAiComponent', (component) => removeLocalAiComponent(component))

  // ---- Export ----
  handle('exportProtocol', (id, format, summaryId) => exportProtocol(id, format, summaryId))
  handle('copyProtocol', (id, summaryId) => copyProtocol(id, summaryId))
  handle('openFollowUpEmail', (meetingId, summaryId) => openFollowUpEmail(meetingId, summaryId))

  // ---- Calendar ----
  handle('listCalendarEvents', () => calendar.listCalendarEvents())
  handle('getCalendarSelection', () => calendar.getCalendarSelection())
  handle('setCalendarMeetingRecorded', (event, recorded) =>
    calendar.setCalendarMeetingRecorded(event, recorded)
  )
  handle('setCalendarSeriesRecorded', (seriesId, recorded) =>
    calendar.setCalendarSeriesRecorded(seriesId, recorded)
  )
  handle('getNextCalendarRecording', () => calendar.getNextCalendarRecording())
  handle('keepCalendarRecording', () => calendar.keepCalendarRecording())

  // ---- Misc ----
  handle('openExternal', (url) => openExternalSafe(url))
  handle('setTitleBarTheme', (dark) => setTitleBarTheme(dark))
  handle('getAppVersion', () => app.getVersion())
}
