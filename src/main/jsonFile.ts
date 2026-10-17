// The small JSON files under userData. Reads are defensive: a missing, corrupt
// or hand-edited file yields nothing instead of an error, so one bad file never
// takes the app down. Writes are atomic: the JSON goes to a temp file that then
// replaces the target, so a crash mid-write never leaves a truncated file.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

/** The file's array items that pass `isItem`; [] when the file is missing or unreadable. */
export function readJsonArray<T>(path: string, isItem: (value: unknown) => value is T): T[] {
  try {
    if (!existsSync(path)) return []
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return Array.isArray(parsed) ? parsed.filter(isItem) : []
  } catch (err) {
    console.error(`Could not read ${path}, treating it as empty`, err)
    return []
  }
}

/** Write `value` as JSON, indented unless `compact`, replacing the file only once it is complete. */
export function writeJsonAtomic(path: string, value: unknown, compact = false): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, compact ? undefined : 2), 'utf-8')
  renameSync(tmp, path)
}
