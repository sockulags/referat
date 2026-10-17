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
  whenNoRecording,
  writeTranscript
} from './storage'
import {
  getDiarizationConfig,
  getSummaryConfig,
  getSummaryTemplate,
  getTranscriptionConfig,
  getUserName,
  type DiarizationConfig,
  type TranscriptionConfig
} from './settings'
import { applyGlossary, glossaryPromptBlock, termsForProject } from './glossary'
import { getProject, projectPromptBlock } from './projects'
import { transcribe } from './providers/transcription'
import { summarize } from './providers/summary'
import { diarize, type DiarizationResult } from './providers/diarization'
import {
  isDefaultSpeakerName,
  matchSpeakerProfiles,
  mergeDiarization,
  RECOGNITION_THRESHOLD,
  speakerAttributedText
} from './diarize'
import { profilesWithEmbeddings, upsertProfile } from './speakerProfiles'
import {
  attributeBySource,
  identifyMicSpeaker,
  MIC_FALLBACK_NAME,
  nameMicSpeaker
} from './sourceAttribution'
import { classifyError, UserFacingError } from './providers/shared'
import type { ProjectOverviewResult, Transcript } from '../shared/types'
import { liveTranscriptionDefault } from '../shared/live'
import { addProjectSummary, buildProjectInput, PROJECT_OVERVIEW_PROMPT } from './projectSummary'
import { extractActionItems, needsActionItems } from './actionItems'

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

/**
 * Whether this meeting's transcription should step aside while another
 * meeting is being recorded. A local transcriber serves one request at a time,
 * so a 10-minute segment from an earlier meeting would hold every live window
 * of the current one past its timeout and the live text would give up. Waiting
 * between segments caps a live window's wait at the one segment in progress.
 * A remote server is not shared with this computer's live text in that way.
 */
function yieldsToLiveTranscription(config: TranscriptionConfig): boolean {
  return config.live && liveTranscriptionDefault(config.preset, config.baseUrl)
}

function fail(meetingId: string, step: 'transcribe' | 'summarize', err: unknown): void {
  const { message, detail } = classifyError(err)
  updateMeta(meetingId, { status: 'error', error: { message, detail, failedStep: step } })
  emit({ meetingId, status: 'error' })
}

interface StartedDiarization {
  config: DiarizationConfig
  result: Promise<DiarizationResult>
}

/**
 * Send the meeting's audio for diarization without waiting for the answer.
 * Diarization needs only the audio, never the transcript, so a full run starts
 * it alongside transcription and the two overlap instead of queueing. Returns
 * null when diarization is off or there is no audio.
 */
function startDiarization(meetingId: string): StartedDiarization | null {
  const config = getDiarizationConfig()
  if (!config.enabled) return null
  const audioPaths = audioSegmentPaths(meetingId)
  if (audioPaths.length === 0) return null
  const result = diarize(audioPaths, config)
  // Awaited in runDiarization, which turns a failure into a warning. When
  // transcription fails first nobody awaits it, so keep that rejection from
  // surfacing as unhandled.
  result.catch(() => undefined)
  return { config, result }
}

/**
 * Optional diarization step. Failures degrade gracefully: the meeting gets a
 * warning in meta.json and the pipeline continues to the summary — a
 * diarization failure must never set status 'error'.
 */
