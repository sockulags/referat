import { describe, expect, it } from 'vitest'
import { overlayChange } from './dictationOverlay'

describe('overlayChange', () => {
  it('shows recording with level bars and a clock', () => {
    expect(overlayChange({ event: 'listening' }, 'f9')).toMatchObject({
      tone: 'recording',
      meter: true,
      timer: true
    })
  })

  it('keeps only the tail of a long live text', () => {
    const long = 'ord '.repeat(40)
    const change = overlayChange({ event: 'partial', text: long }, 'f9')
    expect(change).not.toBe('hide')
    const text = (change as { text: string }).text
    expect(text.startsWith('…')).toBe(true)
    expect(text.length).toBe(71)
  })

  it('names the hotkey when the model is ready', () => {
    expect(overlayChange({ event: 'model_ready', device: 'cuda' }, 'f9')).toMatchObject({
      text: 'Diktering redo – håll F9 och prata',
      autoHideMs: 3000
    })
  })

  it('tells a taken hotkey apart from the configured one', () => {
    expect(overlayChange({ event: 'hotkey_failed', hotkey: 'f10' }, 'f9')).toMatchObject({
      tone: 'warning',
      text: 'F10 används redan av ett annat program'
    })
  })

  it('never shows a problem in the recording colour', () => {
    for (const event of ['mic_failed', 'failed', 'model_failed', 'hotkey_failed']) {
      expect(overlayChange({ event }, 'f9')).toMatchObject({ tone: 'warning' })
    }
  })

  it('hides when the dictation is done and ignores what is not for the pill', () => {
    expect(overlayChange({ event: 'idle' }, 'f9')).toBe('hide')
    for (const event of ['level', 'status', 'history', 'mic', 'recording', 'ok']) {
      expect(overlayChange({ event }, 'f9')).toBe(null)
    }
  })
})
