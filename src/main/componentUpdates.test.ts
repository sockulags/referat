import { describe, expect, it } from 'vitest'
import { parseSha256, updateDecision } from './componentUpdates'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('updateDecision', () => {
  it('leaves a component that is the one in this release', () => {
    expect(updateDecision('transcription-gpu', A, A)).toBe('current')
    expect(updateDecision('dictation-cpu', A, A)).toBe('current')
  })

  it('updates a component that was rebuilt for this release', () => {
    expect(updateDecision('dictation-gpu', A, B)).toBe('update')
    expect(updateDecision('diarization-cpu', A, B)).toBe('update')
  })

  it('updates a dictation engine installed before installs were recorded', () => {
    expect(updateDecision('dictation-cpu', null, A)).toBe('update')
    expect(updateDecision('dictation-gpu', null, A)).toBe('update')
  })

  it('keeps transcription and diarization installed before installs were recorded', () => {
    expect(updateDecision('transcription-cpu', null, A)).toBe('adopt')
    expect(updateDecision('diarization-gpu', null, A)).toBe('adopt')
  })
})

describe('parseSha256', () => {
  it('reads the checksum from a sha256sum line, with Windows line endings', () => {
    expect(parseSha256(`${A.toUpperCase()}  referat-dictation-cpu-win-x64.zip\r\n`)).toBe(A)
    expect(parseSha256(`${B}\n`)).toBe(B)
  })

  it('turns down anything else', () => {
    expect(parseSha256('Not Found')).toBeNull()
    expect(parseSha256('')).toBeNull()
  })
})