async function runDiarization(
  meetingId: string,
  started: StartedDiarization | null
): Promise<void> {
  if (!started) return
  const { config, result: pending } = started
  const transcript = readTranscript(meetingId)
  if (!transcript) return

  updateMeta(meetingId, { status: 'diarizing' })
  emit({ meetingId, status: 'diarizing' })
  try {
    const result = await pending
    let merged = mergeDiarization(transcript, result.turns)

    // Diarization clusters voices but cannot say which cluster is the person
    // running the meeting. The level envelope can: whoever spoke through the
    // microphone is the user. Naming that speaker also keeps recognition from
    // suggesting somebody else's name for them, since the name is no longer
    // the default 'Talare N'.
    const envelope = readLevelEnvelope(meetingId)
    const userName = getUserName()
    const micSpeaker = envelope ? identifyMicSpeaker(merged, envelope) : undefined
    if (micSpeaker) {
      merged = nameMicSpeaker(merged, micSpeaker, userName || MIC_FALLBACK_NAME)
    }

    if (config.recognitionEnabled && result.embeddings) {
      merged = applyRecognition(merged, result.embeddings)
      // Knowing which cluster is the user is enough to enroll their voice
      // without them naming a speaker — but only under a name they actually
      // gave. A voiceprint filed under 'Jag' would match strangers later.
      const embedding = micSpeaker ? merged.speakerEmbeddings?.[micSpeaker] : undefined
      if (embedding && userName) upsertProfile(userName, embedding)
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
  const next = attributeBySource(transcript, envelope, getUserName() || MIC_FALLBACK_NAME)
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
  const terms = termsForProject(readMeta(meetingId)?.projectId)
  const { transcript: next, hits } = applyGlossary(transcript, terms)
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
  meetingId: string,
  transcript: Transcript,
  promptTemplate: string,
  focus: string
): Promise<string> {
  // With speakers merged in, the prompt gets speaker-attributed text
  // ("Anna: …"); without speakers this is exactly transcript.text.
  const markdown = await summarize(speakerAttributedText(transcript), getSummaryConfig(), {
    promptTemplate,
    glossary: glossaryPromptBlock(termsForProject(readMeta(meetingId)?.projectId)),
    project: projectPromptBlock(getProject(readMeta(meetingId)?.projectId)),
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
    const markdown = await generateSummaryText(meetingId, transcript, template.promptTemplate, '')
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
    const markdown = await generateSummaryText(
      meetingId,
      transcript,
      template.promptTemplate,
      summary.focus
    )
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
    const markdown = await generateSummaryText(
      meetingId,
      transcript,
      template.promptTemplate,
      request.focus
    )
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

/**
 * Take the action items from a new transcript. Later runs (a re-summarize, a
 * re-diarization) keep the ones there are, because the user edits them by
 * hand. A failure is a warning: the protocol is there, and the meeting view
 * offers to try again.
 */
async function runActionItems(meetingId: string, mode: JobMode): Promise<void> {
  if (mode !== 'full' && !needsActionItems(meetingId)) return
  try {
    await extractActionItems(meetingId)
  } catch (err) {
    // An earlier warning (diarization) says more about the meeting; keep it.
    if (readMeta(meetingId)?.warning) return
    const { message, detail } = classifyError(err)
    updateMeta(meetingId, {
      warning: { message: `Actionpunkterna kunde inte tas fram: ${message}`, detail }
    })
  }
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

  // Started before transcription so the two run at the same time; on a CPU
  // this cut a three-segment meeting from 191 s to 164 s, and with the GPU
  // component diarization hides almost entirely behind transcription.
  const diarization = mode === 'full' || mode === 'diarize' ? startDiarization(meetingId) : null

  if (mode === 'full') {
    updateMeta(meetingId, { status: 'transcribing' })
    emit({ meetingId, status: 'transcribing' })
    try {
      const meta = readMeta(meetingId)
      const config = getTranscriptionConfig()
      const transcript = await transcribe(
        audioSegmentPaths(meetingId),
        config,
        meta?.durationSec ?? 0,
        {
          beforeSegment: yieldsToLiveTranscription(config) ? whenNoRecording : undefined
        }
      )
      writeTranscript(meetingId, transcript)
    } catch (err) {
      fail(meetingId, 'transcribe', err)
      return
    }
  }

  await runDiarization(meetingId, diarization)

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

  await runActionItems(meetingId, mode)

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

/**
 * Summarize a whole project from its meetings' summaries. Runs outside the
 * per-meeting queue: it reads finished summaries and writes nothing to any
 * meeting, so it cannot interfere with a meeting being processed.
 */
export async function generateProjectOverview(
  projectId: string,
  focus: string
): Promise<ProjectOverviewResult> {
  try {
    const project = getProject(projectId)
    if (!project) throw new UserFacingError('Projektet finns inte längre.')
    const input = buildProjectInput(
      listMeetings()
        .filter((m) => m.projectId === projectId)
        // The first summary is the one the pipeline made from the template
        // chosen at recording; later ones are narrower by design.
        .map((m) => ({ meta: m, markdown: listSummaries(m.id)[0]?.markdown }))
    )
    if (input.included === 0) {
      throw new UserFacingError('Inget möte i projektet har någon sammanfattning ännu.')
    }
    const markdown = await summarize(input.text, getSummaryConfig(), {
      promptTemplate: PROJECT_OVERVIEW_PROMPT,
      glossary: glossaryPromptBlock(termsForProject(projectId)),
      focus,
      project: projectPromptBlock(project)
    })
    if (!markdown.trim()) {
      throw new UserFacingError(
        'Modellen gav ett tomt svar. Prova en annan modell i inställningarna.'
      )
    }
    const summary = addProjectSummary(projectId, {
      focus: focus.trim(),
      markdown,
      meetingCount: input.included
    })
    return { ok: true, summary, leftOut: input.leftOut }
  } catch (err) {
    const { message, detail } = classifyError(err)
    return { ok: false, message, detail }
  }
}
