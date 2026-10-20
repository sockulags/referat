// What the dictation status pill shows, decided from the dictation engine's
// events. Pure, so the main process and the tests share one mapping.

/** Channels from the main process to the pill's window. */
export const OVERLAY_CHANNELS = {
  state: 'dictation-overlay:state',
  level: 'dictation-overlay:level',
  /** From the pill: a button was clicked. */
  action: 'dictation-overlay:action',
  /** From the pill: where the pill is in its window, after each change. */
  rect: 'dictation-overlay:rect'
} as const

/** The pill's place in its window, in CSS pixels. */
export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

/** Whether a screen point is on the pill, given the window's place on the screen. */
export function pointOnPill(
  point: { x: number; y: number },
  window: { x: number; y: number },
  pill: OverlayRect
): boolean {
  const left = window.x + pill.x
  const top = window.y + pill.y
  return (
    point.x >= left && point.x < left + pill.width && point.y >= top && point.y < top + pill.height
  )
}

/** What the pill's buttons ask the engine to do; named as the engine's commands. */
export type OverlayAction = 'insert_raw' | 'cancel'

export type OverlayTone = 'recording' | 'neutral' | 'success' | 'warning'
export type OverlayIcon = 'dot' | 'spinner' | 'wave' | 'check' | 'alert'

export interface OverlayState {
  tone: OverlayTone
  icon: OverlayIcon
  text: string
  /** Live level bars, fed by level events while recording. */
  meter?: boolean
  /** A running mm:ss clock from when the state was shown. */
  timer?: boolean
  /** Hide by itself after this long; absent stays until the next state. */
  autoHideMs?: number
  /**
   * Show "Infoga råtext" and "Avbryt" while the AI rewrites a dictation, so
   * the user need not wait for it. The pill takes clicks only then.
   */
  actions?: boolean
}

/** What the pill's window may do: listen, and report its two buttons. */
export interface OverlayApi {
  onState(cb: (state: OverlayState) => void): void
  onLevel(cb: (value: number) => void): void
  act(action: OverlayAction): void
  /** Where the pill is now, so the main process knows when the pointer is on it. */
  rect(rect: OverlayRect): void
}

/** The pill's reaction to one event: a new state, hide it, or leave it be. */
export type OverlayChange = OverlayState | 'hide' | null

const PARTIAL_LENGTH = 70

/** The last part of a long live text, which is the part still being spoken. */
function tail(text: string): string {
  const clean = text.trim()
  return clean.length > PARTIAL_LENGTH ? '…' + clean.slice(-PARTIAL_LENGTH) : clean
}

export function overlayChange(
  event: { event: string; [field: string]: unknown },
  hotkey: string
): OverlayChange {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const key = hotkey.toUpperCase()
  switch (event.event) {
    case 'model_loading':
      return { tone: 'neutral', icon: 'spinner', text: 'Laddar dikteringsmodellen …' }
    case 'model_ready':
      return {
        tone: 'success',
        icon: 'check',
        text: `Diktering redo – håll ${key} och prata`,
        autoHideMs: 3000
      }
    case 'model_failed':
      return {
        tone: 'warning',
        icon: 'alert',
        text: 'Dikteringsmodellen kunde inte laddas',
        autoHideMs: 6000
      }
    case 'hotkey_failed':
      return {
        tone: 'warning',
        icon: 'alert',
        text: `${text(event.hotkey).toUpperCase() || key} används redan av ett annat program`,
        autoHideMs: 6000
      }
    case 'not_ready':
      return {
        tone: 'neutral',
        icon: 'spinner',
        text: 'Dikteringsmodellen laddas fortfarande …',
        autoHideMs: 1500
      }
    case 'busy':
      return {
        tone: 'neutral',
        icon: 'wave',
        text: 'Vänta – förra dikteringen skrivs ut',
        autoHideMs: 1200
      }
    case 'mic_failed':
      return { tone: 'warning', icon: 'alert', text: 'Mikrofonen svarar inte', autoHideMs: 4000 }
    case 'connecting':
      return { tone: 'neutral', icon: 'spinner', text: 'Ansluter headsetets mikrofon …' }
    case 'listening':
      return { tone: 'recording', icon: 'dot', text: '', meter: true, timer: true }
    case 'partial':
      return { tone: 'recording', icon: 'dot', text: tail(text(event.text)) }
    case 'transcribing':
      return { tone: 'neutral', icon: 'wave', text: 'Skriver ut …' }
    case 'polishing':
      return {
        tone: 'neutral',
        icon: 'spinner',
        text: `Skriver om … ${key} infogar råtexten`,
        actions: true
      }
    case 'inserting':
      return { tone: 'neutral', icon: 'wave', text: 'Skriver in …' }
    case 'nothing_heard':
      return { tone: 'neutral', icon: 'alert', text: 'Inget tal uppfattades', autoHideMs: 1500 }
    case 'failed':
      return {
        tone: 'warning',
        icon: 'alert',
        text: 'Dikteringen kunde inte skrivas ut',
        autoHideMs: 4000
      }
    case 'flow_done':
      return { tone: 'success', icon: 'check', text: text(event.message), autoHideMs: 1600 }
    case 'notice':
      return { tone: 'neutral', icon: 'alert', text: text(event.message), autoHideMs: 2500 }
    case 'idle':
      return 'hide'
    default:
      return null
  }
}
