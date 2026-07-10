// OpenAI-compatible transcription client (multipart -> /audio/transcriptions).

import { readFile } from 'fs/promises'
import { basename } from 'path'
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

/** Transcribe a single audio file (one recorded segment). */
async function transcribeFile(
  audioFilePath: string,
  config: TranscriptionConfig,
  durationSec: number
): Promise<Transcript> {
  const bytes = await readFile(audioFilePath)
  const file = new File([bytes], basename(audioFilePath), { type: 'audio/webm' })

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

/**
 * Transcribe one or more recorded segments in order and concatenate them,
 * offsetting each segment's timestamps by the cumulative duration of prior
 * segments. Keeping one file per ~10-min segment keeps every request under
 * provider size caps (OpenAI rejects >25 MB) without buffering the whole meeting.
 */
export async function transcribe(
  audioFilePaths: string[],
  config: TranscriptionConfig,
  durationSec: number
): Promise<Transcript> {
  if (audioFilePaths.length === 0) {
    throw new Error('Ingen ljudfil att transkribera')
  }

  // Even split as a fallback when a server returns no per-segment timings.
  const fallbackPerSegment = durationSec > 0 ? durationSec / audioFilePaths.length : 0

  const segments: TranscriptSegment[] = []
  const texts: string[] = []
  let language = ''
  let offset = 0

  for (const path of audioFilePaths) {
    const part = await transcribeFile(path, config, fallbackPerSegment)
    if (!language) language = part.language
    for (const seg of part.segments) {
      segments.push({
        startSec: seg.startSec + offset,
        endSec: seg.endSec + offset,
        text: seg.text
      })
    }
    if (part.text) texts.push(part.text)
    // This segment's duration = its last endSec (server-provided), else the
    // proportional fallback. Advances the offset for the next segment.
    const lastEnd = part.segments.length > 0 ? part.segments[part.segments.length - 1].endSec : 0
    offset += lastEnd > 0 ? lastEnd : fallbackPerSegment
  }

  return {
    language: language || config.language || 'sv',
    segments,
    text: texts.join(' ').trim()
  }
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
