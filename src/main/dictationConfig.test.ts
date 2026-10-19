import { describe, expect, it } from 'vitest'

import { dictationEngineConfig, dictationGlossaryConfig } from './dictationConfig'
import type { GlossaryTerm } from '../shared/types'

describe('dictationEngineConfig', () => {
  const settings = {
    enabled: true,
    hotkey: 'f9',
    microphone: '',
    avoidBluetooth: true,
    language: 'sv' as const,
    live: null,
    sounds: true
  }

  it('lets the engine pick the microphone and the live mode when nothing is chosen', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({
      input_device: null,
      mic_avoid_bluetooth: true,
      live: 'auto'
    })
  })

  it('passes a chosen microphone and live mode through', () => {
    expect(
      dictationEngineConfig({ ...settings, microphone: 'Mikrofonmatris (Realtek)', live: false })
    ).toMatchObject({ input_device: 'Mikrofonmatris (Realtek)', live: false })
  })

  it('never lets the engine keep its own history or polish', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({ history_persist: false, flow: false })
  })
})

describe('dictationGlossaryConfig', () => {
  const term = (
    canonical: string,
    variants: string[],
    updatedAt: string,
    projectId?: string
  ): GlossaryTerm => ({ id: canonical, canonical, variants, updatedAt, projectId })

  it('turns every misheard variant into a replacement', () => {
    const config = dictationGlossaryConfig([
      term('Kubernetes', ['kuber nettes', 'kubber nätes'], '2026-10-20T08:00:00Z'),
      term('Avanza', ['avansa', 'Avanza'], '2026-10-19T08:00:00Z')
    ])
    expect(config.replacements).toEqual({
      'kuber nettes': 'Kubernetes',
      'kubber nätes': 'Kubernetes',
      avansa: 'Avanza'
    })
  })

  it('gives Whisper the most recently edited spellings first', () => {
    const config = dictationGlossaryConfig([
      term('Avanza', [], '2026-10-19T08:00:00Z'),
      term('Kubernetes', [], '2026-10-20T08:00:00Z')
    ])
    expect(config.initial_prompt).toBe('Kubernetes, Avanza')
  })

  it("leaves out a project's own terms", () => {
    const config = dictationGlossaryConfig([
      term('Projektord', ['projekt ord'], '2026-10-20T08:00:00Z', 'p1')
    ])
    expect(config).toEqual({ replacements: {}, initial_prompt: '' })
  })

  it('caps the prompt at forty terms', () => {
    const terms = Array.from({ length: 60 }, (_, i) =>
      term(`Term${i}`, [], `2026-10-20T08:${String(i).padStart(2, '0')}:00Z`)
    )
    expect(dictationGlossaryConfig(terms).initial_prompt.split(', ')).toHaveLength(40)
  })
})
