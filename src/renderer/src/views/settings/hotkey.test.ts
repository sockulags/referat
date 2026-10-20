import { describe, expect, it } from 'vitest'
import { hotkeyFromKey, hotkeyFromMouse, hotkeyLabel, isModifierOnly } from './hotkey'

const press = (
  code: string,
  mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}
): Parameters<typeof hotkeyFromKey>[0] => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('hotkeyFromKey', () => {
  it('names function keys and other keys the engine knows', () => {
    expect(hotkeyFromKey(press('F9'))).toEqual({ hotkey: 'f9' })
    expect(hotkeyFromKey(press('F24'))).toEqual({ hotkey: 'f24' })
    expect(hotkeyFromKey(press('PageDown'))).toEqual({ hotkey: 'page down' })
    expect(hotkeyFromKey(press('Numpad5'))).toEqual({ hotkey: 'num 5' })
  })

  it('puts modifiers first, in the order the engine is used to', () => {
    expect(hotkeyFromKey(press('Space', { ctrlKey: true }))).toEqual({ hotkey: 'ctrl+space' })
    expect(hotkeyFromKey(press('KeyD', { altKey: true, shiftKey: true }))).toEqual({
      hotkey: 'alt+shift+d'
    })
    expect(hotkeyFromKey(press('F2', { metaKey: true }))).toEqual({ hotkey: 'win+f2' })
  })

  it('wants ctrl, alt or win with a key that types something', () => {
    expect(hotkeyFromKey(press('KeyA'))).toEqual({ error: 'needsModifier' })
    expect(hotkeyFromKey(press('Digit1', { shiftKey: true }))).toEqual({ error: 'needsModifier' })
    expect(hotkeyFromKey(press('Space'))).toEqual({ error: 'needsModifier' })
  })

  it('turns down keys the engine cannot listen for', () => {
    expect(hotkeyFromKey(press('Enter'))).toEqual({ error: 'unsupported' })
    expect(hotkeyFromKey(press('ArrowUp'))).toEqual({ error: 'unsupported' })
  })
})

describe('isModifierOnly', () => {
  it('waits while only a modifier is down', () => {
    expect(isModifierOnly('ControlLeft')).toBe(true)
    expect(isModifierOnly('MetaRight')).toBe(true)
    expect(isModifierOnly('KeyC')).toBe(false)
  })
})

describe('hotkeyFromMouse', () => {
  it('takes the wheel and the thumb buttons, never left or right', () => {
    expect(hotkeyFromMouse(1)).toEqual({ hotkey: 'mouse3' })
    expect(hotkeyFromMouse(3)).toEqual({ hotkey: 'mouse4' })
    expect(hotkeyFromMouse(4)).toEqual({ hotkey: 'mouse5' })
    expect(hotkeyFromMouse(0)).toBeNull()
    expect(hotkeyFromMouse(2)).toBeNull()
  })
})

describe('hotkeyLabel', () => {
  it('reads like the keyboard', () => {
    expect(hotkeyLabel('f9')).toBe('F9')
    expect(hotkeyLabel('ctrl+space')).toBe('Ctrl + Space')
    expect(hotkeyLabel('page down')).toBe('Page Down')
    expect(hotkeyLabel('mouse4')).toBe('Musens bakåtknapp')
  })
})
