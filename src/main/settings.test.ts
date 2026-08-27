import { afterAll, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  getDiarizationConfig,
  getSettings,
  getSummaryConfig,
  saveDiarizationSettings,
  saveSummarySettings
} from './settings'

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

  it('migrates diarization defaults and keeps the Hugging Face token encrypted at rest', () => {
    expect(getSettings().diarization).toMatchObject({
      backend: 'built-in',
      hasHfToken: false
    })

    saveDiarizationSettings({
      enabled: true,
      backend: 'built-in',
      baseUrl: 'http://127.0.0.1:8300',
      recognitionEnabled: false,
      hfToken: 'hf_secret_token'
    })

    expect(getSettings().diarization.hasHfToken).toBe(true)
    expect(getDiarizationConfig().hfToken).toBe('hf_secret_token')
    expect(readFileSync(join(userData, 'settings.json'), 'utf8')).not.toContain('hf_secret_token')
  })
})
