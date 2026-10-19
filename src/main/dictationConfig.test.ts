import { describe, expect, it } from 'vitest'

import { dictationEngineConfig } from './dictationConfig'

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
