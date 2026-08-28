// Sequential pipeline: transcribe -> (diarize) -> summarize, one meeting at a
// time. Status transitions are persisted to meta.json and broadcast to renderers.

import { BrowserWindow } from 'electron'
import type { PipelineProgressEvent } from '../shared/types'
import { IPC } from './ipc'
import {
  addSummary,
  audioSegmentPaths,
  hasTranscript,
  listMeetings,
  listSummaries,
  readLevelEnvelope,
  readMeta,
  readTranscript,
  updateMeta,
  updateSummaryMarkdown,
  writeTranscript
} from './storage'
import {
  getDiarizationConfig,
  getSummaryConfig,
  getSummaryTemplate,
  getTranscriptionConfig
} from './settings'
import { applyGlossary, glossaryPromptBlock, listGlossaryTerms } from './glossary'
import { transcribe } from './providers/transcription'
import { summarize } from './providers/summary'
import { diarize } from './providers/diarization'
import {
  isDefaultSpeakerName,
  matchSpeakerProfiles,
  mergeDiarization,
  RECOGNITION_THRESHOLD,
  speakerAttributedText
} from './diarize'
import { profilesWithEmbeddings } from './speakerProfiles'
import { attributeBySource } from './sourceAttribution'
import { classifyError, UserFacingError } from './providers/shared'
import type { Transcript } from '../shared/types'

/**
 * 'diarize' = re-run diarization on the existing transcript, then summarize.
 * 'summarize' = redo the summaries the meeting already has.
 * 'add-summary' = generate one more summary from `request`, keeping the rest.
 */
type JobMode = 'full' | 'diarize' | 'summarize' | 'add-summary'

/** What an 'add-summary' job should produce. */
interface SummaryRequest {
  templateId: string
  focus: string
}

interface Job {
  meetingId: string
  mode: JobMode
  request?: SummaryRequest
}

const queue: Job[] = []
let running = false
let runningKey: string | null = null

function emit(event: PipelineProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.pipelineProgress, event)
  }
}

/**
 * Identity of a job. Two different summaries of the same meeting are different
 * jobs and must both run; a second retry of the same meeting is the same job
 * and must not start a concurrent run.
 */
function jobKey(job: Job): string {
  return [job.meetingId, job.mode, job.request?.templateId ?? '', job.request?.focus ?? ''].join(
    '|'
  )
}

export function enqueue(meetingId: string, mode: JobMode = 'full', request?: SummaryRequest): void {
  const job: Job = { meetingId, mode, ...(request ? { request } : {}) }
  const key = jobKey(job)
  if (runningKey === key) return
  if (queue.some((j) => jobKey(j) === key)) return
  queue.push(job)
  void runNext()
}

async function runNext(): Promise<void> {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  runningKey = jobKey(job)
  try {
    await runJob(job)
  } catch (err) {
    // Defensive: runJob handles its own errors, but never let the loop die.
    console.error('Pipeline job crashed', err)
  } finally {
    running = false
    runningKey = null
    if (queue.length > 0) void runNext()
  }
}

function fail(meetingId: string, step: 'transcribe' | 'summarize', err: unknown): void {
  const { message, detail } = classifyError(err)
  updateMeta(meetingId, { status: 'error', error: { message, detail, failedStep: step } })
  emit({ meetingId, status: 'error' })
}

/**
 * Optional diarization step. Failures degrade gracefully: the meeting gets a
 * warning in meta.json and the pipeline continues to the summary — a
 * diarization failure must never set status 'error'.
 */
async function runDiarization(meetingId: string): Promise<void> {
  const config = getDiarizationConfig()
  if (!config.enabled) return
  const audioPaths = audioSegmentPaths(meetingId)
  const transcript = readTranscript(meetingId)
  if (!transcript || audioPaths.length === 0) return

  updateMeta(meetingId, { status: 'diarizing' })
  emit({ meetingId, status: 'diarizing' })
  try {
    const result = await diarize(audioPaths, config)
    let merged = mergeDiarization(transcript, result.turns)
    if (config.recognitionEnabled && result.embeddings) {
      merged = applyRecognition(merged, result.embeddings)
    }
    writeTranscript(meetingId, merged)
  } catch (err) {
    const { detail } = classifyError(err)
    updateMeta(meetingId, {
      warning: { message: 'Talarna kunde inte identifieras — protokollet skapas ändå', detail }
    })
  }
}

