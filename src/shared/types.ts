// Shared types for the IPC contract between main, preload and renderer.
// This file is the single source of truth — both sides import from here.

import type { LevelEnvelope } from './levels'

// ---------- Meetings ----------

export type MeetingStatus =
  'recording' | 'recorded' | 'transcribing' | 'diarizing' | 'summarizing' | 'done' | 'error'

export interface MeetingMeta {
  id: string
  title: string
  createdAt: string // ISO 8601
  durationSec: number
  status: MeetingStatus
  /**
   * Template chosen when the recording started, used for the summary the
   * pipeline produces on its own. Absent on meetings recorded before templates
   * existed, which fall back to the default template.
   */
  templateId?: string
  /** The project the meeting belongs to. Absent = "Utan projekt". */
  projectId?: string
  /** Present when status === 'error'. Plain-language message + raw detail. */
  error?: { message: string; detail?: string; failedStep: 'transcribe' | 'summarize' }
  /**
   * Non-fatal problem from the last pipeline run (e.g. speaker identification
   * failed but the protocol still arrived). Plain-language message + raw detail.
   */
  warning?: { message: string; detail?: string }
}

export interface TranscriptSegment {
  startSec: number
  endSec: number
  text: string
  /** Canonical speaker id ('S1', 'S2', …) when diarization ran. */
  speaker?: string
  /**
   * What the transcription provider actually returned, kept only on segments
   * the glossary rewrote. Correcting a transcript must stay reversible, and
   * re-applying always starts from this text — never from a previous result.
   */
  originalText?: string
}

export interface Transcript {
  language: string
  segments: TranscriptSegment[]
  /** Full text joined from segments, for convenience/search. */
  text: string
  /** Speaker id -> display name ('S1' -> 'Talare 1' or a user-chosen name). */
  speakers?: Record<string, string>
  /**
   * Speaker id -> voice embedding from the diarization server. Only present
   * when voice recognition is enabled (biometric data — see produkt.md).
   */
  speakerEmbeddings?: Record<string, number[]>
  /** Speaker id -> suggested display name from voice recognition ("Anna?"). */
  speakerSuggestions?: Record<string, string>
  /**
   * Where each recorded audio segment starts on the meeting's timeline, in
   * seconds. Absent on transcripts made before playback existed.
   */
  segmentStartsSec?: number[]
  /** Uncorrected full text, kept only when the glossary rewrote something. */
  originalText?: string
  /** Number of glossary replacements in the last apply. Absent means none. */
  glossaryHits?: number
}

/**
 * One entry in the glossary: the correct spelling plus every misheard form
 * that should become it. Several variants per term is the normal case — the
 * same word comes out differently depending on who is speaking.
 */
export interface GlossaryTerm {
  id: string
  /** The correct spelling, written to the transcript verbatim. */
  canonical: string
  /** Misheard forms. Matched case-insensitively, spaces and hyphens alike. */
  variants: string[]
  /** ISO 8601 timestamp of the last edit. */
  updatedAt: string
  /**
   * The project this term belongs to. Absent = every meeting. A project's
   * meetings get the global terms plus their own.
   */
  projectId?: string
}

/** A locally stored voice profile (the embedding itself never crosses IPC). */
export interface SpeakerProfile {
  id: string
  name: string
  /** ISO 8601 timestamp of the last meeting that updated this profile. */
  updatedAt: string
  /** Number of meetings that have contributed to the voice profile. */
  sampleCount: number
}

/**
 * A named prompt template. Global and shared by every meeting, like the
 * glossary — the same "Uppföljningsmejl" should mean the same thing everywhere.
 */
export interface SummaryTemplate {
  id: string
  /** Shown in every picker and used to name the summary's file. */
  name: string
  /** Markdown prompt. {{transcript}}, {{ordlista}} and {{fokus}} are replaced. */
  promptTemplate: string
  /** Seeded by the app: editable, but never deletable. */
  builtIn: boolean
}

/** One generated summary of a meeting. The markdown lives in its own file. */
export interface MeetingSummary {
  id: string
  /** File inside the meeting folder, e.g. 'protocol-uppfoljningsmejl.md'. */
  fileName: string
  /** Template it came from. May point at a template since deleted. */
  templateId: string
  /** Template name as it was at generation time — survives a rename. */
  templateName: string
  /** What the user asked it to focus on. Empty means the whole meeting. */
  focus: string
  createdAt: string // ISO 8601
  markdown: string
}

/**
 * Something someone took on during the meeting. referat hands these off to
 * other tools and does not track them, so there is no status.
 */
