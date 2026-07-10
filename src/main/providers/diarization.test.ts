import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diarize, testDiarizationConnection } from './diarization'
import type { DiarizationConfig } from '../settings'

const config: DiarizationConfig = {
  enabled: true,
  baseUrl: 'http://localhost:8300',
  recognitionEnabled: false
}

const recognitionConfig: DiarizationConfig = { ...config, recognitionEnabled: true }

let dir: string

function makeFile(name: string): string {
  const p = join(dir, name)
  // Any bytes: the fetch that would upload them is stubbed.
  writeFileSync(p, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  return p
}

/** Build a queue-backed fetch stub that returns one canned Response per call. */
function queueFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const q = [...responses]
  const fn = vi.fn(() => {
    const next = q.shift()
    if (!next) throw new Error('fetch called more times than responses queued')
    return Promise.resolve(next)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'referat-diarize-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('diarize', () => {
  it('parses turns on the global timeline into DiarizationTurn objects', async () => {
    const a = makeFile('a.webm')
    const fetchFn = queueFetch([
      jsonResponse({
        turns: [
          { start: 0, end: 6, speaker: 'S1' },
          { start: 6, end: 12, speaker: 'S2' }
        ],
        speakers: 2
      })
    ])

    const result = await diarize([a], config)

    expect(result.turns).toEqual([
      { startSec: 0, endSec: 6, speaker: 'S1' },
      { startSec: 6, endSec: 12, speaker: 'S2' }
    ])
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:8300/diarize')
    expect(init.method).toBe('POST')
  })

  it('sends every audio file in order as the multipart field "files"', async () => {
    const a = makeFile('first.webm')
    const b = makeFile('second.webm')
    const fetchFn = queueFetch([jsonResponse({ turns: [] })])

    await diarize([a, b], config)

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const form = init.body as FormData
    const files = form.getAll('files') as File[]
    expect(files.map((f) => f.name)).toEqual(['first.webm', 'second.webm'])
  })

  it('tolerates missing or odd fields in turns', async () => {
    const a = makeFile('odd.webm')
    queueFetch([
      jsonResponse({
        turns: [
          { end: 6, speaker: 'S1' }, // no start -> 0
          { start: 6, speaker: 'S2' }, // no end -> start
          { start: 20, end: 10, speaker: 'S3' }, // end before start -> clamped
          { start: 12, end: 18 }, // no speaker -> dropped
          null // junk entry -> dropped
        ]
      })
    ])

    const result = await diarize([a], config)

    expect(result.turns).toEqual([
      { startSec: 0, endSec: 6, speaker: 'S1' },
      { startSec: 6, endSec: 6, speaker: 'S2' },
      { startSec: 20, endSec: 20, speaker: 'S3' }
    ])
  })

  it('returns no turns when the body lacks a turns array', async () => {
    const a = makeFile('empty.webm')
    queueFetch([jsonResponse({})])
    await expect(diarize([a], config)).resolves.toEqual({ turns: [] })
  })

  it('throws an HttpError-derived error on a non-2xx response', async () => {
    const a = makeFile('bad.webm')
    queueFetch([new Response('nope', { status: 500 })])
    await expect(diarize([a], config)).rejects.toThrow(/HTTP 500/)
  })

  it('requests and parses embeddings when recognition is enabled', async () => {
    const a = makeFile('recog.webm')
    const fetchFn = queueFetch([
      jsonResponse({
        turns: [{ start: 0, end: 6, speaker: 'S1' }],
        embeddings: { S1: [1, 0, 0], S2: [0, 1, 0] }
      })
    ])

    const result = await diarize([a], recognitionConfig)

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const form = init.body as FormData
    expect(form.get('embeddings')).toBe('true')
    expect(result.embeddings).toEqual({ S1: [1, 0, 0], S2: [0, 1, 0] })
  })

  it('does not request embeddings when recognition is disabled, and ignores any in the response', async () => {
    const a = makeFile('norecog.webm')
    const fetchFn = queueFetch([jsonResponse({ turns: [], embeddings: { S1: [1, 0, 0] } })])

    const result = await diarize([a], config)

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const form = init.body as FormData
    expect(form.get('embeddings')).toBeNull()
    expect(result).toEqual({ turns: [] })
  })

  it('drops malformed embedding entries and keeps the valid ones', async () => {
    const a = makeFile('badvec.webm')
    queueFetch([
      jsonResponse({
        turns: [],
        embeddings: {
          S1: [0.5, -0.5], // valid
          S2: [1, NaN], // non-finite (NaN serializes to null) -> dropped
          S3: 'not-an-array', // wrong type -> dropped
          S4: [], // empty -> dropped
          S5: [1, 'two'] // mixed types -> dropped
        }
      })
    ])

    const result = await diarize([a], recognitionConfig)

    expect(result.embeddings).toEqual({ S1: [0.5, -0.5] })
  })

  it('omits embeddings entirely when the response has none valid', async () => {
    const a = makeFile('novalid.webm')
    queueFetch([jsonResponse({ turns: [], embeddings: { S1: 'junk' } })])
    const result = await diarize([a], recognitionConfig)
    expect(result).toEqual({ turns: [] })
    expect(result).not.toHaveProperty('embeddings')
  })
})

describe('testDiarizationConnection', () => {
  it('reports success on a healthy response and surfaces model/device in the detail', async () => {
    const fetchFn = queueFetch([
      jsonResponse({ status: 'ok', model: 'pyannote/speaker-diarization-3.1', device: 'cuda' })
    ])

    const res = await testDiarizationConnection(config)

    expect(res.ok).toBe(true)
    expect(res.message).toBe('Anslutningen fungerar')
    expect(res.detail).toContain('pyannote/speaker-diarization-3.1')
    expect(res.detail).toContain('cuda')
    const [url] = fetchFn.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://localhost:8300/health')
  })

  it('reports success even when the health body is not JSON', async () => {
    queueFetch([new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })])
    const res = await testDiarizationConnection(config)
    expect(res.ok).toBe(true)
    expect(res.message).toBe('Anslutningen fungerar')
  })

  it('reports a server error on a non-2xx response', async () => {
    queueFetch([new Response('boom', { status: 500 })])
    const res = await testDiarizationConnection(config)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Servern svarade med ett fel (500)')
  })

  it('reports unreachable on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    )
    const res = await testDiarizationConnection(config)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Servern svarar inte — kontrollera adressen')
  })

  it('reports a timeout distinctly', async () => {
    const timeout = new Error('The operation timed out')
    timeout.name = 'TimeoutError'
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(timeout))
    )
    const res = await testDiarizationConnection(config)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Servern svarar inte (timeout)')
  })
})
