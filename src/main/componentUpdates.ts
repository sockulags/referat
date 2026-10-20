// Whether an installed local AI component is the one this version of referat
// ships. Pure, so the rules are tested without downloads.
//
// Each install records the sha256 of the release asset it came from. A new
// version of referat looks up its own release's checksum for the same asset:
// the same checksum means the component is unchanged, a different one means
// it was rebuilt and should be updated. Checksums rather than version
// numbers, since most releases ship components that did not change at all —
// and those should never be downloaded again.

import type { LocalAiComponent } from '../shared/types'

export type UpdateDecision = 'current' | 'update' | 'adopt'

/**
 * What to do with an installed component, given the checksum it was
 * installed from (null when the install predates the record) and the one in
 * this version's release.
 *
 * Installs from before the record are from 0.11.0 or 0.12.0-beta.1. The
 * transcription and diarization builds have not changed since 0.11.0, so
 * those adopt this release's checksum without a download. The dictation
 * engine first shipped in 0.12.0-beta.1 and has changed since, so an
 * unrecorded dictation install is out of date.
 */
export function updateDecision(
  component: LocalAiComponent,
  installed: string | null,
  release: string
): UpdateDecision {
  if (installed === null) return component.startsWith('dictation-') ? 'update' : 'adopt'
  return installed === release ? 'current' : 'update'
}

/** The checksum in a .sha256 asset ("<hex>  <file>"), or null when it is not one. */
export function parseSha256(text: string): string | null {
  const value = text.trim().split(/\s+/)[0]?.toLowerCase()
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null
}
