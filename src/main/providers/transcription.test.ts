import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'

const componentMocks = vi.hoisted(() => ({
  ensureLocalAiComponentRunning: vi.fn<(component: string) => Promise<void>>(async () => undefined),
  isLocalAiComponentInstalled: vi.fn<(component: string) => boolean>(() => false),
  localAiComponentBaseUrl: vi.fn(() => 'http://127.0.0.1:8310')
}))

vi.mock('../localAiComponents', () => componentMocks)
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transcribe, testTranscriptionConnection, transcribeLiveWindow } from './transcription'
import type { TranscriptionConfig } from '../settings'

const config: TranscriptionConfig = {
  preset: 'custom',
  baseUrl: 'http://localhost:8000/v1',
  model: 'whisper-1',
  language: 'sv',
  apiKey: '',
  live: true
}

let dir: string
const files: string[] = []

function makeFile(name: string): string {
  const p = join(dir, name)
  // Any bytes: the fetch that would upload them is stubbed.
  writeFileSync(p, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  files.push(p)
  return p
}

/** Build a queue-backed fetch stub that returns one canned Response per call. */
function queueFetch(responses: Response[]): void {
  const q = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const next = q.shift()
      if (!next) throw new Error('fetch called more times than responses queued')
      return Promise.resolve(next)
    })
  )
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function textResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'referat-transcribe-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('transcribe', () => {
  it('throws when no audio files are given', async () => {
    await expect(transcribe([], config, 10)).rejects.toThrow(/Ingen ljudfil/)
  })

  it('merges segments across files and offsets timestamps by prior duration', async () => {
    const a = makeFile('a.webm')
    const b = makeFile('b.webm')
    queueFetch([
      jsonResponse({
        language: 'sv',
        segments: [
          { start: 0, end: 6, text: 'A1' },
          { start: 6, end: 12, text: 'A2' }
        ]
      }),
      jsonResponse({
        language: 'sv',
        segments: [
          { start: 0, end: 5, text: 'B1' },
          { start: 5, end: 10, text: 'B2' }
        ]
      })
    ])

    const t = await transcribe([a, b], config, 22)

    expect(t.language).toBe('sv')
    expect(t.segments).toEqual([
      { startSec: 0, endSec: 6, text: 'A1' },
      { startSec: 6, endSec: 12, text: 'A2' },
      { startSec: 12, endSec: 17, text: 'B1' },
      { startSec: 17, endSec: 22, text: 'B2' }
    ])
    expect(t.text).toBe('A1 A2 B1 B2')
    expect(t.segmentStartsSec).toEqual([0, 12])
  })

  it('offsets by the file length the server reports, so times match the audio', async () => {
    const a = makeFile('a.webm')
    const b = makeFile('b.webm')
    // The first file's speech ends at 12 s but the file runs to 600 s.
    queueFetch([
      jsonResponse({ language: 'sv', duration: 600, segments: [{ start: 0, end: 12, text: 'A' }] }),
      jsonResponse({ language: 'sv', duration: 30, segments: [{ start: 2, end: 8, text: 'B' }] })
    ])

    const t = await transcribe([a, b], config, 630)

    expect(t.segments.map((s) => s.startSec)).toEqual([0, 602])
    expect(t.segmentStartsSec).toEqual([0, 600])
  })

  it('falls back to a proportional offset when a segment yields no timings', async () => {
    const a = makeFile('empty.webm')
    const b = makeFile('real.webm')
    // First file: empty text -> zero segments -> offset must advance by the
    // even split (durationSec / count = 20 / 2 = 10) rather than by 0.
    queueFetch([
      jsonResponse({ language: 'sv', text: '' }),
      jsonResponse({ language: 'sv', segments: [{ start: 0, end: 4, text: 'Hej' }] })
    ])

    const t = await transcribe([a, b], config, 20)

    expect(t.segments).toEqual([{ startSec: 10, endSec: 14, text: 'Hej' }])
    expect(t.text).toBe('Hej')
  })

  it('handles a plain-text response (verbose_json fallback) as one segment', async () => {
    const a = makeFile('plain.webm')
    queueFetch([textResponse('  Bara ren text  ')])

    const t = await transcribe([a], config, 30)

    expect(t.segments).toEqual([{ startSec: 0, endSec: 30, text: 'Bara ren text' }])
    expect(t.text).toBe('Bara ren text')
    expect(t.language).toBe('sv')
  })

  it('handles JSON without a segments array as a single segment', async () => {
    const a = makeFile('nosegs.webm')
    queueFetch([jsonResponse({ language: 'en', text: 'Hello world' })])

    const t = await transcribe([a], config, 12)

    expect(t.language).toBe('en')
    expect(t.segments).toEqual([{ startSec: 0, endSec: 12, text: 'Hello world' }])
    expect(t.text).toBe('Hello world')
  })

  it('parses JSON returned with a text/plain content-type', async () => {
    const a = makeFile('jsonastext.webm')
    queueFetch([
      textResponse(
        JSON.stringify({ language: 'sv', segments: [{ start: 0, end: 3, text: 'Hej' }] })
      )
    ])

    const t = await transcribe([a], config, 3)

    expect(t.segments).toEqual([{ startSec: 0, endSec: 3, text: 'Hej' }])
  })

  it('throws an HttpError-derived error on a non-2xx response', async () => {
    const a = makeFile('bad.webm')
    queueFetch([new Response('nope', { status: 500 })])
    await expect(transcribe([a], config, 5)).rejects.toThrow(/HTTP 500/)
  })
})

