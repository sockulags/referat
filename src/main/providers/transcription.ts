// OpenAI-compatible transcription client (multipart -> /audio/transcriptions).

import { readFile } from 'fs/promises'
import type { ConnectionTestResult, Transcript, TranscriptSegment } from '../../shared/types'
import type { TranscriptionConfig } from '../settings'
import {
  authHeaders,
  errorDetail,
  HttpError,
  isConnectionError,
  isTimeoutError,
  providerFetch,
  readBodyText,
  TEST_TIMEOUT_MS,
  trimBaseUrl,
  WORK_TIMEOUT_MS
} from './shared'

interface VerboseSegment {
  start?: number
  end?: number
  text?: string
}

interface VerboseJson {
  language?: string
  duration?: number
  text?: string
  segments?: VerboseSegment[]
}

function buildTranscript(
  data: VerboseJson | string,
  fallbackLanguage: string,
  durationSec: number
): Transcript {
  // Plain text response (response_format=text or server that ignores verbose_json).
  if (typeof data === 'string') {
    const text = data.trim()
    return {
      language: fallbackLanguage || 'sv',
      segments: text ? [{ startSec: 0, endSec: durationSec, text }] : [],
      text
    }
  }

  const language = data.language || fallbackLanguage || 'sv'

  if (Array.isArray(data.segments) && data.segments.length > 0) {
    const segments: TranscriptSegment[] = data.segments.map((s) => ({
      startSec: typeof s.start === 'number' ? s.start : 0,
      endSec: typeof s.end === 'number' ? s.end : durationSec,
      text: (s.text ?? '').trim()
    }))
    const text = segments
      .map((s) => s.text)
      .join(' ')
      .trim()
    return { language, segments, text: data.text?.trim() || text }
  }

  // JSON without segments (plain json response_format): single segment.
  const text = (data.text ?? '').trim()
  return {
    language,
    segments: text ? [{ startSec: 0, endSec: durationSec, text }] : [],
    text
  }
}

async function parseResponse(res: Response): Promise<VerboseJson | string> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as VerboseJson
  }
  // Some servers return text/plain; try JSON first, fall back to raw text.
  const raw = await res.text()
  try {
    return JSON.parse(raw) as VerboseJson
  } catch {
    return raw
  }
}

export async function transcribe(
  audioFilePath: string,
  config: TranscriptionConfig,
  durationSec: number
): Promise<Transcript> {
  const bytes = await readFile(audioFilePath)
  const file = new File([bytes], 'audio.webm', { type: 'audio/webm' })

  const form = new FormData()
  form.append('file', file)
  form.append('model', config.model)
  if (config.language) form.append('language', config.language)
  form.append('response_format', 'verbose_json')

  const url = `${trimBaseUrl(config.baseUrl)}/audio/transcriptions`
  const res = await providerFetch(url, {
    method: 'POST',
    headers: authHeaders(config.apiKey),
    body: form,
    signal: AbortSignal.timeout(WORK_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new HttpError(res.status, await readBodyText(res))
  }

  const data = await parseResponse(res)
  return buildTranscript(data, config.language, durationSec)
}

export async function testTranscriptionConnection(
  config: TranscriptionConfig
): Promise<ConnectionTestResult> {
  const base = trimBaseUrl(config.baseUrl)
  try {
    // Prefer GET /models — any HTTP response means the server is reachable.
    let res: Response
    try {
      res = await providerFetch(`${base}/models`, {
        method: 'GET',
        headers: authHeaders(config.apiKey),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
      })
    } catch (inner) {
      if (isConnectionError(inner)) throw inner
      // Fall back to a HEAD on the base URL if /models itself blew up non-network.
      res = await providerFetch(base, {
        method: 'HEAD',
        headers: authHeaders(config.apiKey),
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
      })
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: 'Fel eller saknad API-nyckel',
        detail: `HTTP ${res.status} ${res.statusText}`
      }
    }
    // Any other HTTP response (incl. 404) = server reachable, treat as success.
    return {
      ok: true,
      message: 'Anslutningen fungerar',
      detail: `HTTP ${res.status} ${res.statusText}`
    }
  } catch (err) {
    if (isTimeoutError(err)) {
      return { ok: false, message: 'Servern svarar inte (timeout)', detail: errorDetail(err) }
    }
    return {
      ok: false,
      message: 'Servern svarar inte — kontrollera adressen',
      detail: errorDetail(err)
    }
  }
}
