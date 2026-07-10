import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transcribe, testTranscriptionConnection } from './transcription'
import type { TranscriptionConfig } from '../settings'

const config: TranscriptionConfig = {
  baseUrl: 'http://localhost:8000/v1',
  model: 'whisper-1',
  language: 'sv',
  apiKey: ''
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
