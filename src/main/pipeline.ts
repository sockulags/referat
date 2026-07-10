// Sequential pipeline: transcribe -> (diarize) -> summarize, one meeting at a
// time. Status transitions are persisted to meta.json and broadcast to renderers.

import { BrowserWindow } from 'electron'
import type { PipelineProgressEvent } from '../shared/types'
import { IPC } from './ipc'
import {
  audioSegmentPaths,
  hasTranscript,
  listMeetings,
  readMeta,
  readTranscript,
  updateMeta,
  writeProtocol,
  writeTranscript
} from './storage'
import { getDiarizationConfig, getSummaryConfig, getTranscriptionConfig } from './settings'
import { transcribe } from './providers/transcription'
import { summarize } from './providers/summary'
import { diarize } from './providers/diarization'
import { mergeDiarization, speakerAttributedText } from './diarize'
import { classifyError, UserFacingError } from './providers/shared'

/** 'diarize' = re-run diarization on the existing transcript, then summarize. */
type JobMode = 'full' | 'diarize' | 'summarize'
interface Job {
  meetingId: string
  mode: JobMode
}

const queue: Job[] = []
let running = false
let runningId: string | null = null

function emit(event: PipelineProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.pipelineProgress, event)
  }
}

export function enqueue(meetingId: string, mode: JobMode = 'full'): void {
  // Skip if the meeting is already queued OR currently running — a retry while
  // a job runs must not start a second concurrent run of the same meeting.
  if (runningId === meetingId) return
  if (queue.some((j) => j.meetingId === meetingId)) return
  queue.push({ meetingId, mode })
  void runNext()
}

async function runNext(): Promise<void> {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  runningId = job.meetingId
  try {
    await runJob(job)
  } catch (err) {
    // Defensive: runJob handles its own errors, but never let the loop die.
    console.error('Pipeline job crashed', err)
  } finally {
    running = false
    runningId = null
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
    const turns = await diarize(audioPaths, config)
    writeTranscript(meetingId, mergeDiarization(transcript, turns))
  } catch (err) {
    const { detail } = classifyError(err)
    updateMeta(meetingId, {
      warning: { message: 'Talarna kunde inte identifieras — protokollet skapas ändå', detail }
    })
  }
}

async function runJob(job: Job): Promise<void> {
  const { meetingId, mode } = job
  if (!readMeta(meetingId)) return // deleted meanwhile

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

  updateMeta(meetingId, { status: 'summarizing' })
  emit({ meetingId, status: 'summarizing' })
  try {
    const transcript = readTranscript(meetingId)
    if (!transcript) throw new Error('Transkript saknas — kan inte sammanfatta')
    // With speakers merged in, the prompt gets speaker-attributed text
    // ("Anna: …"); without speakers this is exactly transcript.text.
    const protocol = await summarize(speakerAttributedText(transcript), getSummaryConfig())
    if (!protocol.trim()) {
      // Reasoning-heavy models can burn the whole context budget on thinking
      // and return an empty answer. Surface it instead of writing an empty
      // protocol marked as done.
      throw new UserFacingError(
        'Modellen gav ett tomt svar. Prova en annan modell i inställningarna — resonerande modeller fungerar ofta sämre för protokoll.'
      )
    }
    writeProtocol(meetingId, protocol)
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

/** Re-run only the summary step (e.g. after renaming speakers). */
export function resummarize(id: string): void {
  const meta = readMeta(id)
  if (!meta) return
  if (hasTranscript(id)) enqueue(id, 'summarize')
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
