// Shared types for the IPC contract between main, preload and renderer.
// This file is the single source of truth — both sides import from here.

// ---------- Meetings ----------

export type MeetingStatus =
  'recording' | 'recorded' | 'transcribing' | 'summarizing' | 'done' | 'error'

export interface MeetingMeta {
  id: string
  title: string
  createdAt: string // ISO 8601
  durationSec: number
  status: MeetingStatus
  /** Present when status === 'error'. Plain-language message + raw detail. */
  error?: { message: string; detail?: string; failedStep: 'transcribe' | 'summarize' }
}

export interface TranscriptSegment {
  startSec: number
  endSec: number
  text: string
}

export interface Transcript {
  language: string
  segments: TranscriptSegment[]
  /** Full text joined from segments, for convenience/search. */
  text: string
}

export interface MeetingDetail extends MeetingMeta {
  transcript?: Transcript
  /** Markdown protocol produced by the summary provider. */
  protocol?: string
}

// ---------- Settings & providers ----------

export type TranscriptionPreset = 'local' | 'openai' | 'azure' | 'custom'
export type SummaryPreset = 'local' | 'openai' | 'azure' | 'anthropic' | 'custom'

export interface TranscriptionSettings {
  preset: TranscriptionPreset
  /** Base URL, e.g. http://localhost:8000/v1 or https://api.openai.com/v1 */
  baseUrl: string
  /** Model name, e.g. 'whisper-1' or 'KBLab/kb-whisper-large' */
  model: string
  /** ISO language hint, e.g. 'sv'. Empty string = auto-detect. */
  language: string
  /** True if an API key has been saved (the key itself never crosses to renderer). */
  hasApiKey: boolean
}

export interface SummarySettings {
  preset: SummaryPreset
  /** 'openai-compatible' covers OpenAI, Azure, Ollama, internal servers. */
  apiFlavor: 'openai-compatible' | 'anthropic'
  baseUrl: string
  model: string
  hasApiKey: boolean
  /** Markdown prompt template. {{transcript}} is replaced with the transcript text. */
  promptTemplate: string
}

export interface AppSettings {
  transcription: TranscriptionSettings
  summary: SummarySettings
  /** Preferred input device id ('' = system default). */
  microphoneId: string
  /** Whether to capture system audio (loopback) in addition to the microphone. */
  captureSystemAudio: boolean
  theme: 'system' | 'light' | 'dark'
  onboardingCompleted: boolean
}

/** Payload when saving settings. Include apiKey only to overwrite the stored key. */
export interface SaveTranscriptionSettings extends Omit<TranscriptionSettings, 'hasApiKey'> {
  apiKey?: string
}
export interface SaveSummarySettings extends Omit<SummarySettings, 'hasApiKey'> {
  apiKey?: string
}

export interface ConnectionTestResult {
  ok: boolean
  /** Plain-language Swedish message suitable for direct display. */
  message: string
  /** Raw technical detail behind "visa detaljer". */
  detail?: string
}

// ---------- Recording ----------

export interface RecordingHandle {
  meetingId: string
}

// ---------- Pipeline progress events (main -> renderer) ----------

export interface PipelineProgressEvent {
  meetingId: string
  status: MeetingStatus
  /** 0..1 within the current step, if known. */
  progress?: number
}

// ---------- The preload API surface ----------

export interface RendererApi {
  // Meetings
  listMeetings(): Promise<MeetingMeta[]>
  getMeeting(id: string): Promise<MeetingDetail | null>
  deleteMeeting(id: string): Promise<void>
  renameMeeting(id: string, title: string): Promise<void>
  /** Re-run the pipeline after an error, from the failed step. */
  retryPipeline(id: string): Promise<void>

  // Recording: renderer captures & encodes; main persists chunks.
  startRecording(title: string): Promise<RecordingHandle>
  /** segmentIndex identifies the rotated segment file; defaults to 0. */
  appendAudioChunk(meetingId: string, chunk: ArrayBuffer, segmentIndex?: number): Promise<void>
  /** Finalize: closes file, sets duration, kicks off the pipeline. */
  finishRecording(meetingId: string, durationSec: number): Promise<void>
  cancelRecording(meetingId: string): Promise<void>

  // Settings
  getSettings(): Promise<AppSettings>
  saveTranscriptionSettings(s: SaveTranscriptionSettings): Promise<void>
  saveSummarySettings(s: SaveSummarySettings): Promise<void>
  saveGeneralSettings(s: {
    microphoneId?: string
    captureSystemAudio?: boolean
    theme?: AppSettings['theme']
    onboardingCompleted?: boolean
  }): Promise<void>
  testTranscriptionConnection(): Promise<ConnectionTestResult>
  testSummaryConnection(): Promise<ConnectionTestResult>

  // Export
  exportProtocol(id: string, format: 'md' | 'docx'): Promise<{ savedTo: string | null }>
  copyProtocol(id: string): Promise<void>

  // Events
  onPipelineProgress(cb: (e: PipelineProgressEvent) => void): () => void

  // Misc
  openExternal(url: string): Promise<void>
  getAppVersion(): Promise<string>
}
