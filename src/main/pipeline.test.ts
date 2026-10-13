import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Transcript } from '../shared/types'

// The pipeline only orchestrates: storage, settings and providers are replaced
// so the test sees the order in which it calls them.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '' }
}))

const meta = { id: 'm1', status: 'recorded', durationSec: 60 }
let transcript: Transcript | undefined
const metaUpdates: Record<string, unknown>[] = []

vi.mock('./storage', () => ({
  addSummary: vi.fn(),
  audioSegmentPaths: () => ['a.webm', 'b.webm'],
  hasTranscript: () => transcript !== undefined,
  listMeetings: () => [],
  listSummaries: () => [],
  readLevelEnvelope: () => undefined,
  readMeta: () => meta,
  readTranscript: () => transcript,
  updateMeta: (_id: string, patch: Record<string, unknown>) => {
    metaUpdates.push(patch)
    return meta
  },
  updateSummaryMarkdown: vi.fn(),
  writeTranscript: (_id: string, next: Transcript) => {
    transcript = next
  }
}))

const diarizationConfig = {
  enabled: true,
  backend: 'built-in',
  baseUrl: '',
  recognitionEnabled: false
}

vi.mock('./settings', () => ({
  getDiarizationConfig: () => diarizationConfig,
  getSummaryConfig: () => ({}),
  getSummaryTemplate: () => ({ id: 't', name: 'Protokoll', promptTemplate: '{{transkript}}' }),
  getTranscriptionConfig: () => ({}),
  getUserName: () => ''
}))

vi.mock('./glossary', () => ({
  applyGlossary: (t: Transcript) => ({ transcript: t, hits: 0 }),
  glossaryPromptBlock: () => '',
  termsForProject: () => []
}))

vi.mock('./projects', () => ({ getProject: () => undefined, projectPromptBlock: () => '' }))
vi.mock('./speakerProfiles', () => ({ profilesWithEmbeddings: () => [], upsertProfile: vi.fn() }))
vi.mock('./projectSummary', () => ({
  addProjectSummary: vi.fn(),
  buildProjectInput: vi.fn(),
  PROJECT_OVERVIEW_PROMPT: ''
}))

const transcribe = vi.fn()
const diarize = vi.fn()
vi.mock('./providers/transcription', () => ({ transcribe: (...a: unknown[]) => transcribe(...a) }))
vi.mock('./providers/diarization', () => ({ diarize: (...a: unknown[]) => diarize(...a) }))
vi.mock('./providers/summary', () => ({ summarize: async () => '# Protokoll' }))

const { enqueue } = await import('./pipeline')

const fresh: Transcript = {
  language: 'sv',
  text: 'hej då',
  segments: [
    { startSec: 0, endSec: 2, text: 'hej' },
    { startSec: 2, endSec: 4, text: 'då' }
  ]
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const finalStatus = (): unknown =>
  [...metaUpdates].reverse().find((patch) => patch.status === 'done' || patch.status === 'error')

beforeEach(() => {
  transcript = undefined
  metaUpdates.length = 0
  diarizationConfig.enabled = true
  transcribe.mockReset()
  diarize.mockReset()
})

describe('pipeline diarization', () => {
  it('starts diarization while transcription is still running', async () => {
    const transcription = deferred<Transcript>()
    transcribe.mockReturnValue(transcription.promise)
    diarize.mockResolvedValue({
      turns: [
        { startSec: 0, endSec: 2, speaker: 'S1' },
        { startSec: 2, endSec: 4, speaker: 'S2' }
      ]
    })

    enqueue('m1')
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled())
    expect(diarize).toHaveBeenCalledWith(['a.webm', 'b.webm'], diarizationConfig)

    transcription.resolve(fresh)
    await vi.waitFor(() => expect(finalStatus()).toEqual({ status: 'done', error: undefined }))
    expect(transcript?.segments.map((s) => s.speaker)).toEqual(['S1', 'S2'])
  })

  it('reports the transcription failure and swallows the abandoned diarization', async () => {
    transcribe.mockRejectedValue(new Error('transcriber down'))
    const diarization = deferred<never>()
    diarize.mockReturnValue(diarization.promise)

    enqueue('m1')
    await vi.waitFor(() => expect(finalStatus()).toMatchObject({ status: 'error' }))
    // Rejecting after the job ended must not surface as an unhandled rejection,
    // which vitest would report as a failure.
    diarization.reject(new Error('diarizer down'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(finalStatus()).toMatchObject({ error: { failedStep: 'transcribe' } })
  })

  it('turns a diarization failure into a warning and still finishes', async () => {
    transcribe.mockResolvedValue(fresh)
    diarize.mockRejectedValue(new Error('diarizer down'))

    enqueue('m1')
    await vi.waitFor(() => expect(finalStatus()).toEqual({ status: 'done', error: undefined }))
    expect(metaUpdates.some((patch) => patch.warning)).toBe(true)
  })

  it('does not call the diarizer when diarization is off', async () => {
    diarizationConfig.enabled = false
    transcribe.mockResolvedValue(fresh)

    enqueue('m1')
    await vi.waitFor(() => expect(finalStatus()).toEqual({ status: 'done', error: undefined }))
    expect(diarize).not.toHaveBeenCalled()
  })
})
