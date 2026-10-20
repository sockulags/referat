import { contextBridge, ipcRenderer } from 'electron'
import type {
  RendererApi,
  PipelineProgressEvent,
  UpdateDownloadedEvent,
  LocalAiComponentStatus,
  CallEvent,
  DictationEntry
} from '../shared/types'
import { IPC, type InvokeName } from '../main/ipc'

/** The RendererApi method that sends its arguments to the main-process handler. */
function invoke<K extends InvokeName>(name: K): RendererApi[K] {
  return ((...args: unknown[]) => ipcRenderer.invoke(IPC[name], ...args)) as RendererApi[K]
}

/** Subscribe to a main -> renderer event; the result unsubscribes. */
function listen<T>(channel: string): (cb: (e: T) => void) => () => void {
  return (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, data: T): void => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api: RendererApi = {
  // Meetings
  listMeetings: invoke('listMeetings'),
  getMeeting: invoke('getMeeting'),
  deleteMeeting: invoke('deleteMeeting'),
  searchMeetings: invoke('searchMeetings'),
  renameMeeting: invoke('renameMeeting'),
  retryPipeline: invoke('retryPipeline'),
  resummarize: invoke('resummarize'),
  generateSummary: invoke('generateSummary'),
  deleteSummary: invoke('deleteSummary'),
  extractActionItems: invoke('extractActionItems'),
  updateActionItems: invoke('updateActionItems'),
  exportActionItems: invoke('exportActionItems'),

  // Speakers
  renameSpeaker: invoke('renameSpeaker'),
  dismissSpeakerSuggestion: invoke('dismissSpeakerSuggestion'),
  listSpeakerProfiles: invoke('listSpeakerProfiles'),
  deleteSpeakerProfile: invoke('deleteSpeakerProfile'),
  deleteAllSpeakerProfiles: invoke('deleteAllSpeakerProfiles'),

  // Glossary
  listGlossaryTerms: invoke('listGlossaryTerms'),
  addGlossaryEntry: invoke('addGlossaryEntry'),
  updateGlossaryTerm: invoke('updateGlossaryTerm'),
  deleteGlossaryTerm: invoke('deleteGlossaryTerm'),
  applyGlossary: invoke('applyGlossary'),

  // Projects
  listProjects: invoke('listProjects'),
  createProject: invoke('createProject'),
  updateProject: invoke('updateProject'),
  deleteProject: invoke('deleteProject'),
  setMeetingProject: invoke('setMeetingProject'),
  listProjectSummaries: invoke('listProjectSummaries'),
  generateProjectSummary: invoke('generateProjectSummary'),
  deleteProjectSummary: invoke('deleteProjectSummary'),
  copyProjectSummary: invoke('copyProjectSummary'),

  // Recording
  startRecording: invoke('startRecording'),
  appendAudioChunk: invoke('appendAudioChunk'),
  saveLevelEnvelope: invoke('saveLevelEnvelope'),
  finishRecording: invoke('finishRecording'),
  cancelRecording: invoke('cancelRecording'),
  transcribeLive: invoke('transcribeLive'),

  // Settings
  getSettings: invoke('getSettings'),
  saveTranscriptionSettings: invoke('saveTranscriptionSettings'),
  saveSummarySettings: invoke('saveSummarySettings'),
  saveDiarizationSettings: invoke('saveDiarizationSettings'),
  saveGeneralSettings: invoke('saveGeneralSettings'),
  saveDictationSettings: invoke('saveDictationSettings'),
  listDictationMicrophones: invoke('listDictationMicrophones'),
  getDictationMicrophone: invoke('getDictationMicrophone'),
  listDictations: invoke('listDictations'),
  deleteDictation: invoke('deleteDictation'),
  clearDictations: invoke('clearDictations'),
  testTranscriptionConnection: invoke('testTranscriptionConnection'),
  testSummaryConnection: invoke('testSummaryConnection'),
  testDiarizationConnection: invoke('testDiarizationConnection'),
  listLocalAiComponents: invoke('listLocalAiComponents'),
  installLocalAiComponent: invoke('installLocalAiComponent'),
  removeLocalAiComponent: invoke('removeLocalAiComponent'),

  // Export
  exportProtocol: invoke('exportProtocol'),
  copyProtocol: invoke('copyProtocol'),
  openFollowUpEmail: invoke('openFollowUpEmail'),

  // Events
  onPipelineProgress: listen<PipelineProgressEvent>(IPC.pipelineProgress),
  onUpdateDownloaded: listen<UpdateDownloadedEvent>(IPC.updateDownloaded),
  onLocalAiComponentProgress: listen<LocalAiComponentStatus>(IPC.localAiComponentProgress),
  onCallDetected: listen<CallEvent>(IPC.callDetected),
  onDictationAdded: listen<DictationEntry>(IPC.dictationAdded),

  // Updates
  installUpdateNow: invoke('installUpdateNow'),

  // Misc
  openExternal: invoke('openExternal'),
  getAppVersion: invoke('getAppVersion')
}

// Under sandbox:true a preload can only require('electron') + polyfilled node
// builtins — it must NOT require external npm modules, or the whole preload
// fails to load and window.api never appears. The window always runs with
// contextIsolation, so the bridge is the only way in.
try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