describe('testTranscriptionConnection', () => {
  it('reports success on any reachable HTTP response (incl. 404)', async () => {
    queueFetch([
      new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    ])
    const res = await testTranscriptionConnection(config)
    expect(res.ok).toBe(true)
    expect(res.message).toBe('Anslutningen fungerar')
  })

  it('reports an auth problem on 401', async () => {
    queueFetch([new Response('', { status: 401 })])
    const res = await testTranscriptionConnection(config)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Fel eller saknad API-nyckel')
  })

  it('reports unreachable on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    )
    const res = await testTranscriptionConnection(config)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Servern svarar inte — kontrollera adressen')
  })
})

describe('transcribeLiveWindow', () => {
  it('uploads the window from memory and returns its text', async () => {
    queueFetch([
      jsonResponse({
        language: 'sv',
        text: ' Då kör vi. ',
        segments: [{ start: 0, end: 2, text: ' Då kör vi. ' }]
      })
    ])
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer

    await expect(transcribeLiveWindow(audio, config)).resolves.toBe('Då kör vi.')

    const fetchMock = vi.mocked(fetch)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8000/v1/audio/transcriptions')
    const form = init.body as FormData
    const file = form.get('file') as File
    expect(file.name).toBe('live.webm')
    expect(file.size).toBe(4)
    expect(form.get('language')).toBe('sv')
  })

  it('rejects on an HTTP error so the live queue can count the failure', async () => {
    queueFetch([new Response('overloaded', { status: 503 })])
    await expect(transcribeLiveWindow(new ArrayBuffer(4), config)).rejects.toThrow()
  })
})

