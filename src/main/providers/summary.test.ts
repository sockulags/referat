import { describe, it, expect, afterEach, vi } from 'vitest'
import { summarize, testSummaryConnection } from './summary'
import type { SummaryConfig } from '../settings'

function baseConfig(over: Partial<SummaryConfig> = {}): SummaryConfig {
  return {
    apiFlavor: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    promptTemplate: 'Sammanfatta:\n{{transcript}}',
    apiKey: '',
    ...over
  }
}

interface Call {
  url: string
  init: RequestInit
}

/** Stub fetch, recording each call and replying with one queued Response. */
function recordFetch(responses: Response[]): Call[] {
  const q = [...responses]
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init })
      const next = q.shift()
      if (!next) throw new Error('fetch called more times than responses queued')
      return Promise.resolve(next)
    })
  )
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('summarize (openai-compatible)', () => {
  it('returns the trimmed assistant content', async () => {
    recordFetch([json({ choices: [{ message: { content: '  # Protokoll  ' } }] })])
    const out = await summarize('transkript text', baseConfig())
    expect(out).toBe('# Protokoll')
  })

  it('returns an empty string when there are no choices', async () => {
    recordFetch([json({ choices: [] })])
    expect(await summarize('x', baseConfig())).toBe('')
  })

  it('returns an empty string when the message has no content', async () => {
    recordFetch([json({ choices: [{ message: {} }] })])
    expect(await summarize('x', baseConfig())).toBe('')
  })

  it('posts to <baseUrl>/chat/completions and substitutes {{transcript}}', async () => {
    const calls = recordFetch([json({ choices: [{ message: { content: 'ok' } }] })])
    await summarize('MÖTESTEXT', baseConfig())
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    const body = bodyOf(calls[0])
    expect(body.model).toBe('llama3')
    expect((body.messages as { content: string }[])[0].content).toBe('Sammanfatta:\nMÖTESTEXT')
  })

  it('appends the transcript when the template has no {{transcript}} token', async () => {
    const calls = recordFetch([json({ choices: [{ message: { content: 'ok' } }] })])
    await summarize('BODY', baseConfig({ promptTemplate: 'Instruktion utan token' }))
    const content = (bodyOf(calls[0]).messages as { content: string }[])[0].content
    expect(content).toBe('Instruktion utan token\n\nBODY')
  })
})

describe('summarize (anthropic)', () => {
  it('joins text blocks and ignores non-text blocks', async () => {
    recordFetch([
      json({
        content: [
          { type: 'text', text: 'Del 1 ' },
          { type: 'thinking', text: 'IGNORERAS' },
          { type: 'text', text: 'Del 2' }
        ]
      })
    ])
    const out = await summarize('x', baseConfig({ apiFlavor: 'anthropic' }))
    expect(out).toBe('Del 1 Del 2')
  })

  it('normalizes a baseUrl that already ends in /v1 (no /v1/v1)', async () => {
    const calls = recordFetch([json({ content: [{ type: 'text', text: 'ok' }] })])
    await summarize(
      'x',
      baseConfig({ apiFlavor: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' })
    )
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('uses the Anthropic default base when baseUrl is empty', async () => {
    const calls = recordFetch([json({ content: [{ type: 'text', text: 'ok' }] })])
    await summarize('x', baseConfig({ apiFlavor: 'anthropic', baseUrl: '' }))
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })
})

describe('testSummaryConnection', () => {
  it('is ok on a successful minimal request', async () => {
    recordFetch([json({ choices: [{ message: { content: 'OK' } }] })])
    const res = await testSummaryConnection(baseConfig())
    expect(res.ok).toBe(true)
  })

  it('maps 401 to the API-key message', async () => {
    recordFetch([json({ error: 'unauthorized' }, 401)])
    const res = await testSummaryConnection(baseConfig())
    expect(res).toMatchObject({ ok: false, message: 'Fel eller saknad API-nyckel' })
  })

  it('maps 404 to the model-not-found message', async () => {
    recordFetch([json({ error: 'no model' }, 404)])
    const res = await testSummaryConnection(baseConfig())
    expect(res.message).toBe('Modellen hittades inte — kontrollera modellnamnet')
  })

  it('maps a network failure to the address-check message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    )
    const res = await testSummaryConnection(baseConfig())
    expect(res.message).toBe('Servern svarar inte — kontrollera adressen')
  })
})