export interface ActionItem {
  id: string
  text: string
  /** Who does it, as named in the meeting. '' when it was not said. */
  owner: string
  /** Due date as YYYY-MM-DD. '' when none was mentioned. */
  due: string
  /** Where in the recording it was agreed, in seconds. */
  atSec?: number
}

export interface MeetingDetail extends MeetingMeta {
  transcript?: Transcript
  /** Every summary generated for this meeting, oldest first. */
  summaries: MeetingSummary[]
  /**
   * Action items taken from the transcript. Absent until they have been
   * extracted; [] when the meeting had none.
   */
  actionItems?: ActionItem[]
  /** How many recorded audio segment files the meeting has, for playback. */
  audioSegments: number
}

// ---------- Projects ----------

/** A group of meetings, e.g. a steering group or a customer. */
export interface Project {
  id: string
  name: string
  /** Template a recording in this project starts with. '' = the global choice. */
  defaultTemplateId: string
  /**
   * Background the summary model gets with every meeting in the project: what
   * it is about, who usually takes part and in what role. '' = none.
   */
  description: string
  createdAt: string
}

/** An overview across every meeting in a project. */
export interface ProjectSummary {
  id: string
  createdAt: string
  /** What the user asked it to be about; '' = the whole project. */
  focus: string
  markdown: string
  /** How many meetings it was built from. */
  meetingCount: number
}

export type ProjectOverviewResult =
  | {
      ok: true
      summary: ProjectSummary
      /** Oldest meetings that did not fit the model's input and were left out. */
      leftOut: number
    }
  | { ok: false; message: string; detail?: string }

// ---------- Settings & providers ----------

export type TranscriptionPreset = 'built-in' | 'local' | 'openai' | 'azure' | 'custom'
export type SummaryPreset = 'local' | 'openai' | 'azure' | 'anthropic' | 'codex' | 'custom'
export type SummaryBackend = 'http' | 'codex-cli'

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
  /**
   * Show text while recording. null = the user never chose, which means on
   * for a transcriber on this computer and off for anything else (see
   * src/shared/live.ts).
   */
  live: boolean | null
}

export interface SummarySettings {
  preset: SummaryPreset
  /**
   * HTTP calls a configured model endpoint. codex-cli reuses an existing,
   * locally authenticated Codex CLI session and never needs an API key.
   */
  backend: SummaryBackend
  /** 'openai-compatible' covers OpenAI, Azure, Ollama, internal servers. */
  apiFlavor: 'openai-compatible' | 'anthropic'
  baseUrl: string
  model: string
  hasApiKey: boolean
  /** Every available template, built-in ones first. Never empty. */
  templates: SummaryTemplate[]
  /** Template preselected when a recording starts — the last one used. */
  defaultTemplateId: string
}

export interface DiarizationSettings {
  /** Off by default — speaker identification is a power feature. */
  enabled: boolean
  /** Built-in managed component or an externally managed server. */
  backend: 'built-in' | 'server'
  /** Base URL of the local diarization server, e.g. http://localhost:8300 */
  baseUrl: string
  /**
   * Feature flag: recognize speakers across meetings via locally stored voice
   * profiles. Off by default — voiceprints are biometric data (GDPR).
   */
  recognitionEnabled: boolean
}

/**
 * Dictation: hold a key anywhere in Windows, speak, and the text is typed
 * where the cursor is. Run by the dictation engine in dictation-engine/
 * (src/main/dictation.ts).
 */
export interface DictationSettings {
  /** Off by default. Turning it on also keeps referat running in the tray. */
  enabled: boolean
  /** The key to hold, as the engine names it: 'f9', 'ctrl+space', 'mouse4'. */
  hotkey: string
  /**
   * 'auto': a short press keeps it on until the next, holding stops on
   * release. 'hold': it records only while held. 'toggle': one press starts,
   * the next stops.
   */
  hotkeyMode: DictationHotkeyMode
  /** A name from listDictationMicrophones; '' picks automatically. */
  microphone: string
  /**
   * With the automatic choice: use the computer's own microphone rather than
   * a Bluetooth headset's, which drops the headset into low-quality call mode.
   */
  avoidBluetooth: boolean
  language: 'sv' | 'en'
  /** Type finished phrases at natural pauses. null = on when a GPU is used. */
  live: boolean | null
  /** Short tones when dictation starts and stops. */
  sounds: boolean
  /**
   * Rewrite each dictation with the summary's AI service before it is typed
   * in. Off by default: it is slower, and the text may leave the computer.
   */
  rewrite: boolean
  /**
   * With rewrite on: every dictation, only those started with rewriteKey
   * held, or all but those.
   */
  rewriteWhen: 'always' | 'with-key' | 'without-key'
  rewriteKey: 'ctrl' | 'shift'
  /** What the rewrite should do, e.g. "Skriv som ett vänligt mejl". */
  rewriteInstruction: string
}

