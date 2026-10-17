// OpenAI-compatible transcription client (multipart -> /audio/transcriptions).

import { readFile } from 'fs/promises'
import { basename } from 'path'
import type {
  ConnectionTestResult,
  LocalAiComponent,
  Transcript,
  TranscriptSegment
} from '../../shared/types'
import type { TranscriptionConfig } from '../settings'
import {
  ensureLocalAiComponentRunning,
  isLocalAiComponentInstalled,
  localAiComponentBaseUrl
} from '../localAiComponents'
import {
  authHeaders,
  classifyError,
  errorDetail,
  HttpError,
  isConnectionError,
  isTimeoutError,
  providerFetch,
  readBodyText,
  TEST_TIMEOUT_MS,
  trimBaseUrl,
  UserFacingError,
  WORK_TIMEOUT_MS
} from './shared'

/**
 * Why the GPU component could not start, once it has failed in this session.
 * Later requests go straight to the CPU component instead of paying for
 * another failed start — live windows arrive every few seconds.
 */
let gpuStartFailure: string | null = null

interface BuiltInTranscriber {
  component: LocalAiComponent
  baseUrl: string
  /** Set when the GPU component is installed but the CPU one had to step in. */
  gpuFailure?: string
}

/**
 * Start the managed transcription component: the GPU build when it is
 * installed, else the CPU build. A GPU build that cannot start (no CUDA-capable
 * card, a driver too old for CUDA 12) must not leave the user without
 * transcription, so the CPU build takes over when it is installed too.
 *
 * `retryGpu` tries the GPU build again even after it failed in this session —
 * the connection test does, so it reports what works now.
 */
export async function startBuiltInTranscription({
  retryGpu = false
}: { retryGpu?: boolean } = {}): Promise<BuiltInTranscriber> {
  const cpuInstalled = isLocalAiComponentInstalled('transcription-cpu')
  if (isLocalAiComponentInstalled('transcription-gpu')) {
    if (retryGpu) gpuStartFailure = null
    if (!gpuStartFailure) {
      try {
        await ensureLocalAiComponentRunning('transcription-gpu')
        return builtIn('transcription-gpu')
      } catch (err) {
        gpuStartFailure = errorDetail(err)
      }
    }
    if (!cpuInstalled) {
      throw new UserFacingError(
        'GPU-transkriberingen kunde inte starta på den här datorn. Installera CPU-transkriberingen i Inställningar, så används den i stället.',
        gpuStartFailure
      )
    }
    await ensureLocalAiComponentRunning('transcription-cpu')
    return { ...builtIn('transcription-cpu'), gpuFailure: gpuStartFailure }
  }
  await ensureLocalAiComponentRunning('transcription-cpu')
  return builtIn('transcription-cpu')
}

function builtIn(component: LocalAiComponent): BuiltInTranscriber {
  return { component, baseUrl: `${localAiComponentBaseUrl(component)}/v1` }
}

/**
 * The config to send requests with. For the managed component the address is
 * where referat started it, not the base URL from settings.
 */
async function resolveConfig(config: TranscriptionConfig): Promise<TranscriptionConfig> {
  if (config.preset !== 'built-in') return config
  const transcriber = await startBuiltInTranscription()
  return { ...config, baseUrl: transcriber.baseUrl }
}

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
  return transcribeBytes(bytes, basename(audioFilePath), config, durationSec, WORK_TIMEOUT_MS)
}

async function transcribeBytes(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  config: TranscriptionConfig,
  durationSec: number,
  timeoutMs: number
): Promise<Transcript> {
  const file = new File([bytes], fileName, { type: 'audio/webm' })

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
    signal: AbortSignal.timeout(timeoutMs)
  })

  if (!res.ok) {
    throw new HttpError(res.status, await readBodyText(res))
  }

  const data = await parseResponse(res)
  return buildTranscript(data, config.language, durationSec)
}

export interface TranscribeOptions {
  /** Awaited before each segment is sent; lets the caller hold the transcriber. */
  beforeSegment?: () => Promise<void>
}

/**
 * Transcribe one or more recorded segments in order and concatenate them,
 * offsetting each segment's timestamps by the cumulative duration of prior
 * segments. Keeping one file per ~10-min segment keeps every request under
 * provider size caps (OpenAI rejects >25 MB) without buffering the whole meeting.
 */
export async function transcribe(
  audioFilePaths: string[],
  settingsConfig: TranscriptionConfig,
  durationSec: number,
  opts: TranscribeOptions = {}
): Promise<Transcript> {
  if (audioFilePaths.length === 0) {
    throw new Error('Ingen ljudfil att transkribera')
  }
  const config = await resolveConfig(settingsConfig)

  // Even split as a fallback when a server returns no per-segment timings.
  const fallbackPerSegment = durationSec > 0 ? durationSec / audioFilePaths.length : 0

  const segments: TranscriptSegment[] = []
  const texts: string[] = []
  let language = ''
  let offset = 0

  for (const path of audioFilePaths) {
    await opts.beforeSegment?.()
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

/**
 * A live window is 10–25 s of audio. A transcriber that needs longer than
 * this is too slow to keep up anyway, and the next window is already waiting.
 */
const LIVE_TIMEOUT_MS = 60_000

/** Transcribe one live window — a complete webm file held in memory. */
export async function transcribeLiveWindow(
  audio: ArrayBuffer,
  settingsConfig: TranscriptionConfig
): Promise<string> {
  const config = await resolveConfig(settingsConfig)
  const transcript = await transcribeBytes(
    new Uint8Array(audio),
    'live.webm',
    config,
    0,
    LIVE_TIMEOUT_MS
  )
  return transcript.text
}

export async function testTranscriptionConnection(
  config: TranscriptionConfig
): Promise<ConnectionTestResult> {
  let base = trimBaseUrl(config.baseUrl)
  let gpuFailure: string | undefined
  if (config.preset === 'built-in') {
    try {
      const transcriber = await startBuiltInTranscription({ retryGpu: true })
      base = transcriber.baseUrl
      gpuFailure = transcriber.gpuFailure
    } catch (err) {
      if (err instanceof UserFacingError) return { ok: false, ...classifyError(err) }
      return {
        ok: false,
        message: 'Den lokala transkriberingen är inte redo',
        detail: errorDetail(err)
      }
    }
  }
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
    if (gpuFailure) {
      return {
        ok: true,
        message: 'GPU-transkriberingen kunde inte starta — CPU-transkriberingen används i stället',
        detail: gpuFailure
      }
    }
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
