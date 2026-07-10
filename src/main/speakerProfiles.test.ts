import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  deleteAllSpeakerProfiles,
  deleteSpeakerProfile,
  listSpeakerProfiles,
  profilesWithEmbeddings,
  upsertProfile
} from './speakerProfiles'

// The store resolves its file via app.getPath('userData'); point that at a
// temp dir so tests never touch a real profile store.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-profiles-'))
  return { app: { getPath: (): string => dir } }
})

const profilesFile = join(app.getPath('userData'), 'speaker-profiles.json')

beforeEach(() => {
  rmSync(profilesFile, { force: true })
})

afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
})

describe('upsertProfile', () => {
  it('creates a profile with a normalized embedding and sampleCount 1', () => {
    upsertProfile('Anna', [3, 0, 4])
    const [p] = profilesWithEmbeddings()
    expect(p.name).toBe('Anna')
    expect(p.embedding).toEqual([0.6, 0, 0.8]) // [3,0,4] / 5
    expect(listSpeakerProfiles()[0].sampleCount).toBe(1)
  })

  it('matches an existing profile on the trimmed exact name', () => {
    upsertProfile('  Anna  ', [1, 0])
    upsertProfile('Anna', [1, 0])
    const profiles = listSpeakerProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('Anna')
    expect(profiles[0].sampleCount).toBe(2)
  })

  it('updates the centroid with a running average and renormalizes', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Anna', [0, 1])
    const [p] = profilesWithEmbeddings()
    // avg of [1,0] and [0,1] is [0.5,0.5]; renormalized -> [1/sqrt2, 1/sqrt2].
    expect(p.embedding[0]).toBeCloseTo(Math.SQRT1_2)
    expect(p.embedding[1]).toBeCloseTo(Math.SQRT1_2)
    expect(listSpeakerProfiles()[0].sampleCount).toBe(2)
  })

  it('weights the centroid by sampleCount across several meetings', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Anna', [1, 0])
    upsertProfile('Anna', [1, 0])
    upsertProfile('Anna', [0, 1])
    // Centroid before renorm: ([1,0]*3 + [0,1]) / 4 = [0.75, 0.25].
    const [p] = profilesWithEmbeddings()
    const norm = Math.hypot(0.75, 0.25)
    expect(p.embedding[0]).toBeCloseTo(0.75 / norm)
    expect(p.embedding[1]).toBeCloseTo(0.25 / norm)
    expect(listSpeakerProfiles()[0].sampleCount).toBe(4)
  })

  it('restarts the profile on an embedding dimension change (server model swap)', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Anna', [0, 0, 2])
    const [p] = profilesWithEmbeddings()
    expect(p.embedding).toEqual([0, 0, 1])
    expect(listSpeakerProfiles()[0].sampleCount).toBe(1)
  })

  it('ignores empty names and invalid embeddings', () => {
    upsertProfile('   ', [1, 0])
    upsertProfile('Anna', [])
    upsertProfile('Anna', [1, NaN])
    expect(listSpeakerProfiles()).toEqual([])
  })

  it('keeps separate profiles for different names', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Bertil', [0, 1])
    expect(
      listSpeakerProfiles()
        .map((p) => p.name)
        .sort()
    ).toEqual(['Anna', 'Bertil'])
  })
})

describe('listSpeakerProfiles', () => {
  it('never exposes the embedding over the IPC shape', () => {
    upsertProfile('Anna', [1, 0])
    const [p] = listSpeakerProfiles()
    expect(p).not.toHaveProperty('embedding')
    expect(Object.keys(p).sort()).toEqual(['id', 'name', 'sampleCount', 'updatedAt'])
  })

  it('returns [] for a missing or corrupt store file', () => {
    expect(listSpeakerProfiles()).toEqual([])
    writeFileSync(profilesFile, '{not json', 'utf-8')
    expect(listSpeakerProfiles()).toEqual([])
  })

  it('filters out malformed entries from a hand-edited file', () => {
    writeFileSync(
      profilesFile,
      JSON.stringify([
        { id: 'ok', name: 'Anna', embedding: [1, 0], updatedAt: '2026-01-01', sampleCount: 1 },
        { id: 'bad', name: 'NoVector', updatedAt: '2026-01-01', sampleCount: 1 },
        'junk',
        null
      ]),
      'utf-8'
    )
    expect(listSpeakerProfiles().map((p) => p.name)).toEqual(['Anna'])
  })
})

describe('deleteSpeakerProfile / deleteAllSpeakerProfiles', () => {
  it('deletes a single profile by id', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Bertil', [0, 1])
    const anna = listSpeakerProfiles().find((p) => p.name === 'Anna')!
    deleteSpeakerProfile(anna.id)
    expect(listSpeakerProfiles().map((p) => p.name)).toEqual(['Bertil'])
  })

  it('is a no-op for an unknown id', () => {
    upsertProfile('Anna', [1, 0])
    deleteSpeakerProfile('does-not-exist')
    expect(listSpeakerProfiles()).toHaveLength(1)
  })

  it('deletes all profiles at once (removes the file)', () => {
    upsertProfile('Anna', [1, 0])
    upsertProfile('Bertil', [0, 1])
    deleteAllSpeakerProfiles()
    expect(listSpeakerProfiles()).toEqual([])
    expect(() => readFileSync(profilesFile, 'utf-8')).toThrow()
  })
})
