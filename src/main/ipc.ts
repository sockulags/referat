// Central registry of IPC channel names (kebab-case) to avoid typos.
// Both the handler registration (main) and the preload bridge import these.

export const IPC = {
  // Meetings
  listMeetings: 'meetings:list',
  getMeeting: 'meetings:get',
  deleteMeeting: 'meetings:delete',
  renameMeeting: 'meetings:rename',
  retryPipeline: 'pipeline:retry',
  resummarize: 'pipeline:resummarize',
  generateSummary: 'summaries:generate',

  // Speakers
  renameSpeaker: 'speakers:rename',
  dismissSpeakerSuggestion: 'speakers:dismiss-suggestion',
  listSpeakerProfiles: 'speakers:list-profiles',
  deleteSpeakerProfile: 'speakers:delete-profile',
  deleteAllSpeakerProfiles: 'speakers:delete-all-profiles',

  // Glossary
  listGlossaryTerms: 'glossary:list',
  addGlossaryEntry: 'glossary:add',
  updateGlossaryTerm: 'glossary:update',
  deleteGlossaryTerm: 'glossary:delete',
  applyGlossary: 'glossary:apply',

  // Recording
  startRecording: 'recording:start',
  appendAudioChunk: 'recording:append-chunk',
  finishRecording: 'recording:finish',
  cancelRecording: 'recording:cancel',

  // Settings
  getSettings: 'settings:get',
  saveTranscriptionSettings: 'settings:save-transcription',
  saveSummarySettings: 'settings:save-summary',
  saveDiarizationSettings: 'settings:save-diarization',
  saveGeneralSettings: 'settings:save-general',
  testTranscriptionConnection: 'settings:test-transcription',
  testSummaryConnection: 'settings:test-summary',
  testDiarizationConnection: 'settings:test-diarization',
  listLocalAiComponents: 'local-ai:list',
  installLocalAiComponent: 'local-ai:install',
  removeLocalAiComponent: 'local-ai:remove',

  // Export
  exportProtocol: 'export:protocol',
  copyProtocol: 'export:copy',

  // Updates
  installUpdateNow: 'updater:install-now',

  // Misc
  openExternal: 'misc:open-external',
  getAppVersion: 'misc:app-version',

  // Events (main -> renderer)
  pipelineProgress: 'pipeline:progress',
  updateDownloaded: 'updater:downloaded',
  localAiComponentProgress: 'local-ai:progress'
} as const