export type DictationHotkeyMode = 'auto' | 'hold' | 'toggle'

/** One dictation, kept for a week so it can be copied again or corrected. */
export interface DictationEntry {
  id: string
  /** The text as it was typed in. */
  text: string
  /** The program it was typed into ("Microsoft Outlook"), when known. */
  app: string | null
  /** ISO time it was made. */
  at: string
}

/** A microphone the dictation engine can use. */
export interface DictationMicrophone {
  name: string
  bluetooth: boolean
  /** Windows' default microphone. */
  default: boolean
}

/**
 * Which KB-Whisper model the speech recognition on the computer uses, for
 * meetings and dictation alike. 'auto' is large on an Nvidia GPU, small on
 * the processor.
 */
export type SpeechModel = 'auto' | 'small' | 'medium' | 'large'

export interface AppSettings {
  transcription: TranscriptionSettings
  speechModel: SpeechModel
  summary: SummarySettings
  diarization: DiarizationSettings
  dictation: DictationSettings
  /** Set once Viska's settings and replacement rules have been moved over. */
  viskaImport: { at: string; terms: number } | null
  /**
   * What to call the person at the microphone in transcripts and minutes.
   * Empty falls back to 'Jag'; a real name is also what lets the user's own
   * voice be enrolled as a profile without naming a speaker by hand.
   */
  userName: string
  /** Preferred input device id ('' = system default). */
  microphoneId: string
  /** Whether to capture system audio (loopback) in addition to the microphone. */
  captureSystemAudio: boolean
  /** Closing the window keeps referat running in the tray. Off by default. */
  runInBackground: boolean
  /** Start with Windows, hidden in the tray. Off by default. */
  openAtLogin: boolean
  /** Offer to record when a call starts in Teams, Zoom or a browser. On by default. */
  detectCalls: boolean
  /** What to paste in the meeting's chat about the recording. '' = no copy button. */
  consentMessage: string
  theme: 'system' | 'light' | 'dark'
  onboardingCompleted: boolean
}

/** Payload when saving settings. Include apiKey only to overwrite the stored key. */
export interface SaveTranscriptionSettings extends Omit<
  TranscriptionSettings,
  'hasApiKey' | 'live'
> {
  apiKey?: string
  /** Absent keeps the stored choice; null goes back to the default. */
  live?: boolean | null
}
export interface SaveSummarySettings extends Omit<SummarySettings, 'hasApiKey'> {
  apiKey?: string
}
/**
 * The diarization server is local-only and unauthenticated, and the model
 * ships inside the component — there is nothing secret to handle.
 */
export type SaveDiarizationSettings = DiarizationSettings

export type LocalAiComponent =
  | 'transcription-cpu'
  | 'transcription-gpu'
  | 'diarization-cpu'
  | 'diarization-gpu'
  | 'dictation-cpu'
  | 'dictation-gpu'
export type LocalAiComponentState =
  'not-installed' | 'downloading' | 'installing' | 'installed' | 'starting' | 'running' | 'error'

