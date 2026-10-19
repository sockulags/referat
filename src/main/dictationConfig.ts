import type { DictationSettings } from '../shared/types'

/**
 * The engine's settings, with the keys of Viska's config.json, for referat's
 * dictation settings. History is referat's to keep, never the engine's.
 */
export function dictationEngineConfig(settings: DictationSettings): Record<string, unknown> {
  return {
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
