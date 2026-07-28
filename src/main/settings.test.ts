import { afterAll, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { rmSync, writeFileSync } from 'node:fs'
import { getSettings, getSummaryConfig, saveSummarySettings } from './settings'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-settings-'))
  return {
    app: { getPath: (): string => dir },
    safeStorage: {
      isEncryptionAvailable: (): boolean => false,
      encryptString: (): Buffer => Buffer.alloc(0),
      decryptString: (): string => ''
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
})
