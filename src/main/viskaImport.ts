// Moving over from Viska, the standalone dictation app this feature grew out
// of. Once, at the first start that finds Viska's config.json: its dictation
// settings become referat's, and its replacement rules and vocabulary become
// glossary terms. Dictation is not switched on by this — that stays the
// user's choice.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DictationSettings } from '../shared/types'

export interface ViskaImport {
  dictation: Partial<DictationSettings>
  /** Correct spelling and the form Whisper heard; heard equals canonical for plain vocabulary. */
  terms: { canonical: string; heard: string }[]
}

export function viskaConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.APPDATA ? join(env.APPDATA, 'viska', 'config.json') : null
}

/** What referat can take from Viska's config. Unknown or odd values are left out. */
export function parseViskaConfig(raw: unknown): ViskaImport {
  const config = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const dictation: Partial<DictationSettings> = {}
  if (typeof config.hotkey === 'string' && config.hotkey.trim()) {
    dictation.hotkey = config.hotkey.trim().toLowerCase()
  }
  if (config.language === 'sv' || config.language === 'en') dictation.language = config.language
  // A device index is only valid in the process that listed it; a name lasts.
  if (typeof config.input_device === 'string') dictation.microphone = config.input_device
  if (typeof config.mic_avoid_bluetooth === 'boolean') {
    dictation.avoidBluetooth = config.mic_avoid_bluetooth
  }
  if (typeof config.live === 'boolean') dictation.live = config.live
  else if (config.live === 'auto') dictation.live = null
  if (typeof config.sounds === 'boolean') dictation.sounds = config.sounds

  const terms: ViskaImport['terms'] = []
  const replacements = config.replacements
  if (typeof replacements === 'object' && replacements !== null) {
    for (const [heard, written] of Object.entries(replacements)) {
      if (typeof written === 'string' && heard.trim() && written.trim()) {
        terms.push({ canonical: written.trim(), heard: heard.trim() })
      }
    }
  }
  if (typeof config.initial_prompt === 'string') {
    for (const word of config.initial_prompt.split(',')) {
      const term = word.trim()
      if (term && !terms.some((t) => t.canonical.toLowerCase() === term.toLowerCase())) {
        terms.push({ canonical: term, heard: term })
      }
    }
  }
  return { dictation, terms }
}

/** Viska's config, or null when there is none or it cannot be read. */
export function readViskaConfig(path: string | null): ViskaImport | null {
  if (!path || !existsSync(path)) return null
  try {
    return parseViskaConfig(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    console.error('Could not read Viska config, skipping the import', err)
    return null
  }
}

/** When the import ran and how many glossary terms it brought. */
export interface ViskaImportRecord {
  at: string
  terms: number
}

/**
 * Import from Viska unless that has happened before. Runs again on a later
 * start only if Viska's config could not be found this time.
 */
export function runViskaImport(deps: {
  alreadyDone: () => boolean
  read: () => ViskaImport | null
  saveDictation: (patch: Partial<DictationSettings>) => void
  addTerm: (canonical: string, heard: string) => void
  record: (record: ViskaImportRecord) => void
  now?: () => Date
}): ViskaImportRecord | null {
  if (deps.alreadyDone()) return null
  const found = deps.read()
  if (!found) return null
  deps.saveDictation(found.dictation)
  let added = 0
  for (const term of found.terms) {
    try {
      deps.addTerm(term.canonical, term.heard)
      added += 1
    } catch (err) {
      console.error('Could not import a Viska term', term, err)
    }
  }
  const record = { at: (deps.now?.() ?? new Date()).toISOString(), terms: added }
  deps.record(record)
  return record
}
