// Whether live transcription is on when the user has not chosen. Shared by
// main (which enforces it) and the settings view (which shows it).
//
// Live transcription sends audio while the meeting is still going on. That is
// harmless when the transcriber runs on this computer, but for any other
// server it is a new flow of data the user did not ask for, so it stays off
// until they turn it on.

import type { TranscriptionPreset } from './types'

/** True when the URL points at this computer. Unparseable URLs are not. */
export function isLoopbackUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

export function liveTranscriptionDefault(preset: TranscriptionPreset, baseUrl: string): boolean {
  return preset === 'built-in' || isLoopbackUrl(baseUrl)
}

/** The stored choice wins; null means the user never chose. */
export function isLiveTranscriptionOn(
  live: boolean | null | undefined,
  preset: TranscriptionPreset,
  baseUrl: string
): boolean {
  return typeof live === 'boolean' ? live : liveTranscriptionDefault(preset, baseUrl)
}
