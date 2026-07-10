// Registers every IPC handler in the RendererApi contract.

import { ipcMain, shell, app } from 'electron'
import type {
  MeetingMeta,
  MeetingDetail,
  RecordingHandle,
  AppSettings,
  SaveTranscriptionSettings,
  SaveSummarySettings,
  ConnectionTestResult
} from '../shared/types'
import { IPC } from './ipc'
import * as storage from './storage'
import * as settings from './settings'
import { enqueue, retryPipeline } from './pipeline'
import { exportProtocol, copyProtocol } from './export'
import { testTranscriptionConnection } from './providers/transcription'
import { testSummaryConnection } from './providers/summary'

/** Called after app is ready. Registers all handlers exactly once. */
export function registerIpcHandlers(): void {
  // ---- Meetings ----
  ipcMain.handle(IPC.listMeetings, (): MeetingMeta[] => storage.listMeetings())

  ipcMain.handle(IPC.getMeeting, (_e, id: string): MeetingDetail | null => storage.getMeeting(id))

  ipcMain.handle(IPC.deleteMeeting, (_e, id: string): void => storage.deleteMeeting(id))

  ipcMain.handle(IPC.renameMeeting, (_e, id: string, title: string): void =>
    storage.renameMeeting(id, title)
  )

  ipcMain.handle(IPC.retryPipeline, (_e, id: string): void => retryPipeline(id))

  // ---- Recording ----
  ipcMain.handle(IPC.startRecording, (_e, title: string): RecordingHandle => {
    const meta = storage.createMeeting(title)
    return { meetingId: meta.id }
  })

  ipcMain.handle(IPC.appendAudioChunk, (_e, meetingId: string, chunk: ArrayBuffer): Promise<void> =>
    storage.appendAudioChunk(meetingId, chunk)
  )

  ipcMain.handle(
    IPC.finishRecording,
    async (_e, meetingId: string, durationSec: number): Promise<void> => {
      await storage.finishRecording(meetingId, durationSec)
      enqueue(meetingId, 'full')
    }
  )

  ipcMain.handle(IPC.cancelRecording, (_e, meetingId: string): Promise<void> =>
    storage.cancelRecording(meetingId)
  )

  // ---- Settings ----
  ipcMain.handle(IPC.getSettings, (): AppSettings => settings.getSettings())

  ipcMain.handle(IPC.saveTranscriptionSettings, (_e, s: SaveTranscriptionSettings): void =>
    settings.saveTranscriptionSettings(s)
  )

  ipcMain.handle(IPC.saveSummarySettings, (_e, s: SaveSummarySettings): void =>
    settings.saveSummarySettings(s)
  )

  ipcMain.handle(
    IPC.saveGeneralSettings,
    (
      _e,
      s: {
        microphoneId?: string
        captureSystemAudio?: boolean
        theme?: AppSettings['theme']
        onboardingCompleted?: boolean
      }
    ): void => settings.saveGeneralSettings(s)
  )

  ipcMain.handle(IPC.testTranscriptionConnection, (): Promise<ConnectionTestResult> =>
    testTranscriptionConnection(settings.getTranscriptionConfig())
  )

  ipcMain.handle(IPC.testSummaryConnection, (): Promise<ConnectionTestResult> =>
    testSummaryConnection(settings.getSummaryConfig())
  )

  // ---- Export ----
  ipcMain.handle(
    IPC.exportProtocol,
    (_e, id: string, format: 'md' | 'docx'): Promise<{ savedTo: string | null }> =>
      exportProtocol(id, format)
  )

  ipcMain.handle(IPC.copyProtocol, (_e, id: string): void => copyProtocol(id))

  // ---- Misc ----
  ipcMain.handle(IPC.openExternal, (_e, url: string): Promise<void> => shell.openExternal(url))

  ipcMain.handle(IPC.getAppVersion, (): string => app.getVersion())
}
