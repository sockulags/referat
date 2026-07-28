// UI-side convenience defaults for provider presets. The main process holds
// the real defaults; these just prefill fields when the user picks a preset.
import type { SummaryPreset, TranscriptionPreset, SummarySettings } from '../../shared/types'
import { strings } from './strings'

export const TRANSCRIPTION_PRESETS: TranscriptionPreset[] = ['local', 'openai', 'azure', 'custom']
export const SUMMARY_PRESETS: SummaryPreset[] = [
  'local',
  'openai',
  'azure',
  'anthropic',
  'codex',
  'custom'
]

export function presetLabel(preset: TranscriptionPreset | SummaryPreset): string {
  return strings.settings.presets[preset]
}

interface TranscriptionDefaults {
  baseUrl: string
  model: string
  needsKey: boolean
}

export function transcriptionDefaults(preset: TranscriptionPreset): TranscriptionDefaults {
  switch (preset) {
    case 'local':
      return {
        baseUrl: 'http://localhost:8000/v1',
        model: 'KBLab/kb-whisper-large',
        needsKey: false
      }
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', needsKey: true }
    case 'azure':
      return {
        baseUrl: 'https://<resurs>.openai.azure.com/openai/v1',
        model: 'whisper',
        needsKey: true
      }
    case 'custom':
      return { baseUrl: '', model: '', needsKey: false }
  }
}

interface SummaryDefaults {
  backend: SummarySettings['backend']
  baseUrl: string
  model: string
  apiFlavor: SummarySettings['apiFlavor']
  needsKey: boolean
}

export function summaryDefaults(preset: SummaryPreset): SummaryDefaults {
  switch (preset) {
    case 'local':
      return {
        backend: 'http',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        apiFlavor: 'openai-compatible',
        needsKey: false
      }
    case 'openai':
      return {
        backend: 'http',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiFlavor: 'openai-compatible',
        needsKey: true
      }
    case 'azure':
      return {
        backend: 'http',
        baseUrl: 'https://<resurs>.openai.azure.com/openai/v1',
        model: 'gpt-4o',
        apiFlavor: 'openai-compatible',
        needsKey: true
      }
    case 'anthropic':
      return {
        backend: 'http',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-latest',
        apiFlavor: 'anthropic',
        needsKey: true
      }
    case 'codex':
      return {
        backend: 'codex-cli',
        baseUrl: '',
        model: '',
        apiFlavor: 'openai-compatible',
        needsKey: false
      }
    case 'custom':
      return {
        backend: 'http',
        baseUrl: '',
        model: '',
        apiFlavor: 'openai-compatible',
        needsKey: false
      }
  }
}
