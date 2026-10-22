import type { DictationSettings, GlossaryTerm, SpeechModel } from '../shared/types'

/** The engine's model setting: 'auto', or a KB-Whisper model on Hugging Face. */
export function speechModelId(model: SpeechModel): string {
  return model === 'auto' ? 'auto' : `KBLab/kb-whisper-${model}`
}

/**
 * The headset to tell the user about, from the engine's mic event: one it
 * left alone for the computer's microphone, not told about before.
 */
export function avoidedHeadset(
  event: { event: string; [field: string]: unknown },
  shown: string[]
): string | null {
  if (event.event !== 'mic') return null
  const headset = typeof event.avoided === 'string' ? event.avoided.trim() : ''
  return headset && !shown.includes(headset) ? headset : null
}

/** Whisper's prompt is short; the most recently edited terms get the room. */
const PROMPT_TERMS = 40

/**
 * The engine's settings, with the keys in dictation-engine/src/viska/config.py, for referat's
 * dictation settings. History is referat's to keep, never the engine's.
 */
export function dictationEngineConfig(
  settings: DictationSettings,
  terms: GlossaryTerm[] = [],
  model: SpeechModel = 'auto'
): Record<string, unknown> {
  return {
    ...dictationGlossaryConfig(terms),
    model: speechModelId(model),
    // No key while dictation is off: the engine then serves meetings only.
    hotkey: settings.enabled ? settings.hotkey : '',
    hotkey_mode: settings.hotkeyMode,
    input_device: settings.microphone || null,
    mic_avoid_bluetooth: settings.avoidBluetooth,
    language: settings.language,
    live: settings.live ?? 'auto',
    sounds: settings.sounds,
    history_persist: false,
    // The engine asks referat to rewrite (polish_request); referat uses the
    // summary's AI service, never a model of the engine's own.
    flow: settings.rewrite,
    // The engine reads the key as the dictation starts: held, it rewrites
    // ('with-key') or types the text as it was ('without-key').
    flow_key: settings.rewriteWhen === 'always' ? '' : settings.rewriteKey,
    flow_key_means: settings.rewriteWhen === 'without-key' ? 'raw' : 'polish'
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
