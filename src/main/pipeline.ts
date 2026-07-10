// Sequential pipeline: transcribe -> summarize, one meeting at a time.
// Status transitions are persisted to meta.json and broadcast to renderers.

import { BrowserWindow } from 'electron'
import type { PipelineProgressEvent } from '../shared/types'
import { IPC } from './ipc'
import {
  audioPath,
  hasTranscript,
  listMeetings,
  readMeta,
  readTranscript,
  updateMeta,
  writeProtocol,
  writeTranscript
} from './storage'
import { getSummaryConfig, getTranscriptionConfig } from './settings'
import { transcribe } from './providers/transcription'
import { summarize } from './providers/summary'
import { classifyError } from './providers/shared'

type JobMode = 'full' | 'summarize'
interface Job {
  meetingId: string
  mode: JobMode
}

const queue: Job[] = []
let running = false

function emit(event: PipelineProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.pipelineProgress, event)
  }
}

export function enqueue(meetingId: string, mode: JobMode = 'full'): void {
  // Avoid duplicate queue entries for the same meeting.
  if (queue.some((j) => j.meetingId === meetingId)) return
  queue.push({ meetingId, mode })
  void runNext()
}

async function runNext(): Promise<void> {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  try {
    await runJob(job)
  } catch (err) {
    // Defensive: runJob handles its own errors, but never let the loop die.
    console.error('Pipeline job crashed', err)
  } finally {
    running = false
    if (queue.length > 0) void runNext()
  }
}

function fail(meetingId: string, step: 'transcribe' | 'summarize', err: unknown): void {
  const { message, detail } = classifyError(err)
  updateMeta(meetingId, { status: 'error', error: { message, detail, failedStep: step } })
  emit({ meetingId, status: 'error' })
}

async function runJob(job: Job): Promise<void> {
  const { meetingId, mode } = job
  if (!readMeta(meetingId)) return // deleted meanwhile

  if (mode === 'full') {
    updateMeta(meetingId, { status: 'transcribing' })
    emit({ meetingId, status: 'transcribing' })
    try {
      const meta = readMeta(meetingId)
      const transcript = await transcribe(
        audioPath(meetingId),
        getTranscriptionConfig(),
        meta?.durationSec ?? 0
      )
      writeTranscript(meetingId, transcript)
    } catch (err) {
      fail(meetingId, 'transcribe', err)
      return
    }
  }

  updateMeta(meetingId, { status: 'summarizing' })
  emit({ meetingId, status: 'summarizing' })
  try {
    const transcript = readTranscript(meetingId)
    if (!transcript) throw new Error('Transkript saknas — kan inte sammanfatta')
    const protocol = await summarize(transcript.text, getSummaryConfig())
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
      case 'summarizing':
        enqueue(meta.id, hasTranscript(meta.id) ? 'summarize' : 'full')
        break
      default:
        break // done / error: leave as-is
    }
  }
}