describe('built-in transcription component', () => {
  const builtInConfig: TranscriptionConfig = {
    ...config,
    preset: 'built-in',
    // A stale settings value must not decide where the managed component is.
    baseUrl: 'http://localhost:9999/v1'
  }
  // The module remembers a failed GPU start; each test starts from a fresh one.
  let mod: typeof import('./transcription')

  function installed(...components: string[]): void {
    componentMocks.isLocalAiComponentInstalled.mockImplementation((c: string) =>
      components.includes(c)
    )
  }

  function gpuFailsToStart(): void {
    componentMocks.ensureLocalAiComponentRunning.mockImplementation(async (c: string) => {
      if (c === 'transcription-gpu') {
        throw new Error('Komponenten avslutades innan den blev redo (kod 1)')
      }
    })
  }

  beforeEach(async () => {
    componentMocks.ensureLocalAiComponentRunning.mockReset()
    componentMocks.ensureLocalAiComponentRunning.mockImplementation(async () => undefined)
    componentMocks.isLocalAiComponentInstalled.mockReset()
    vi.resetModules()
    mod = await import('./transcription')
  })

  function started(): string[] {
    return componentMocks.ensureLocalAiComponentRunning.mock.calls.map(([c]) => c)
  }

  it('uses the GPU component when it is installed', async () => {
    installed('transcription-cpu', 'transcription-gpu')
    queueFetch([jsonResponse({ language: 'sv', text: 'Hej', segments: [] })])

    await mod.transcribeLiveWindow(new ArrayBuffer(4), builtInConfig)

    expect(started()).toEqual(['transcription-gpu'])
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8310/v1/audio/transcriptions')
  })

  it("uses the dictation engine's model when it serves transcription", async () => {
    installed('transcription-cpu', 'transcription-gpu')
    mod.shareTranscriptionWith(async () => 'http://127.0.0.1:51116/v1')
    await expect(mod.startBuiltInTranscription()).resolves.toEqual({
      component: 'dictation-engine',
      baseUrl: 'http://127.0.0.1:51116/v1'
    })
    expect(started()).toEqual([])
  })

  it('starts its own component when the dictation engine is not running', async () => {
    installed('transcription-cpu')
    mod.shareTranscriptionWith(async () => null)
    await expect(mod.startBuiltInTranscription()).resolves.toMatchObject({
      component: 'transcription-cpu'
    })
    mod.shareTranscriptionWith(async () => {
      throw new Error('motorn svarar inte')
    })
    await expect(mod.startBuiltInTranscription()).resolves.toMatchObject({
      component: 'transcription-cpu'
    })
  })

  it('uses the CPU component when the GPU one is not installed', async () => {
    installed('transcription-cpu')
    await expect(mod.startBuiltInTranscription()).resolves.toMatchObject({
      component: 'transcription-cpu',
      baseUrl: 'http://127.0.0.1:8310/v1'
    })
    expect(started()).toEqual(['transcription-cpu'])
  })

  it('falls back to the CPU component when the GPU one cannot start', async () => {
    installed('transcription-cpu', 'transcription-gpu')
    gpuFailsToStart()
    const a = makeFile('fallback.webm')
    queueFetch([jsonResponse({ language: 'sv', segments: [{ start: 0, end: 2, text: 'Hej' }] })])

    const t = await mod.transcribe([a], builtInConfig, 2)

    expect(t.text).toBe('Hej')
    expect(started()).toEqual(['transcription-gpu', 'transcription-cpu'])
  })

  it('does not retry a failed GPU start for every later request', async () => {
    installed('transcription-cpu', 'transcription-gpu')
    gpuFailsToStart()

    await mod.startBuiltInTranscription()
    await mod.startBuiltInTranscription()

    expect(started()).toEqual(['transcription-gpu', 'transcription-cpu', 'transcription-cpu'])
  })

  it('explains in Swedish when the GPU fails and there is no CPU component', async () => {
    installed('transcription-gpu')
    gpuFailsToStart()

    const error = await mod.startBuiltInTranscription().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/GPU-transkriberingen kunde inte starta/)
    expect((error as Error).message).toMatch(/Installera CPU-transkriberingen/)
    expect((error as { rawDetail?: string }).rawDetail).toMatch(/kod 1/)
    expect(started()).toEqual(['transcription-gpu'])
  })

  it('reports the CPU fallback from the connection test, retrying the GPU first', async () => {
    installed('transcription-cpu', 'transcription-gpu')
    gpuFailsToStart()
    await mod.startBuiltInTranscription()
    componentMocks.ensureLocalAiComponentRunning.mockClear()
    queueFetch([jsonResponse({ data: [] })])

    const res = await mod.testTranscriptionConnection(builtInConfig)

    expect(started()).toEqual(['transcription-gpu', 'transcription-cpu'])
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/CPU-transkriberingen används i stället/)
    expect(res.detail).toMatch(/kod 1/)
  })

  it('fails the connection test with the Swedish explanation when nothing can run', async () => {
    installed('transcription-gpu')
    gpuFailsToStart()

    const res = await mod.testTranscriptionConnection(builtInConfig)

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/GPU-transkriberingen kunde inte starta/)
  })
})

describe('transcribe beforeSegment', () => {
  it('waits for the gate before sending each segment', async () => {
    const a = makeFile('gate-a.webm')
    const b = makeFile('gate-b.webm')
    queueFetch([
      jsonResponse({ language: 'sv', segments: [{ start: 0, end: 4, text: 'Hej' }] }),
      jsonResponse({ language: 'sv', segments: [{ start: 0, end: 3, text: 'då' }] })
    ])
    const releases: (() => void)[] = []
    const beforeSegment = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)))

    const result = transcribe([a, b], config, 7, { beforeSegment })
    await vi.waitFor(() => expect(beforeSegment).toHaveBeenCalledTimes(1))
    expect(fetch).not.toHaveBeenCalled()

    releases[0]()
    await vi.waitFor(() => expect(beforeSegment).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledTimes(1)

    releases[1]()
    const transcript = await result
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(transcript.text).toBe('Hej då')
  })
})
