import { afterAll, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  getDiarizationConfig,
  getSettings,
  saveGeneralSettings,
  getSummaryConfig,
  getTranscriptionConfig,
  saveDiarizationSettings,
  saveSummarySettings,
  saveTranscriptionSettings
} from './settings'
import { DEFAULT_PROMPT_TEMPLATE } from './summaryTemplates'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-settings-'))
  return {
    app: { getPath: (): string => dir },
    safeStorage: {
      isEncryptionAvailable: (): boolean => true,
      encryptString: (plain: string): Buffer => Buffer.from(`encrypted:${plain}`),
      decryptString: (value: Buffer): string => value.toString().replace(/^encrypted:/, '')
    }
  }
})

const userData = app.getPath('userData')

afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('summary backend settings', () => {
  it('migrates legacy HTTP settings and persists the Codex CLI backend', () => {
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        summary: {
          preset: 'openai',
          apiFlavor: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          promptTemplate: 'Sammanfatta {{transcript}}'
        }
      })
    )

    expect(getSettings().summary).toMatchObject({
      preset: 'openai',
      backend: 'http',
      baseUrl: 'https://api.openai.com/v1'
    })

    saveSummarySettings({
      preset: 'codex',
      backend: 'codex-cli',
      apiFlavor: 'openai-compatible',
      baseUrl: '',
      model: '',
      templates: getSettings().summary.templates,
      defaultTemplateId: 'sammandrag'
    })

    expect(getSettings().summary).toMatchObject({
      preset: 'codex',
      backend: 'codex-cli',
      hasApiKey: false,
      defaultTemplateId: 'sammandrag'
    })
    expect(getSummaryConfig()).toMatchObject({
      backend: 'codex-cli',
      apiKey: ''
    })
  })

  it('turns a hand-edited 0.5 prompt into the protocol template', () => {
    // The single promptTemplate is what 0.5 wrote; it must not be discarded.
    expect(getSettings().summary.templates[0]).toMatchObject({
      id: 'protokoll',
      builtIn: true,
      promptTemplate: 'Sammanfatta {{transcript}}'
    })
    // The templates added in this version come along on the upgrade.
    expect(getSettings().summary.templates.map((t) => t.id)).toContain('uppfoljningsmejl')
  })

  it('keeps custom templates and restores a built-in the renderer dropped', () => {
    const custom = {
      id: 'egen-1',
      name: 'Egen mall',
      promptTemplate: 'Egen: {{transcript}}',
      builtIn: false
    }
    saveSummarySettings({
      preset: 'codex',
      backend: 'codex-cli',
      apiFlavor: 'openai-compatible',
      baseUrl: '',
      model: '',
      templates: [custom],
      defaultTemplateId: 'egen-1'
    })

    const templates = getSettings().summary.templates
    expect(templates.filter((t) => t.builtIn).map((t) => t.id)).toContain('protokoll')
    expect(templates.at(-1)).toMatchObject(custom)
    expect(getSettings().summary.defaultTemplateId).toBe('egen-1')
  })

  it('gives an untouched old protocol prompt the current one, and keeps an edited one', () => {
    const save = (promptTemplate: string): void =>
      saveSummarySettings({
        preset: 'codex',
        backend: 'codex-cli',
        apiFlavor: 'openai-compatible',
        baseUrl: '',
        model: '',
        templates: [{ id: 'protokoll', name: 'Protokoll', promptTemplate, builtIn: true }],
        defaultTemplateId: 'protokoll'
      })
    const protocol = (): string =>
      getSettings().summary.templates.find((t) => t.id === 'protokoll')!.promptTemplate

    save(DEFAULT_PROMPT_TEMPLATE)
    expect(protocol()).not.toContain('## Actionpunkter')
    expect(protocol()).toContain('## Öppna frågor')

    const edited = DEFAULT_PROMPT_TEMPLATE.replace('5–10 meningar', '3 meningar')
    save(edited)
    expect(protocol()).toBe(edited)
  })

  it('falls back to the protocol template when the default id no longer exists', () => {
    saveSummarySettings({
      preset: 'codex',
      backend: 'codex-cli',
      apiFlavor: 'openai-compatible',
      baseUrl: '',
      model: '',
      templates: [],
      defaultTemplateId: 'borttagen'
    })
    expect(getSettings().summary.defaultTemplateId).toBe('protokoll')
  })

  it('has a text about the recording until the user changes or clears it', () => {
    expect(getSettings().consentMessage).toMatch(/spelas in med referat/)
    saveGeneralSettings({ consentMessage: '  Vi spelar in.  ' })
    expect(getSettings().consentMessage).toBe('Vi spelar in.')
    saveGeneralSettings({ consentMessage: '' })
    expect(getSettings().consentMessage).toBe('')
  })

  it('keeps referat out of the background until the user turns it on', () => {
    expect(getSettings()).toMatchObject({ runInBackground: false, openAtLogin: false })
    saveGeneralSettings({ runInBackground: true, openAtLogin: true })
    expect(getSettings()).toMatchObject({ runInBackground: true, openAtLogin: true })
    saveGeneralSettings({ runInBackground: false, openAtLogin: false })
  })

  it('migrates diarization defaults and carries no Hugging Face token forward', () => {
    // 0.8 and earlier stored an encrypted token here so the user could download
    // the gated model. It ships inside the component now, so the field is gone
    // and a save must not write it back.
    expect(getSettings().diarization).toMatchObject({ backend: 'built-in' })
    expect(getSettings().diarization).not.toHaveProperty('hasHfToken')

    saveDiarizationSettings({
      enabled: true,
      backend: 'built-in',
      baseUrl: 'http://127.0.0.1:8300',
      recognitionEnabled: false
    })

    expect(getDiarizationConfig()).toMatchObject({ enabled: true, backend: 'built-in' })
    expect(getDiarizationConfig()).not.toHaveProperty('hfToken')
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).not.toContain('hfTokenEnc')
  })
})

describe('live transcription setting', () => {
  const openai = {
    preset: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    language: 'sv'
  }

  it('follows the transcriber until the user chooses, then keeps the choice', () => {
    saveTranscriptionSettings({ ...openai })
    expect(getSettings().transcription.live).toBeNull()
    expect(getTranscriptionConfig().live).toBe(false)

    saveTranscriptionSettings({ ...openai, live: true })
    expect(getSettings().transcription.live).toBe(true)
    expect(getTranscriptionConfig().live).toBe(true)

    // Onboarding and older callers send no live field: the choice survives.
    saveTranscriptionSettings({ ...openai })
    expect(getTranscriptionConfig().live).toBe(true)

    saveTranscriptionSettings({
      preset: 'built-in',
      baseUrl: 'http://127.0.0.1:8310/v1',
      model: 'KBLab/kb-whisper-small',
      language: 'sv',
      live: null
    })
    expect(getSettings().transcription.live).toBeNull()
    expect(getTranscriptionConfig().live).toBe(true)
    expect(
      JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf-8')).transcription
    ).not.toHaveProperty('live')
  })
})
