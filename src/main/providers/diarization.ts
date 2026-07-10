// Diarization client for the local companion server (multipart -> /diarize).
// The server decodes and concatenates all segment files onto one global
// timeline, so speaker labels are consistent across the whole meeting.

import { readFile } from 'fs/promises'
import { basename } from 'path'
import type { ConnectionTestResult } from '../../shared/types'
import type { DiarizationConfig } from '../settings'
import {
  errorDetail,
  HttpError,
  isTimeoutError,
  providerFetch,
  readBodyText,
  TEST_TIMEOUT_MS,
  trimBaseUrl,
  WORK_TIMEOUT_MS
} from './shared'

/** One speaker turn on the global (concatenated) timeline, in seconds. */
export interface DiarizationTurn {
  startSec: number
  endSec: number
  speaker: string
}

interface RawTurn {
  start?: number
  end?: number
  speaker?: string
}

interface DiarizeResponse {
  turns?: RawTurn[]
}

/** Map the raw server payload to turns, tolerating missing/odd fields. */
function buildTurns(data: DiarizeResponse): DiarizationTurn[] {
  if (!Array.isArray(data.turns)) return []
  const turns: DiarizationTurn[] = []
  for (const t of data.turns) {
    const speaker = typeof t?.speaker === 'string' ? t.speaker.trim() : ''
    if (!speaker) continue // a turn without a speaker label is useless
    const startSec = typeof t.start === 'number' && Number.isFinite(t.start) ? t.start : 0
    const rawEnd = typeof t.end === 'number' && Number.isFinite(t.end) ? t.end : startSec
    turns.push({ startSec, endSec: Math.max(startSec, rawEnd), speaker })
  }
  return turns
}

/**
 * Diarize a meeting's audio segments. All files travel in ONE request, in
 * recording order — that is what keeps the speaker labels ('S1', 'S2', …)
 * globally consistent across files.
 */
export async function diarize(
  audioFilePaths: string[],
  config: DiarizationConfig
): Promise<DiarizationTurn[]> {
  const form = new FormData()
  for (const path of audioFilePaths) {
    const bytes = await readFile(path)
    form.append('files', new File([bytes], basename(path), { type: 'audio/webm' }))
  }

  const url = `${trimBaseUrl(config.baseUrl)}/diarize`
  const res = await providerFetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(WORK_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new HttpError(res.status, await readBodyText(res))
  }

  const data = (await res.json()) as DiarizeResponse
  return buildTurns(data)
}

interface HealthResponse {
  status?: string
  model?: string
  device?: string
}

export async function testDiarizationConnection(
  config: DiarizationConfig
): Promise<ConnectionTestResult> {
  const base = trimBaseUrl(config.baseUrl)
  try {
    const res = await providerFetch(`${base}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
    })

    if (res.ok) {
      let detail = `HTTP ${res.status} ${res.statusText}`
      try {
        const data = (await res.json()) as HealthResponse
        const parts: string[] = []
        if (typeof data.model === 'string' && data.model) parts.push(`modell: ${data.model}`)
        if (typeof data.device === 'string' && data.device) parts.push(`enhet: ${data.device}`)
        if (parts.length > 0) detail = `${detail} — ${parts.join(', ')}`
      } catch {
        // Non-JSON health body: keep the plain HTTP detail.
      }
      return { ok: true, message: 'Anslutningen fungerar', detail }
    }

    return {
      ok: false,
      message: `Servern svarade med ett fel (${res.status})`,
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