/**
 * Voice recognition (flag on only — with the flag off nothing biometric is
 * ever stored): keep the embeddings on the transcript so a later rename can
 * enroll a profile, and turn profile matches into SUGGESTIONS ("Anna?").
 * Suggestions are only made for speakers still on their default 'Talare N'
 * name — a name the user chose is never fought over.
 */
function applyRecognition(
  transcript: Transcript,
  embeddings: Record<string, number[]>
): Transcript {
  const next: Transcript = { ...transcript, speakerEmbeddings: embeddings }
  // A re-run replaces last run's recognition output; stale suggestions must
  // not survive a fresh diarization.
  delete next.speakerSuggestions
  const matches = matchSpeakerProfiles(embeddings, profilesWithEmbeddings(), RECOGNITION_THRESHOLD)
  const names = next.speakers ?? {}
  const suggestions: Record<string, string> = {}
  for (const [speakerId, profileName] of Object.entries(matches)) {
    const display = names[speakerId]
    if (display && isDefaultSpeakerName(display)) suggestions[speakerId] = profileName
  }
  if (Object.keys(suggestions).length > 0) next.speakerSuggestions = suggestions
  return next
}

/**
 * Tell the microphone apart from the system audio, so a meeting recorded
 * without diarization still says who spoke — the user, or everyone else.
 * Diarization knows more when it ran, and attributeBySource stands down in
 * that case, so this is safe to call unconditionally.
 */
function applySourceAttribution(meetingId: string): void {
  const transcript = readTranscript(meetingId)
  const envelope = readLevelEnvelope(meetingId)
  if (!transcript || !envelope) return
  const next = attributeBySource(transcript, envelope)
  if (next !== transcript) writeTranscript(meetingId, next)
}

/**
 * Correct misheard terms in the stored transcript from the glossary. Cheap,
 * local string work — no provider involved — so it runs on every pipeline pass
 * and can also be called on its own the moment the user adds a term.
 *
 * Returns the number of replacements, or null when there is no transcript yet.
 */
export function applyGlossaryToMeeting(meetingId: string): number | null {
  const transcript = readTranscript(meetingId)
  if (!transcript) return null
  const { transcript: next, hits } = applyGlossary(transcript, listGlossaryTerms())
  // Always write: a removed term un-corrects the transcript, which is a change
  // worth persisting even though it produces no hits.
  writeTranscript(meetingId, next)
  return hits
}

/**
 * Run one summary through the provider. Rejects an empty answer rather than
 * storing it: reasoning-heavy models can burn the whole context budget on
 * thinking and come back with nothing.
 */
async function generateSummaryText(
  transcript: Transcript,
  promptTemplate: string,
  focus: string
): Promise<string> {
  // With speakers merged in, the prompt gets speaker-attributed text
  // ("Anna: …"); without speakers this is exactly transcript.text.
  const markdown = await summarize(speakerAttributedText(transcript), getSummaryConfig(), {
    promptTemplate,
    glossary: glossaryPromptBlock(listGlossaryTerms()),
    focus
  })
  if (!markdown.trim()) {
    throw new UserFacingError(
      'Modellen gav ett tomt svar. Prova en annan modell i inställningarna — resonerande modeller fungerar ofta sämre för protokoll.'
    )
  }
  return markdown
}

/**
 * Redo every summary the meeting already has, in place. After a speaker rename
 * or a glossary edit they are all equally stale, so updating only one of them
 * would leave the rest quietly wrong. A meeting with no summaries yet — the
 * normal first run — gets one from the template chosen when recording started.
 */
async function runSummaries(meetingId: string, transcript: Transcript): Promise<void> {
  const existing = listSummaries(meetingId)
  if (existing.length === 0) {
    const template = getSummaryTemplate(readMeta(meetingId)?.templateId)
    const markdown = await generateSummaryText(transcript, template.promptTemplate, '')
    addSummary(meetingId, {
      templateId: template.id,
      templateName: template.name,
      focus: '',
      markdown
    })
    return
  }
  for (const summary of existing) {
    // The template may have been renamed, edited or deleted since; falling back
    // to the default beats refusing to refresh the summary at all.
    const template = getSummaryTemplate(summary.templateId)
    const markdown = await generateSummaryText(transcript, template.promptTemplate, summary.focus)
    updateSummaryMarkdown(meetingId, summary.id, markdown)
  }
}

/**
 * Generate one extra summary without touching the ones already there. A
 * failure here is a warning, not an error: the meeting still has its earlier
 * summaries and must not be dragged into the error state on top of them.
 */
