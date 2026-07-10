// Settings persistence. Stored as JSON in userData/settings.json.
// API keys are encrypted with Electron safeStorage and kept as base64 ciphertext;
// the plaintext key never crosses back to the renderer.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { AppSettings, SaveTranscriptionSettings, SaveSummarySettings } from '../shared/types'

/** On-disk shape: like AppSettings but with encrypted key blobs instead of hasApiKey. */
interface StoredTranscription {
  preset: AppSettings['transcription']['preset']
  baseUrl: string
  model: string
  language: string
  /** base64 safeStorage ciphertext, or empty/undefined when no key stored. */
  apiKeyEnc?: string
}

interface StoredSummary {
  preset: AppSettings['summary']['preset']
  apiFlavor: AppSettings['summary']['apiFlavor']
  baseUrl: string
  model: string
  promptTemplate: string
  apiKeyEnc?: string
}

interface StoredSettings {
  transcription: StoredTranscription
  summary: StoredSummary
  microphoneId: string
  captureSystemAudio: boolean
  theme: AppSettings['theme']
  onboardingCompleted: boolean
}

const DEFAULT_PROMPT_TEMPLATE = `Du är en erfaren mötessekreterare. Nedan följer en transkription av ett möte.
Skriv ett tydligt och professionellt mötesprotokoll i Markdown med exakt dessa rubriker:

## Sammanfattning
5–10 meningar som fångar mötets syfte och viktigaste innehåll.

## Beslut
Punktlista med de beslut som fattades. Skriv "Inga beslut fattades." om inga beslut togs.

## Actionpunkter
Punktlista med uppgifter. Ange ägare och deadline där det framgår, t.ex.
"- Ta fram budgetförslag — Anna (senast 15 mars)". Skriv "Inga actionpunkter." om inga finns.

## Öppna frågor
Punktlista med frågor som lämnades olösta. Skriv "Inga öppna frågor." om inga finns.

Regler:
- Svara på samma språk som transkriptionen är skriven på.
- Använd endast information som finns i transkriptionen. Hitta aldrig på namn, beslut eller siffror.
- Var koncis och saklig.

Transkription:
{{transcript}}`

function defaults(): StoredSettings {
  return {
    transcription: {
      preset: 'local',
      baseUrl: 'http://localhost:8000/v1',
      model: 'KBLab/kb-whisper-large',
      language: 'sv'
    },
    summary: {
      preset: 'local',
      apiFlavor: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      promptTemplate: DEFAULT_PROMPT_TEMPLATE
    },
    microphoneId: '',
    captureSystemAudio: true,
    theme: 'system',
    onboardingCompleted: false
  }
}

let cache: StoredSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function load(): StoredSettings {
  if (cache) return cache
  const base = defaults()
  try {
    const path = settingsPath()
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredSettings>
      cache = {
        transcription: { ...base.transcription, ...parsed.transcription },
        summary: { ...base.summary, ...parsed.summary },
        microphoneId: parsed.microphoneId ?? base.microphoneId,
        captureSystemAudio: parsed.captureSystemAudio ?? base.captureSystemAudio,
        theme: parsed.theme ?? base.theme,
        onboardingCompleted: parsed.onboardingCompleted ?? base.onboardingCompleted
      }
      return cache
    }
  } catch (err) {
    console.error('Failed to read settings.json, using defaults', err)
  }
  cache = base
  return cache
}

function persist(s: StoredSettings): void {
  cache = s
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write settings.json', err)
  }
}

/** Encrypt a plaintext key to base64 ciphertext. The product promise is that
 * keys never touch disk in plaintext, so if OS encryption is unavailable
 * (rare on Windows) we refuse to store the key rather than fall back. */
function encryptKey(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Nyckeln kan inte sparas: Windows-kryptering (DPAPI) är inte tillgänglig på den här datorn.'
    )
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decryptKey(enc: string | undefined): string {
  if (!enc) return ''
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch (err) {
    console.error('Failed to decrypt API key', err)
    return ''
  }
}

/**
 * Resolve the incoming apiKey field against the currently stored ciphertext.
 * - field absent      -> keep existing
 * - field === ''      -> clear
 * - field non-empty   -> encrypt & replace
 */
function resolveKey(
  incoming: string | undefined,
  existingEnc: string | undefined
): string | undefined {
  if (incoming === undefined) return existingEnc
  if (incoming === '') return undefined
  return encryptKey(incoming)
}

export function getSettings(): AppSettings {
  const s = load()
  return {
    transcription: {
      preset: s.transcription.preset,
      baseUrl: s.transcription.baseUrl,
      model: s.transcription.model,
      language: s.transcription.language,
      hasApiKey: !!s.transcription.apiKeyEnc
    },
    summary: {
      preset: s.summary.preset,
      apiFlavor: s.summary.apiFlavor,
      baseUrl: s.summary.baseUrl,
      model: s.summary.model,
      hasApiKey: !!s.summary.apiKeyEnc,
      promptTemplate: s.summary.promptTemplate
    },
    microphoneId: s.microphoneId,
    captureSystemAudio: s.captureSystemAudio,
    theme: s.theme,
    onboardingCompleted: s.onboardingCompleted
  }
}

export function saveTranscriptionSettings(payload: SaveTranscriptionSettings): void {
  const s = load()
  s.transcription = {
    preset: payload.preset,
    baseUrl: payload.baseUrl,
    model: payload.model,
    language: payload.language,
    apiKeyEnc: resolveKey(payload.apiKey, s.transcription.apiKeyEnc)
  }
  persist(s)
}

export function saveSummarySettings(payload: SaveSummarySettings): void {
  const s = load()
  s.summary = {
    preset: payload.preset,
    apiFlavor: payload.apiFlavor,
    baseUrl: payload.baseUrl,
    model: payload.model,
    promptTemplate: payload.promptTemplate,
    apiKeyEnc: resolveKey(payload.apiKey, s.summary.apiKeyEnc)
  }
  persist(s)
}

export function saveGeneralSettings(payload: {
  microphoneId?: string
  captureSystemAudio?: boolean
  theme?: AppSettings['theme']
  onboardingCompleted?: boolean
}): void {
  const s = load()
  if (payload.microphoneId !== undefined) s.microphoneId = payload.microphoneId
  if (payload.captureSystemAudio !== undefined) s.captureSystemAudio = payload.captureSystemAudio
  if (payload.theme !== undefined) s.theme = payload.theme
  if (payload.onboardingCompleted !== undefined) s.onboardingCompleted = payload.onboardingCompleted
  persist(s)
}

// ---- Internal config accessors (main-only; include decrypted key) ----

export interface TranscriptionConfig {
  baseUrl: string
  model: string
  language: string
  apiKey: string
}

export interface SummaryConfig {
  apiFlavor: 'openai-compatible' | 'anthropic'
  baseUrl: string
  model: string
  promptTemplate: string
  apiKey: string
}

export function getTranscriptionConfig(): TranscriptionConfig {
  const s = load()
  return {
    baseUrl: s.transcription.baseUrl,
    model: s.transcription.model,
    language: s.transcription.language,
    apiKey: decryptKey(s.transcription.apiKeyEnc)
  }
}

export function getSummaryConfig(): SummaryConfig {
  const s = load()
  return {
    apiFlavor: s.summary.apiFlavor,
    baseUrl: s.summary.baseUrl,
    model: s.summary.model,
    promptTemplate: s.summary.promptTemplate,
    apiKey: decryptKey(s.summary.apiKeyEnc)
  }
}
