// Live transcription while recording: where to cut the audio into windows,
// and the queue that sends them for transcription. Pure logic so it can be
// tested without a DOM — MeetingRecorder cuts the audio, the Recording view
// shows the result.
//
// The text is a preview. The full transcript is still made from the recorded
// segment files once the meeting stops, so nothing here may ever slow down or
// endanger the recording: a slow transcriber means windows are skipped, and a
// failing one is left alone for a while.

/** A window shorter than this is mostly context-free fragments. */
export const LIVE_MIN_WINDOW_MS = 10_000
/** Cut here even mid-sentence, or the text lags too far behind. */
export const LIVE_MAX_WINDOW_MS = 25_000
/** A pause this long between the min and max is where a window ends. */
export const LIVE_QUIET_MS = 400
/** Raw RMS below this counts as a pause. */
export const LIVE_QUIET_LEVEL = 0.01
/**
 * A window whose loudest moment stays below this is silence. Sending it costs
 * a request and invites Whisper to hallucinate words into the quiet.
 */
export const LIVE_SPEECH_LEVEL = 0.02

/** Consecutive failures before the transcriber is left alone for a while. */
const LIVE_MAX_FAILURES = 3
const LIVE_COOLDOWN_MS = 60_000

export function shouldCutWindow(elapsedMs: number, quietMs: number): boolean {
  if (elapsedMs >= LIVE_MAX_WINDOW_MS) return true
  return elapsedMs >= LIVE_MIN_WINDOW_MS && quietMs >= LIVE_QUIET_MS
}

/** One self-contained webm file covering [startSec, endSec) of recorded time. */
export interface LiveWindow {
  audio: ArrayBuffer
  startSec: number
  endSec: number
}

type LiveEntry =
  | { kind: 'text'; startSec: number; text: string }
  /** Audio that was never transcribed, because the transcriber fell behind or failed. */
  | { kind: 'gap'; startSec: number }

/**
 * - `waiting`: nothing transcribed yet.
 * - `working`: keeping up.
 * - `behind`: windows had to be skipped to catch up.
 * - `unavailable`: the transcriber keeps failing; retried after a cooldown.
 */
type LiveStatus = 'waiting' | 'working' | 'behind' | 'unavailable'

export interface LiveState {
  entries: LiveEntry[]
  status: LiveStatus
}

interface LiveQueueOptions {
  maxFailures?: number
  cooldownMs?: number
  now?: () => number
}

/**
 * At most one request in flight and one window waiting. A newer window
 * replaces a waiting one, so the preview follows the meeting instead of
 * drifting further behind it; what was replaced shows up as a gap.
 */
export class LiveQueue {
  private entries: LiveEntry[] = []
  private status: LiveStatus = 'waiting'
  private inFlight = false
  private pending: LiveWindow | null = null
  /**
   * Start of audio that was skipped or failed. The gap is only written once
   * a later window's text arrives, so it lands in time order even though a
   * window is dropped while an earlier one is still in flight.
   */
  private missingFrom: number | null = null
  private failures = 0
  private cooldownUntil = 0
  private stopped = false
  private readonly maxFailures: number
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(
    private readonly transcribe: (window: LiveWindow) => Promise<string>,
    private readonly onChange: (state: LiveState) => void,
    opts: LiveQueueOptions = {}
  ) {
    this.maxFailures = opts.maxFailures ?? LIVE_MAX_FAILURES
    this.cooldownMs = opts.cooldownMs ?? LIVE_COOLDOWN_MS
    this.now = opts.now ?? Date.now
  }

  push(window: LiveWindow): void {
    if (this.stopped) return
    if (this.status === 'unavailable' && this.now() < this.cooldownUntil) {
      this.markMissing(window)
      return
    }
    if (this.inFlight) {
      if (this.pending) {
        this.markMissing(this.pending)
        if (this.status !== 'behind') {
          this.status = 'behind'
          this.emit()
        }
      }
      this.pending = window
      return
    }
    void this.run(window)
  }

  /** Drop whatever is queued and ignore results still on their way. */
  stop(): void {
    this.stopped = true
    this.pending = null
  }

  private async run(window: LiveWindow): Promise<void> {
    this.inFlight = true
    let text: string | null
    try {
      text = (await this.transcribe(window)).trim()
    } catch {
      text = null
    }
    this.inFlight = false
    if (this.stopped) return

    if (text === null) {
      this.failures += 1
      this.markMissing(window)
      if (this.failures >= this.maxFailures) {
        this.status = 'unavailable'
        this.cooldownUntil = this.now() + this.cooldownMs
        // Anything waiting would only fail too.
        if (this.pending) this.markMissing(this.pending)
        this.pending = null
      }
    } else {
      this.failures = 0
      // A window skipped while this one was in flight comes after it.
      if (this.missingFrom !== null && this.missingFrom < window.startSec) {
        this.entries = [...this.entries, { kind: 'gap', startSec: this.missingFrom }]
        this.missingFrom = null
      }
      if (text) this.entries = [...this.entries, { kind: 'text', startSec: window.startSec, text }]
      // Still behind while another window is waiting; caught up otherwise.
      if (!(this.status === 'behind' && this.pending)) this.status = 'working'
    }
    this.emit()

    const next = this.pending
    this.pending = null
    if (next) void this.run(next)
  }

  private markMissing(window: LiveWindow): void {
    this.missingFrom =
      this.missingFrom === null ? window.startSec : Math.min(this.missingFrom, window.startSec)
  }

  private emit(): void {
    this.onChange({ entries: this.entries, status: this.status })
  }
}