export interface LocalAiComponentStatus {
  component: LocalAiComponent
  state: LocalAiComponentState
  progress?: number
  message?: string
  detail?: string
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

// ---------- Auto-update events (main -> renderer) ----------

/** Emitted once an update has finished downloading and is staged to install. */
export interface UpdateDownloadedEvent {
  /** The new version that will be installed, e.g. '0.2.0'. */
  version: string
}

// ---------- Calls ----------

/** A meeting app whose calls referat notices. */
export type CallApp = 'teams' | 'zoom' | 'browser'

/** A call that started or ended in a meeting app. */
export interface CallEvent {
  app: CallApp
  active: boolean
}

// ---------- Search ----------

export interface SearchFilter {
  /** 'all', 'none' (outside any project) or a project id. */
  projectId: string
  /** Only meetings from the last this many days; null for all of them. */
  sinceDays: number | null
}

export type SearchHit =
  | { kind: 'transcript'; startSec: number; speaker?: string; text: string }
  | { kind: 'protocol'; summaryId: string; templateName: string; text: string }

export interface SearchResult {
  meetingId: string
  title: string
  createdAt: string
  projectId?: string
  /** The first few places the words were found. */
  hits: SearchHit[]
  /** How many places in all. */
  total: number
}

// ---------- The preload API surface ----------

export interface SaveGeneralSettings {
  speechModel?: SpeechModel
  microphoneId?: string
  captureSystemAudio?: boolean
  runInBackground?: boolean
  openAtLogin?: boolean
  detectCalls?: boolean
  consentMessage?: string
  userName?: string
  theme?: AppSettings['theme']
  onboardingCompleted?: boolean
}

/** `projectId: null` makes the term apply to every meeting again. */
export interface GlossaryTermPatch {
  canonical?: string
  variants?: string[]
  projectId?: string | null
}

export interface ProjectPatch {
  name?: string
  defaultTemplateId?: string
  description?: string
}

export interface RendererApi {
  // Meetings
  listMeetings(): Promise<MeetingMeta[]>
  getMeeting(id: string): Promise<MeetingDetail | null>
  deleteMeeting(id: string): Promise<void>
  /**
   * Find meetings whose transcript or protocols contain every word of the
   * query, newest first. Searches this computer only.
   */
  searchMeetings(query: string, filter: SearchFilter): Promise<SearchResult[]>
  renameMeeting(id: string, title: string): Promise<void>
  /** Re-run the pipeline after an error, from the failed step. */
  retryPipeline(id: string): Promise<void>
  /**
   * Re-run the summary step, regenerating every summary the meeting already
   * has (e.g. after renaming speakers, which makes all of them stale).
   */
  resummarize(id: string): Promise<void>
  /**
   * Queue one more summary of an existing meeting. `focus` narrows it to part
   * of the meeting; pass '' for the whole thing. Resolves once queued — the
   * result arrives as a pipeline progress event.
   */
  generateSummary(meetingId: string, templateId: string, focus: string): Promise<void>
  /**
   * Remove one summary and its file. Removing the last one is allowed — a new
   * one can always be generated from the transcript.
   */
  deleteSummary(meetingId: string, summaryId: string): Promise<void>
  /**
   * Take the action items from the meeting's transcript, for meetings recorded
   * before this ran in the pipeline. Takes as long as a model call.
   */
  extractActionItems(meetingId: string): Promise<ActionItem[]>
  /** Store the action items as the user edited them. */
  updateActionItems(meetingId: string, items: ActionItem[]): Promise<void>
  /**
   * Hand the action items to another tool: 'list' copies them, 'csv' asks
   * where to save a file. savedTo is null for the list or a cancelled save.
   */
  exportActionItems(meetingId: string, format: 'list' | 'csv'): Promise<{ savedTo: string | null }>

  // Speakers
  /**
   * Rename a diarized speaker; persisted to transcript.json. With voice
   * recognition enabled this also saves/updates the local voice profile.
   */
  renameSpeaker(meetingId: string, speakerId: string, name: string): Promise<void>
  /** Reject a recognition suggestion; removed from transcript.json. */
  dismissSpeakerSuggestion(meetingId: string, speakerId: string): Promise<void>
  listSpeakerProfiles(): Promise<SpeakerProfile[]>
  deleteSpeakerProfile(id: string): Promise<void>
  deleteAllSpeakerProfiles(): Promise<void>

  // Glossary: one global list of misheard terms, shared by every meeting.
  listGlossaryTerms(): Promise<GlossaryTerm[]>
  /**
   * Add a misheard form to the term with this spelling, creating it when new.
   * Rejects when either string is blank. `projectId` limits a new term to that
   * project; omitted = every meeting.
   */
  addGlossaryEntry(canonical: string, variant: string, projectId?: string): Promise<GlossaryTerm>
  updateGlossaryTerm(id: string, patch: GlossaryTermPatch): Promise<GlossaryTerm | null>
  deleteGlossaryTerm(id: string): Promise<void>
  /**
   * Re-correct one meeting's transcript from the current glossary. Returns the
   * number of replacements, or null when the meeting has no transcript yet.
   * Local string work — no provider call, so it is safe to run on every edit.
   */
  applyGlossary(meetingId: string): Promise<number | null>

  // Projects
  listProjects(): Promise<Project[]>
  /** Rejects when the name is blank. */
  createProject(name: string): Promise<Project>
  updateProject(id: string, patch: ProjectPatch): Promise<Project | null>
  /** Deletes the project; its meetings stay and move to "Utan projekt". */
  deleteProject(id: string): Promise<void>
  /** Move a meeting into a project, or out of any project with null. */
  setMeetingProject(meetingId: string, projectId: string | null): Promise<void>
  /** Earlier overviews of the project, oldest first. */
  listProjectSummaries(projectId: string): Promise<ProjectSummary[]>
  /**
   * Summarize the project from its meetings' summaries. Takes as long as a
   * model call; failures come back as a result rather than a rejection.
   */
  generateProjectSummary(projectId: string, focus: string): Promise<ProjectOverviewResult>
  deleteProjectSummary(projectId: string, summaryId: string): Promise<void>
  copyProjectSummary(projectId: string, summaryId: string): Promise<void>

