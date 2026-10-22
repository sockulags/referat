import { describe, expect, it } from 'vitest'

import { avoidedHeadset, dictationEngineConfig, dictationGlossaryConfig } from './dictationConfig'
import type { DictationSettings, GlossaryTerm } from '../shared/types'

describe('dictationEngineConfig', () => {
  const settings: DictationSettings = {
    enabled: true,
    hotkey: 'f9',
    hotkeyMode: 'auto',
    microphone: '',
    avoidBluetooth: true,
    language: 'sv',
    live: null,
    sounds: true,
    rewrite: false,
    rewriteWhen: 'always',
    rewriteKey: 'ctrl',
    rewriteInstruction: 'Skriv om'
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

  it('gives the engine no key while dictation is off, so it serves meetings only', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({ hotkey: 'f9' })
    expect(dictationEngineConfig({ ...settings, enabled: false })).toMatchObject({ hotkey: '' })
  })

  it('names the chosen KB-Whisper model, or lets the engine pick', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({ model: 'auto' })
    expect(dictationEngineConfig(settings, [], 'medium')).toMatchObject({
      model: 'KBLab/kb-whisper-medium'
    })
    expect(dictationEngineConfig(settings, [], 'large')).toMatchObject({
      model: 'KBLab/kb-whisper-large'
    })
  })

  it('never lets the engine keep its own history', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({ history_persist: false })
  })

  it('has the engine ask for a rewrite only when the user wants one', () => {
    expect(dictationEngineConfig(settings)).toMatchObject({ flow: false })
    expect(dictationEngineConfig({ ...settings, rewrite: true })).toMatchObject({ flow: true })
  })

  it('tells the engine which key decides the rewrite, and which way', () => {
    const rewrite = { ...settings, rewrite: true }
    expect(dictationEngineConfig(rewrite)).toMatchObject({ flow_key: '' })
    expect(
      dictationEngineConfig({ ...rewrite, rewriteWhen: 'with-key', rewriteKey: 'shift' })
    ).toMatchObject({ flow_key: 'shift', flow_key_means: 'polish' })
    expect(dictationEngineConfig({ ...rewrite, rewriteWhen: 'without-key' })).toMatchObject({
      flow_key: 'ctrl',
      flow_key_means: 'raw'
    })
  })

  it('passes how the key starts and stops a dictation', () => {
    expect(dictationEngineConfig({ ...settings, hotkeyMode: 'toggle' })).toMatchObject({
      hotkey_mode: 'toggle'
    })
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

describe('avoidedHeadset', () => {
  const mic = (avoided: unknown): { event: string; avoided: unknown } => ({ event: 'mic', avoided })

  it('names a headset dictation left alone, the first time', () => {
    expect(avoidedHeadset(mic('Headset (Jabra Evolve3 85)'), [])).toBe('Headset (Jabra Evolve3 85)')
  })

  it('stays quiet about a headset the user was already told about', () => {
    expect(
      avoidedHeadset(mic('Headset (Jabra Evolve3 85)'), ['Headset (Jabra Evolve3 85)'])
    ).toBeNull()
  })

  it('stays quiet when no headset was avoided, or for other events', () => {
    expect(avoidedHeadset(mic(null), [])).toBeNull()
    expect(avoidedHeadset(mic('  '), [])).toBeNull()
    expect(avoidedHeadset({ event: 'listening', avoided: 'Headset' }, [])).toBeNull()
  })
})
