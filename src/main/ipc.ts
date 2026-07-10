// Central registry of IPC channel names (kebab-case) to avoid typos.
// Both the handler registration (main) and the preload bridge import these.

export const IPC = {
  // Meetings
  listMeetings: 'meetings:list',
  getMeeting: 'meetings:get',
  deleteMeeting: 'meetings:delete',
  renameMeeting: 'meetings:rename',
  retryPipeline: 'pipeline:retry',

  // Recording
  startRecording: 'recording:start',
  appendAudioChunk: 'recording:append-chunk',
  finishRecording: 'recording:finish',
  cancelRecording: 'recording:cancel',

  // Settings
  getSettings: 'settings:get',
  saveTranscriptionSettings: 'settings:save-transcription',
  saveSummarySettings: 'settings:save-summary',
  saveGeneralSettings: 'settings:save-general',
  testTranscriptionConnection: 'settings:test-transcription',
  testSummaryConnection: 'settings:test-summary',

  // Export
  exportProtocol: 'export:protocol',
  copyProtocol: 'export:copy',

  // Misc
  openExternal: 'misc:open-external',
  getAppVersion: 'misc:app-version',

  // Events (main -> renderer)
  pipelineProgress: 'pipeline:progress'
} as const