  // Recording: renderer captures & encodes; main persists chunks.
  /**
   * `templateId` decides which summary the pipeline produces; '' = default.
   * `projectId` files the meeting under a project; omitted = no project.
   */
  startRecording(title: string, templateId?: string, projectId?: string): Promise<RecordingHandle>
  /** segmentIndex identifies the rotated segment file; defaults to 0. */
  appendAudioChunk(meetingId: string, chunk: ArrayBuffer, segmentIndex?: number): Promise<void>
  /**
   * Store the per-source level envelope measured while recording. Call before
   * finishRecording — the pipeline reads it to tell the microphone apart from
   * the system audio.
   */
  saveLevelEnvelope(meetingId: string, envelope: LevelEnvelope): Promise<void>
  /** Finalize: closes file, sets duration, kicks off the pipeline. */
  finishRecording(meetingId: string, durationSec: number): Promise<void>
  cancelRecording(meetingId: string): Promise<void>
  /**
   * Transcribe one live window (a complete webm file) and return its text.
   * Rejects when live transcription is off or the transcriber fails. Nothing
   * is stored — the meeting's transcript is made from the recording.
   */
  transcribeLive(audio: ArrayBuffer, meetingId?: string): Promise<string>

  // Settings
  getSettings(): Promise<AppSettings>
  saveTranscriptionSettings(s: SaveTranscriptionSettings): Promise<void>
  saveSummarySettings(s: SaveSummarySettings): Promise<void>
  saveDiarizationSettings(s: SaveDiarizationSettings): Promise<void>
  saveGeneralSettings(s: SaveGeneralSettings): Promise<void>
  /**
   * Save the dictation settings and apply them: start, reconfigure or stop
   * the engine. Rejects with a plain-language reason when it cannot start.
   */
  saveDictationSettings(s: DictationSettings): Promise<void>
  /** The microphones the running engine sees; empty when it is not running. */
  listDictationMicrophones(): Promise<DictationMicrophone[]>
  /**
   * The microphone the dictation engine would pick now — with its Bluetooth
   * rules — for meetings left on the system default. Null without dictation.
   */
  getDictationMicrophone(): Promise<string | null>
  /** The last week's dictations, newest first. */
  listDictations(): Promise<DictationEntry[]>
  deleteDictation(id: string): Promise<void>
  clearDictations(): Promise<void>
  testTranscriptionConnection(): Promise<ConnectionTestResult>
  testSummaryConnection(): Promise<ConnectionTestResult>
  testDiarizationConnection(): Promise<ConnectionTestResult>
  listLocalAiComponents(): Promise<LocalAiComponentStatus[]>
  installLocalAiComponent(component: LocalAiComponent): Promise<LocalAiComponentStatus>
  removeLocalAiComponent(component: LocalAiComponent): Promise<void>

  // Export. summaryId defaults to the meeting's first summary.
  exportProtocol(
    id: string,
    format: 'md' | 'docx',
    summaryId?: string
  ): Promise<{ savedTo: string | null }>
  copyProtocol(id: string, summaryId?: string): Promise<void>
  /**
   * Open a follow-up email summary as a draft in the mail program. copied is
   * true when the text was too long for that and went to the clipboard.
   */
  openFollowUpEmail(meetingId: string, summaryId: string): Promise<{ copied: boolean }>

  // Events
  onPipelineProgress(cb: (e: PipelineProgressEvent) => void): () => void
  /** Fires when a new version has been downloaded and is ready to install. */
  onUpdateDownloaded(cb: (e: UpdateDownloadedEvent) => void): () => void
  onLocalAiComponentProgress(cb: (e: LocalAiComponentStatus) => void): () => void
  /** Fires when a call starts or ends in a meeting app. */
  onCallDetected(cb: (e: CallEvent) => void): () => void
  /** Fires when a dictation is added to the history. */
  onDictationAdded(cb: (e: DictationEntry) => void): () => void
  /** Fires when the main process wants the dictation settings shown. */
  onOpenDictationSettings(cb: () => void): () => void

  // Updates
  /** Quit and install the downloaded update immediately (toast action). */
  installUpdateNow(): Promise<void>

  // Misc
  openExternal(url: string): Promise<void>
  getAppVersion(): Promise<string>
}
