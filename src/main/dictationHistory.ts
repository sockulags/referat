// The dictations made with referat, so the user can copy one again or fix a
// misheard word. Kept on this computer only, in userData/dictations.json, and
// pruned to the last week: dictations are everyday text, not an archive.

import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { DictationEntry } from '../shared/types'
import { readJsonArray, writeJsonAtomic } from './jsonFile'

export const KEEP_DAYS = 7
const MAX_ENTRIES = 500

function historyPath(): string {
  return join(app.getPath('userData'), 'dictations.json')
}

function isEntry(value: unknown): value is DictationEntry {
  const e = value as DictationEntry
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof e.id === 'string' &&
    typeof e.text === 'string' &&
    typeof e.at === 'string' &&
    (e.app === null || typeof e.app === 'string')
  )
}

/** Newest first, without anything older than KEEP_DAYS. */
function current(now: Date): DictationEntry[] {
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000
  return readJsonArray(historyPath(), isEntry)
    .filter((entry) => Date.parse(entry.at) >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ENTRIES)
}

export function listDictations(now = new Date()): DictationEntry[] {
  return current(now)
}

export function addDictation(
  text: string,
  appName: string | null,
  now = new Date()
): DictationEntry {
  const entry: DictationEntry = { id: randomUUID(), text, app: appName, at: now.toISOString() }
  writeJsonAtomic(historyPath(), [entry, ...current(now)].slice(0, MAX_ENTRIES))
  return entry
}

export function deleteDictation(id: string): void {
  writeJsonAtomic(
    historyPath(),
    current(new Date()).filter((entry) => entry.id !== id)
  )
}

export function clearDictations(): void {
  writeJsonAtomic(historyPath(), [])
}