async function runAddSummary(meetingId: string, request: SummaryRequest): Promise<void> {
  updateMeta(meetingId, { status: 'summarizing', warning: undefined })
  emit({ meetingId, status: 'summarizing' })
  try {
    const transcript = readTranscript(meetingId)
    if (!transcript) throw new UserFacingError('Transkript saknas — kan inte sammanfatta')
    const template = getSummaryTemplate(request.templateId)
    const markdown = await generateSummaryText(transcript, template.promptTemplate, request.focus)
    addSummary(meetingId, {
      templateId: template.id,
      templateName: template.name,
      focus: request.focus,
      markdown
    })
  } catch (err) {
    const { message, detail } = classifyError(err)
    updateMeta(meetingId, {
      warning: { message: `Den nya sammanfattningen kunde inte skapas: ${message}`, detail }
    })
  }
  updateMeta(meetingId, { status: 'done' })
  emit({ meetingId, status: 'done' })
}

async function runJob(job: Job): Promise<void> {
  const { meetingId, mode } = job
  if (!readMeta(meetingId)) return // deleted meanwhile

  if (mode === 'add-summary') {
    if (job.request) await runAddSummary(meetingId, job.request)
    return
  }

  if (mode === 'full' || mode === 'diarize') {
    // A fresh run must not show last run's warning next to the new result.
    updateMeta(meetingId, { warning: undefined })
  }

  if (mode === 'full') {
    updateMeta(meetingId, { status: 'transcribing' })
    emit({ meetingId, status: 'transcribing' })
    try {
      const meta = readMeta(meetingId)
      const transcript = await transcribe(
        audioSegmentPaths(meetingId),
        getTranscriptionConfig(),
        meta?.durationSec ?? 0
      )
      writeTranscript(meetingId, transcript)
    } catch (err) {
      fail(meetingId, 'transcribe', err)
      return
    }
  }

  if (mode === 'full' || mode === 'diarize') {
    await runDiarization(meetingId)
  }

  applySourceAttribution(meetingId)

  // Correct misheard terms before summarizing. This also runs for a plain
  // re-summarize, so editing the glossary and pressing "update protocol" is
  // enough to re-correct the transcript along with the minutes.
  applyGlossaryToMeeting(meetingId)

  updateMeta(meetingId, { status: 'summarizing' })
  emit({ meetingId, status: 'summarizing' })
  try {
    const transcript = readTranscript(meetingId)
    if (!transcript) throw new Error('Transkript saknas — kan inte sammanfatta')
    await runSummaries(meetingId, transcript)
  } catch (err) {
    fail(meetingId, 'summarize', err)
    return
  }

  // Clear any previous error and mark done.
  updateMeta(meetingId, { status: 'done', error: undefined })
  emit({ meetingId, status: 'done' })
}

/** Re-run after an error: resume from the failed step (transcript present -> summarize only). */
export function retryPipeline(id: string): void {
  const meta = readMeta(id)
  if (!meta) return
  enqueue(id, hasTranscript(id) ? 'summarize' : 'full')
}

/** Redo every summary the meeting has (e.g. after renaming speakers). */
export function resummarize(id: string): void {
  const meta = readMeta(id)
  if (!meta) return
  if (hasTranscript(id)) enqueue(id, 'summarize')
}

/**
 * Queue one more summary of an already-transcribed meeting. `focus` narrows it
 * to part of the meeting; '' summarizes the whole thing.
 */
export function generateSummary(id: string, templateId: string, focus: string): void {
  const meta = readMeta(id)
  if (!meta) return
  if (hasTranscript(id)) enqueue(id, 'add-summary', { templateId, focus: focus.trim() })
}

/** On app start: resume interrupted jobs and fail crashed recordings. */
export function recoverPipeline(): void {
  for (const meta of listMeetings()) {
    switch (meta.status) {
      case 'recording':
        // App crashed mid-recording; the audio stream was never finalized.
        updateMeta(meta.id, {
          status: 'error',
          error: {
            message: 'Inspelningen avbröts oväntat',
            detail: 'Appen stängdes medan inspelningen pågick.',
            failedStep: 'transcribe'
          }
        })
        break
      case 'recorded':
      case 'transcribing':
        enqueue(meta.id, 'full')
        break
      case 'diarizing':
        enqueue(meta.id, hasTranscript(meta.id) ? 'diarize' : 'full')
        break
      case 'summarizing':
        enqueue(meta.id, hasTranscript(meta.id) ? 'summarize' : 'full')
        break
      default:
        break // done / error: leave as-is
    }
  }
}
