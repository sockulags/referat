// Settings persistence. Stored as JSON in userData/settings.json.
// API keys are encrypted with Electron safeStorage and kept as base64 ciphertext;
// the plaintext key never crosses back to the renderer.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type {
  AppSettings,
  SaveTranscriptionSettings,
  SaveSummarySettings,
  SaveDiarizationSettings,
  SummaryTemplate
} from '../shared/types'
import { builtInTemplates, DEFAULT_PROMPT_TEMPLATE, DEFAULT_TEMPLATE_ID } from './summaryTemplates'

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
  backend: AppSettings['summary']['backend']
  apiFlavor: AppSettings['summary']['apiFlavor']
  baseUrl: string
  model: string
  templates: SummaryTemplate[]
  defaultTemplateId: string
  apiKeyEnc?: string
}

/** Local unauthenticated companion server — no API key to store. */
interface StoredDiarization {
  enabled: boolean
  backend: 'built-in' | 'server'
  baseUrl: string
  /** Voice recognition across meetings (biometric data) — off by default. */
  recognitionEnabled: boolean
  hfTokenEnc?: string
}

interface StoredSettings {
  transcription: StoredTranscription
  summary: StoredSummary
  diarization: StoredDiarization
  microphoneId: string
  captureSystemAudio: boolean
  userName: string
  theme: AppSettings['theme']
  onboardingCompleted: boolean
}

/** Reject anything on disk that is not a usable template. */
function isTemplate(value: unknown): value is SummaryTemplate {
  const t = value as Partial<SummaryTemplate> | null
  return (
    !!t &&
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.name === 'string' &&
    typeof t.promptTemplate === 'string'
  )
}

/**
 * Resolve the template list from what is on disk. Built-in templates always
 * come back, in their canonical order, so a template added in a later version
 * appears after an upgrade; the user's edits to a built-in survive because the
 * stored name and prompt win. Custom templates follow, in their stored order.
 *
 * `legacyPrompt` is the single 0.5 prompt. A hand-edited one becomes the
 * protocol template's text — the alternative would silently discard it.
 */
function normalizeTemplates(stored: unknown, legacyPrompt?: string): SummaryTemplate[] {
  const builtIns = builtInTemplates()
  const list = Array.isArray(stored) ? stored.filter(isTemplate) : []
  if (list.length === 0) {
    if (legacyPrompt && legacyPrompt !== DEFAULT_PROMPT_TEMPLATE) {
      return builtIns.map((t) =>
        t.id === DEFAULT_TEMPLATE_ID ? { ...t, promptTemplate: legacyPrompt } : t
      )
    }
    return builtIns
  }
  const byId = new Map(list.map((t) => [t.id, t]))
  const merged = builtIns.map((t) => {
    const s = byId.get(t.id)
    return s ? { ...t, name: s.name, promptTemplate: s.promptTemplate } : t
  })
  const builtInIds = new Set(builtIns.map((t) => t.id))
  const custom = list
    .filter((t) => !builtInIds.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, promptTemplate: t.promptTemplate, builtIn: false }))
  return [...merged, ...custom]
}

/** Fall back to the protocol template when the stored id no longer exists. */
function resolveDefaultId(templates: SummaryTemplate[], stored: unknown): string {
  if (typeof stored === 'string' && templates.some((t) => t.id === stored)) return stored
  return templates.some((t) => t.id === DEFAULT_TEMPLATE_ID) ? DEFAULT_TEMPLATE_ID : templates[0].id
}

