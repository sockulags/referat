import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import type { Transcript } from '../shared/types'
import { dismissSpeakerSuggestion, readTranscript, renameSpeaker, writeTranscript } from './storage'
import { saveDiarizationSettings } from './settings'
import { listSpeakerProfiles, profilesWithEmbeddings } from './speakerProfiles'

// storage/settings/speakerProfiles all resolve their files via
// app.getPath('userData'); point that at a temp dir. safeStorage is imported
// by settings but never touched by these tests.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-storage-'))
  return {
    app: { getPath: (): string => dir },
    safeStorage: {
      isEncryptionAvailable: (): boolean => false,
      encryptString: (): Buffer => Buffer.alloc(0),
      decryptString: (): string => ''
    }
  }
})

const userData = app.getPath('userData')
// Must match the storage module's meeting id format.
const MEETING_ID = '20260101120000-test01'

function baseTranscript(): Transcript {
  return {
    language: 'sv',
    text: 'A B',
    segments: [
      { startSec: 0, endSec: 5, text: 'A', speaker: 'S1' },
      { startSec: 5, endSec: 10, text: 'B', speaker: 'S2' }
    ],
    speakers: { S1: 'Talare 1', S2: 'Talare 2' },
    speakerEmbeddings: { S1: [1, 0], S2: [0, 1] },
    speakerSuggestions: { S1: 'Anna', S2: 'Bertil' }
  }
}

function setRecognition(recognitionEnabled: boolean): void {
  saveDiarizationSettings({ enabled: true, baseUrl: 'http://localhost:8300', recognitionEnabled })
}

beforeEach(() => {
  rmSync(join(userData, 'meetings', MEETING_ID), { recursive: true, force: true })
  rmSync(join(userData, 'speaker-profiles.json'), { force: true })
  mkdirSync(join(userData, 'meetings', MEETING_ID), { recursive: true })
  writeTranscript(MEETING_ID, baseTranscript())
})

afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('renameSpeaker', () => {
  it('clears the suggestion for the renamed speaker and keeps the rest', () => {
    setRecognition(false)
    renameSpeaker(MEETING_ID, 'S1', 'Anna')
    const t = readTranscript(MEETING_ID)!
    expect(t.speakers).toEqual({ S1: 'Anna', S2: 'Talare 2' })
    expect(t.speakerSuggestions).toEqual({ S2: 'Bertil' })
  })

  it('enrolls a voice profile when recognition is enabled and an embedding exists', () => {
    setRecognition(true)
    renameSpeaker(MEETING_ID, 'S1', '  Anna  ')
    const profiles = listSpeakerProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('Anna')
    expect(profiles[0].sampleCount).toBe(1)
    expect(profilesWithEmbeddings()[0].embedding).toEqual([1, 0])
  })

  it('does not enroll a profile when recognition is disabled', () => {
    setRecognition(false)
    renameSpeaker(MEETING_ID, 'S1', 'Anna')
    expect(listSpeakerProfiles()).toEqual([])
  })

  it('does not enroll a profile when the speaker has no embedding', () => {
    setRecognition(true)
    const t = baseTranscript()
    delete t.speakerEmbeddings
    writeTranscript(MEETING_ID, t)
    renameSpeaker(MEETING_ID, 'S1', 'Anna')
    expect(listSpeakerProfiles()).toEqual([])
    expect(readTranscript(MEETING_ID)!.speakers).toEqual({ S1: 'Anna', S2: 'Talare 2' })
  })

  it('reverting to the default name keeps the suggestion and enrolls nothing', () => {
    setRecognition(true)
    renameSpeaker(MEETING_ID, 'S1', '   ')
    const t = readTranscript(MEETING_ID)!
    expect(t.speakers).toEqual({ S1: 'Talare 1', S2: 'Talare 2' })
    expect(t.speakerSuggestions).toEqual({ S1: 'Anna', S2: 'Bertil' })
    expect(listSpeakerProfiles()).toEqual([])
  })

  it('is a no-op for an unknown speaker id', () => {
    setRecognition(true)
    renameSpeaker(MEETING_ID, 'S9', 'Anna')
    expect(readTranscript(MEETING_ID)).toEqual(baseTranscript())
    expect(listSpeakerProfiles()).toEqual([])
  })

  it('updates the same profile when the name is confirmed in a second meeting', () => {
    setRecognition(true)
    renameSpeaker(MEETING_ID, 'S1', 'Anna')
    // Same name renamed again (e.g. next meeting): running average, count 2.
    writeTranscript(MEETING_ID, baseTranscript())
    renameSpeaker(MEETING_ID, 'S1', 'Anna')
    const profiles = listSpeakerProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].sampleCount).toBe(2)
  })
})

describe('dismissSpeakerSuggestion', () => {
  it('removes only the dismissed suggestion from transcript.json', () => {
    dismissSpeakerSuggestion(MEETING_ID, 'S1')
    const t = readTranscript(MEETING_ID)!
    expect(t.speakerSuggestions).toEqual({ S2: 'Bertil' })
    // Everything else is untouched.
    expect(t.speakers).toEqual({ S1: 'Talare 1', S2: 'Talare 2' })
    expect(t.speakerEmbeddings).toEqual({ S1: [1, 0], S2: [0, 1] })
  })

  it('drops the suggestions map entirely when the last one is dismissed', () => {
    dismissSpeakerSuggestion(MEETING_ID, 'S1')
    dismissSpeakerSuggestion(MEETING_ID, 'S2')
    expect(readTranscript(MEETING_ID)!).not.toHaveProperty('speakerSuggestions')
  })

  it('is a no-op when the suggestion or transcript is absent', () => {
    dismissSpeakerSuggestion(MEETING_ID, 'S9')
    expect(readTranscript(MEETING_ID)).toEqual(baseTranscript())
    // Missing meeting: must not throw.
    expect(() => dismissSpeakerSuggestion('20260101120000-none', 'S1')).not.toThrow()
  })
})
