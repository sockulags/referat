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
      promptTemplate: 'Skriv protokoll av {{transcript}}'
    })

    expect(getSettings().summary).toMatchObject({
      preset: 'codex',
      backend: 'codex-cli',
      hasApiKey: false
    })
    expect(getSummaryConfig()).toMatchObject({
      backend: 'codex-cli',
      promptTemplate: 'Skriv protokoll av {{transcript}}',
      apiKey: ''
    })
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