function defaults(): StoredSettings {
  return {
    transcription: {
      preset: 'built-in',
      baseUrl: 'http://127.0.0.1:8310/v1',
      model: 'KBLab/kb-whisper-small',
      language: 'sv'
    },
    summary: {
      preset: 'local',
      backend: 'http',
      apiFlavor: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      templates: builtInTemplates(),
      defaultTemplateId: DEFAULT_TEMPLATE_ID
    },
    diarization: {
      enabled: false,
      backend: 'built-in',
      baseUrl: 'http://127.0.0.1:8300',
      recognitionEnabled: false
    },
    microphoneId: '',
    captureSystemAudio: true,
    userName: '',
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
      // 0.5 and earlier stored a single promptTemplate here instead of a list.
      const storedSummary = parsed.summary as
        (StoredSummary & { promptTemplate?: string }) | undefined
      const templates = normalizeTemplates(storedSummary?.templates, storedSummary?.promptTemplate)
      cache = {
        transcription: { ...base.transcription, ...parsed.transcription },
        summary: {
          ...base.summary,
          ...parsed.summary,
          templates,
          defaultTemplateId: resolveDefaultId(templates, storedSummary?.defaultTemplateId)
        },
        diarization: { ...base.diarization, ...parsed.diarization },
        microphoneId: parsed.microphoneId ?? base.microphoneId,
        captureSystemAudio: parsed.captureSystemAudio ?? base.captureSystemAudio,
        userName: parsed.userName ?? base.userName,
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
      backend: s.summary.backend,
      apiFlavor: s.summary.apiFlavor,
      baseUrl: s.summary.baseUrl,
      model: s.summary.model,
      hasApiKey: !!s.summary.apiKeyEnc,
      templates: s.summary.templates,
      defaultTemplateId: s.summary.defaultTemplateId
    },
    diarization: {
      enabled: s.diarization.enabled,
      backend: s.diarization.backend,
      baseUrl: s.diarization.baseUrl,
      recognitionEnabled: s.diarization.recognitionEnabled,
      hasHfToken: !!s.diarization.hfTokenEnc
    },
    microphoneId: s.microphoneId,
    captureSystemAudio: s.captureSystemAudio,
    userName: s.userName,
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
  // The renderer may send a list that dropped a built-in or renamed one;
  // normalize so the built-ins always survive a save.
  const templates = normalizeTemplates(payload.templates)
  s.summary = {
    preset: payload.preset,
    backend: payload.backend,
    apiFlavor: payload.apiFlavor,
    baseUrl: payload.baseUrl,
    model: payload.model,
    templates,
    defaultTemplateId: resolveDefaultId(templates, payload.defaultTemplateId),
    apiKeyEnc: resolveKey(payload.apiKey, s.summary.apiKeyEnc)
  }
  persist(s)
}

/** Every available template, built-ins first. Never empty. */
export function getSummaryTemplates(): SummaryTemplate[] {
  return load().summary.templates
}

/**
 * The template with this id, falling back to the meeting-independent default
 * when the id is unknown (a template the user has since deleted).
 */
export function getSummaryTemplate(id: string | undefined): SummaryTemplate {
  const s = load().summary
  return s.templates.find((t) => t.id === id) ?? getDefaultSummaryTemplate()
}

export function getDefaultSummaryTemplate(): SummaryTemplate {
  const s = load().summary
  return s.templates.find((t) => t.id === s.defaultTemplateId) ?? s.templates[0]
}

/**
 * Remember the template last used to start a recording, so the picker opens on
 * it next time. Unknown ids are ignored rather than stored.
 */
export function setDefaultSummaryTemplate(id: string): void {
  const s = load()
  if (!s.summary.templates.some((t) => t.id === id)) return
  if (s.summary.defaultTemplateId === id) return
  s.summary = { ...s.summary, defaultTemplateId: id }
  persist(s)
}

export function saveDiarizationSettings(payload: SaveDiarizationSettings): void {
  const s = load()
  s.diarization = {
    enabled: payload.enabled,
    backend: payload.backend,
    baseUrl: payload.baseUrl,
    recognitionEnabled: payload.recognitionEnabled,
    hfTokenEnc: resolveKey(payload.hfToken, s.diarization.hfTokenEnc)
  }
  persist(s)
}

export function saveGeneralSettings(payload: {
  microphoneId?: string
  captureSystemAudio?: boolean
  userName?: string
  theme?: AppSettings['theme']
  onboardingCompleted?: boolean
}): void {
  const s = load()
  if (payload.microphoneId !== undefined) s.microphoneId = payload.microphoneId
  if (payload.captureSystemAudio !== undefined) s.captureSystemAudio = payload.captureSystemAudio
  if (payload.userName !== undefined) s.userName = payload.userName.trim()
  if (payload.theme !== undefined) s.theme = payload.theme
  if (payload.onboardingCompleted !== undefined) s.onboardingCompleted = payload.onboardingCompleted
  persist(s)
}

// ---- Internal config accessors (main-only; include decrypted key) ----

export interface TranscriptionConfig {
  preset: AppSettings['transcription']['preset']
  baseUrl: string
  model: string
  language: string
  apiKey: string
}

/** How to reach the model. Which prompt to send is decided per summary. */
export interface SummaryConfig {
  backend: AppSettings['summary']['backend']
  apiFlavor: 'openai-compatible' | 'anthropic'
  baseUrl: string
  model: string
  apiKey: string
}

export function getTranscriptionConfig(): TranscriptionConfig {
  const s = load()
  return {
    preset: s.transcription.preset,
    baseUrl: s.transcription.baseUrl,
    model: s.transcription.model,
    language: s.transcription.language,
    apiKey: decryptKey(s.transcription.apiKeyEnc)
  }
}

export interface DiarizationConfig {
  enabled: boolean
  backend: 'built-in' | 'server'
  baseUrl: string
  recognitionEnabled: boolean
  hfToken: string
}

/** What to call the person at the microphone. Empty when never set. */
export function getUserName(): string {
  return load().userName
}

export function getDiarizationConfig(): DiarizationConfig {
  const s = load()
  return {
    enabled: s.diarization.enabled,
    backend: s.diarization.backend,
    baseUrl: s.diarization.baseUrl,
    recognitionEnabled: s.diarization.recognitionEnabled,
    hfToken: decryptKey(s.diarization.hfTokenEnc)
  }
}

export function getSummaryConfig(): SummaryConfig {
  const s = load()
  return {
    backend: s.summary.backend,
    apiFlavor: s.summary.apiFlavor,
    baseUrl: s.summary.baseUrl,
    model: s.summary.model,
    apiKey: decryptKey(s.summary.apiKeyEnc)
  }
}
