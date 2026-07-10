// Shared helpers for the fetch-based provider clients.

export const TEST_TIMEOUT_MS = 15000
/** Generous ceiling for real transcription/summarization work. */
export const WORK_TIMEOUT_MS = 900000

/** Trim a trailing slash so we can safely concatenate `/path`. */
export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * fetch that never follows redirects. Auth headers (including custom ones like
 * x-api-key, which Node fetch does NOT strip cross-origin) must not silently
 * travel to a redirect target; a redirecting API endpoint is a config error.
 */
export function providerFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, redirect: 'manual' }).then((res) => {
    if (res.status >= 300 && res.status < 400) {
      throw new HttpError(
        res.status,
        `Unexpected redirect to ${res.headers.get('location') ?? 'unknown'}`
      )
    }
    return res
  })
}

/** Read a response body as text for diagnostics, capped in length. */
export async function readBodyText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 2000)
  } catch {
    return ''
  }
}

/** True when the thrown error looks like a failure to reach the server. */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      err.name === 'TypeError' ||
      msg.includes('fetch failed') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('getaddrinfo')
    )
  }
  return false
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

export function errorDetail(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/**
 * Map an arbitrary provider failure to a plain-language Swedish message + raw detail.
 * Used by the pipeline so a provider error always lands as a friendly meeting error.
 */
export function classifyError(err: unknown): { message: string; detail: string } {
  const detail = errorDetail(err)
  if (isTimeoutError(err)) {
    return { message: 'Servern svarar inte (timeout)', detail }
  }
  if (isConnectionError(err)) {
    return { message: 'Servern svarar inte — kontrollera adressen', detail }
  }
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) {
      return { message: 'Fel eller saknad API-nyckel', detail }
    }
    if (err.status === 404) {
      return {
        message: 'Modellen eller endpointen hittades inte — kontrollera inställningarna',
        detail
      }
    }
    return { message: `Servern svarade med ett fel (${err.status})`, detail }
  }
  return { message: 'Något gick fel vid bearbetningen', detail }
}

/** Thrown when a provider returns a non-2xx HTTP response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'HttpError'
  }
}
