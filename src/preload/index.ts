import { contextBridge, ipcRenderer } from 'electron'
import type {
  RendererApi,
  MeetingMeta,
  MeetingDetail,
  RecordingHandle,
  AppSettings,
  SaveTranscriptionSettings,
  SaveSummarySettings,
  ConnectionTestResult,
  PipelineProgressEvent,
  UpdateDownloadedEvent
} from '../shared/types'
import { IPC } from '../main/ipc'

const api: RendererApi = {
  // Meetings
  listMeetings: (): Promise<MeetingMeta[]> => ipcRenderer.invoke(IPC.listMeetings),
  getMeeting: (id: string): Promise<MeetingDetail | null> => ipcRenderer.invoke(IPC.getMeeting, id),
  deleteMeeting: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteMeeting, id),
  renameMeeting: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IPC.renameMeeting, id, title),
  retryPipeline: (id: string): Promise<void> => ipcRenderer.invoke(IPC.retryPipeline, id),

  // Recording
  startRecording: (title: string): Promise<RecordingHandle> =>
    ipcRenderer.invoke(IPC.startRecording, title),
  appendAudioChunk: (meetingId: string, chunk: ArrayBuffer, segmentIndex?: number): Promise<void> =>
    ipcRenderer.invoke(IPC.appendAudioChunk, meetingId, chunk, segmentIndex),
  finishRecording: (meetingId: string, durationSec: number): Promise<void> =>
    ipcRenderer.invoke(IPC.finishRecording, meetingId, durationSec),
  cancelRecording: (meetingId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.cancelRecording, meetingId),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  saveTranscriptionSettings: (s: SaveTranscriptionSettings): Promise<void> =>
    ipcRenderer.invoke(IPC.saveTranscriptionSettings, s),
  saveSummarySettings: (s: SaveSummarySettings): Promise<void> =>
    ipcRenderer.invoke(IPC.saveSummarySettings, s),
  saveGeneralSettings: (s: {
    microphoneId?: string
    captureSystemAudio?: boolean
    theme?: AppSettings['theme']
    onboardingCompleted?: boolean
  }): Promise<void> => ipcRenderer.invoke(IPC.saveGeneralSettings, s),
  testTranscriptionConnection: (): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke(IPC.testTranscriptionConnection),
  testSummaryConnection: (): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke(IPC.testSummaryConnection),

  // Export
  exportProtocol: (id: string, format: 'md' | 'docx'): Promise<{ savedTo: string | null }> =>
    ipcRenderer.invoke(IPC.exportProtocol, id, format),
  copyProtocol: (id: string): Promise<void> => ipcRenderer.invoke(IPC.copyProtocol, id),

  // Events
  onPipelineProgress: (cb: (e: PipelineProgressEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: PipelineProgressEvent): void =>
      cb(data)
    ipcRenderer.on(IPC.pipelineProgress, listener)
    return () => ipcRenderer.removeListener(IPC.pipelineProgress, listener)
  },
  onUpdateDownloaded: (cb: (e: UpdateDownloadedEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: UpdateDownloadedEvent): void =>
      cb(data)
    ipcRenderer.on(IPC.updateDownloaded, listener)
    return () => ipcRenderer.removeListener(IPC.updateDownloaded, listener)
  },

  // Updates
  installUpdateNow: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdateNow),

  // Misc
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion)
}

// Under sandbox:true a preload can only require('electron') + polyfilled node
// builtins — it must NOT require external npm modules (e.g. @electron-toolkit/
// preload), or the whole preload fails to load and window.api never appears.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
