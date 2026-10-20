// The dictation key, caught from a key press or a mouse button and named the
// way the dictation engine reads it ("f9", "ctrl+space", "mouse4").

/** What a pressed key or button became: a key the engine takes, or why not. */
export type CaughtHotkey = { hotkey: string } | { error: 'unsupported' | 'needsModifier' }

interface KeyPress {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Keys the engine knows by name, by KeyboardEvent.code. */
const NAMED: Record<string, string> = {
  Space: 'space',
  Pause: 'pause',
  CapsLock: 'caps lock',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'page up',
  PageDown: 'page down',
  ScrollLock: 'scroll lock'
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/

/** A modifier alone: wait for the key that goes with it. */
export function isModifierOnly(code: string): boolean {
  return MODIFIER_CODES.test(code)
}

function keyName(code: string): string | null {
  const f = /^F([1-9]|1\d|2[0-4])$/.exec(code)
  if (f) return `f${f[1]}`
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  const numpad = /^Numpad(\d)$/.exec(code)
  if (numpad) return `num ${numpad[1]}`
  return NAMED[code] ?? null
}

/**
 * The hotkey for a key press. A letter, digit or space on its own would stop
 * the user typing it, so those need ctrl, alt or win with them.
 */
export function hotkeyFromKey(press: KeyPress): CaughtHotkey {
  const key = keyName(press.code)
  if (!key) return { error: 'unsupported' }
  const modifiers = [
    press.ctrlKey && 'ctrl',
    press.altKey && 'alt',
    press.shiftKey && 'shift',
    press.metaKey && 'win'
  ].filter((m): m is string => !!m)
  const typed = /^([a-z0-9]|space)$/.test(key)
  if (typed && !modifiers.some((m) => m !== 'shift')) return { error: 'needsModifier' }
  return { hotkey: [...modifiers, key].join('+') }
}

/**
 * The hotkey for a mouse button: the wheel and the two thumb buttons. The
 * left and right buttons are for clicking.
 */
export function hotkeyFromMouse(button: number): CaughtHotkey | null {
  if (button === 1) return { hotkey: 'mouse3' }
  if (button === 3) return { hotkey: 'mouse4' }
  if (button === 4) return { hotkey: 'mouse5' }
  return null
}

const MOUSE_LABELS: Record<string, string> = {
  mouse3: 'Hjulklick',
  'middle mouse': 'Hjulklick',
  hjulklick: 'Hjulklick',
  mouse4: 'Musens bakåtknapp',
  mouse5: 'Musens framåtknapp'
}

/** The hotkey as the user reads it: "Ctrl + Space", "F9", "Musens bakåtknapp". */
export function hotkeyLabel(hotkey: string): string {
  return hotkey
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      if (MOUSE_LABELS[part]) return MOUSE_LABELS[part]
      if (part === 'ctrl' || part === 'control') return 'Ctrl'
      if (part === 'win' || part === 'windows') return 'Win'
      if (/^f\d+$/.test(part)) return part.toUpperCase()
      return part
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    })
    .join(' + ')
}
