// Local voice profile store for recognition across meetings. One JSON file at
// userData/speaker-profiles.json — biometric data that never leaves the
// machine, and the embedding itself never crosses IPC (listSpeakerProfiles
// strips it). Deletable per profile or all at once ("glöm rösten").

import { app } from 'electron'
import { join } from 'path'
import { rmSync } from 'fs'
import type { SpeakerProfile } from '../shared/types'
import { randomUUID } from 'crypto'
import { isValidEmbedding, type ProfileWithEmbedding } from './diarize'
import { readJsonArray, writeJsonAtomic } from './jsonFile'

/** On-disk shape: the IPC SpeakerProfile plus the embedding centroid. */
interface StoredProfile extends SpeakerProfile {
  embedding: number[]
}

function profilesPath(): string {
  return join(app.getPath('userData'), 'speaker-profiles.json')
}

function isStoredProfile(value: unknown): value is StoredProfile {
  const p = value as StoredProfile
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.updatedAt === 'string' &&
    typeof p.sampleCount === 'number' &&
    isValidEmbedding(p.embedding)
  )
}

function loadProfiles(): StoredProfile[] {
  return readJsonArray(profilesPath(), isStoredProfile)
}

function persist(profiles: StoredProfile[]): void {
  try {
    writeJsonAtomic(profilesPath(), profiles)
  } catch (err) {
    console.error('Failed to write speaker-profiles.json', err)
  }
}

/** Scale a vector to unit L2 norm. Zero vectors are returned unchanged. */
function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, n) => sum + n * n, 0))
  if (norm === 0) return v
  return v.map((n) => n / norm)
}

/** The IPC shape: profiles WITHOUT their embeddings, newest first. */
export function listSpeakerProfiles(): SpeakerProfile[] {
  return loadProfiles()
    .map(({ id, name, updatedAt, sampleCount }) => ({ id, name, updatedAt, sampleCount }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

export function deleteSpeakerProfile(id: string): void {
  const profiles = loadProfiles()
  const next = profiles.filter((p) => p.id !== id)
  if (next.length !== profiles.length) persist(next)
}

/** "Glöm alla röster": remove the whole file rather than writing []. */
export function deleteAllSpeakerProfiles(): void {
  try {
    rmSync(profilesPath(), { force: true })
  } catch (err) {
    console.error('Failed to delete speaker-profiles.json', err)
  }
}

/** Internal (main-only): full profiles for the pipeline's matching step. */
export function profilesWithEmbeddings(): ProfileWithEmbedding[] {
  return loadProfiles().map(({ id, name, embedding }) => ({ id, name, embedding }))
}

/**
 * Save or update a voice profile after the user names a speaker. An existing
 * profile with the same trimmed name gets a running-average centroid
 * (c*n + e)/(n+1), L2-renormalized so cosine matching stays well-behaved.
 * A dimension mismatch (server model changed) restarts the profile from the
 * new embedding instead of mixing incompatible vector spaces.
 */
export function upsertProfile(name: string, embedding: number[]): void {
  const trimmed = name.trim()
  if (!trimmed || !isValidEmbedding(embedding)) return

  const now = new Date().toISOString()
  const profiles = loadProfiles()
  const existing = profiles.find((p) => p.name === trimmed)

  if (!existing) {
    profiles.push({
      id: randomUUID(),
      name: trimmed,
      embedding: l2Normalize(embedding),
      updatedAt: now,
      sampleCount: 1
    })
  } else if (existing.embedding.length !== embedding.length) {
    existing.embedding = l2Normalize(embedding)
    existing.sampleCount = 1
    existing.updatedAt = now
  } else {
    const n = existing.sampleCount
    const averaged = existing.embedding.map((c, i) => (c * n + embedding[i]) / (n + 1))
    existing.embedding = l2Normalize(averaged)
    existing.sampleCount = n + 1
    existing.updatedAt = now
  }
  persist(profiles)
}
