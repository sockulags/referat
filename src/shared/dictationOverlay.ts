// What the dictation status pill shows, decided from the dictation engine's
// events. Pure, so the main process and the tests share one mapping.

/** Channels from the main process to the pill's window. */
export const OVERLAY_CHANNELS = {
  state: 'dictation-overlay:state',
  level: 'dictation-overlay:level'
} as const

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
}

/** What the pill's window may do: listen, nothing else. */
export interface OverlayApi {
  onState(cb: (state: OverlayState) => void): void
  onLevel(cb: (value: number) => void): void
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
      return { tone: 'neutral', icon: 'spinner', text: 'Polerar …' }
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
