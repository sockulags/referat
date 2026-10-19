import type { DictationSettings, GlossaryTerm } from '../shared/types'

/** Whisper's prompt is short; the most recently edited terms get the room. */
const PROMPT_TERMS = 40

/**
 * The engine's settings, with the keys of Viska's config.json, for referat's
 * dictation settings. History is referat's to keep, never the engine's.
 */
export function dictationEngineConfig(
  settings: DictationSettings,
  terms: GlossaryTerm[] = []
): Record<string, unknown> {
  return {
    ...dictationGlossaryConfig(terms),
    hotkey: settings.hotkey,
    input_device: settings.microphone || null,
    mic_avoid_bluetooth: settings.avoidBluetooth,
    language: settings.language,
    live: settings.live ?? 'auto',
    sounds: settings.sounds,
    history_persist: false,
    flow: false
  }
}

/**
 * The glossary as the engine uses it. Every misheard variant becomes a
 * replacement with the correct spelling, and the correct spellings become
 * Whisper's prompt, so a term is more often right in the first place.
 * Only terms for every meeting count: a dictation belongs to no project.
 */
export function dictationGlossaryConfig(terms: GlossaryTerm[]): {
  replacements: Record<string, string>
  initial_prompt: string
} {
  const global = terms.filter((term) => !term.projectId && term.canonical.trim())
  const replacements: Record<string, string> = {}
  for (const term of global) {
    const canonical = term.canonical.trim()
    for (const variant of term.variants) {
      const heard = variant.trim()
      if (heard && heard.toLowerCase() !== canonical.toLowerCase()) replacements[heard] = canonical
    }
  }
  const prompt = [...global]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, PROMPT_TERMS)
    .map((term) => term.canonical.trim())
  return { replacements, initial_prompt: prompt.join(', ') }
}
