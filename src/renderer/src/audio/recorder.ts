// Audio capture engine. Runs entirely in the renderer via Web APIs.
// Mic + optional system loopback are mixed into one webm/opus stream and
// streamed to main in 5s chunks. Per-source AnalyserNodes drive level meters
// and, sampled at a steady rate, the level envelope that lets main tell the
// two sources apart afterwards.
// The MediaRecorder is rotated into a fresh segment every 10 min so each
// segment file stays under provider size caps and is independently decodable.
// For live transcription a second MediaRecorder on the same mixed stream is
// cut into short, self-contained windows at pauses in the speech.

export interface RecorderOptions {
  microphoneId: string
  captureSystemAudio: boolean
  /**
   * Fired for each encoded 5s chunk; wire to api.appendAudioChunk.
   * `segmentIndex` identifies which rotated segment file the chunk belongs to.
   * Return a promise to apply backpressure — the recorder awaits it so chunks
   * are written strictly in order.
   */
  onChunk: (chunk: ArrayBuffer, segmentIndex: number) => Promise<void> | void
  /** System audio requested but unavailable — recording continues mic-only. */
  onSystemAudioUnavailable: () => void
  /**
   * Turns on live windows. Called with each window that contains speech;
   * silent windows are dropped here. Must not block — the recording never
   * waits for the transcriber.
   */
  onLiveWindow?: (window: LiveWindow) => void
}

export type MicPermissionError = { kind: 'mic-denied'; detail: string }

export function isMicPermissionError(e: unknown): e is MicPermissionError {
  return typeof e === 'object' && e !== null && (e as { kind?: string }).kind === 'mic-denied'
}

import type { LevelEnvelope } from '../../../shared/levels'
import { encodeLevel, LEVEL_RATE_HZ } from '../../../shared/levels'
import { LIVE_QUIET_LEVEL, LIVE_SPEECH_LEVEL, shouldCutWindow, type LiveWindow } from './live'

const MIME = 'audio/webm;codecs=opus'
const TIMESLICE_MS = 5000
/** Rotate to a new segment every 10 minutes. */
const SEGMENT_MS = 10 * 60 * 1000
/** How often the live window checks for a pause to cut at. */
const LIVE_TICK_MS = 100

/** The live window being recorded. Its recorder's onstop reads the final values. */
interface OpenLiveWindow {
  recorder: MediaRecorder
  parts: Blob[]
  startMs: number
  endMs: number
  /** Loudest raw level so far — decides whether the window holds any speech. */
  peak: number
  /** How long it has been quiet right now. */
  quietMs: number
}

interface SourceMeter {
  analyser: AnalyserNode
  buffer: Float32Array<ArrayBuffer>
}

export class MeetingRecorder {
  private ctx: AudioContext | null = null
  private recorder: MediaRecorder | null = null
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private mixDest: MediaStreamAudioDestinationNode | null = null
  private micMeter: SourceMeter | null = null
  private systemMeter: SourceMeter | null = null
  private onChunk: ((c: ArrayBuffer, seg: number) => Promise<void> | void) | null = null

  private segmentIndex = 0
  private rotateTimer: ReturnType<typeof setInterval> | null = null
  private envelopeTimer: ReturnType<typeof setInterval> | null = null
  private micLevels: number[] = []
  private systemLevels: number[] = []
  /**
   * Whether the envelope is advancing. Kept separately from the
   * MediaRecorder's state so the brief gap while a segment rotates does not
   * drop samples and drift the envelope against the audio timeline.
   */
  private sampling = false
  /** Serialize chunk writes so ordering survives the async arrayBuffer()/IPC. */
  private writeChain: Promise<void> = Promise.resolve()
  private stopped = false

  // Live windows. Time is counted only while sampling, so window offsets match
  // the recorded audio (pauses excluded), like the level envelope.
  private onLiveWindow: ((window: LiveWindow) => void) | null = null
  private liveWindow: OpenLiveWindow | null = null
  private liveTimer: ReturnType<typeof setInterval> | null = null
  private liveLastTick = 0
  private recordedMs = 0

  hasSystemAudio = false

  async start(opts: RecorderOptions): Promise<void> {
    this.onChunk = opts.onChunk

    // Microphone is required — a failure here is a hard, user-facing error.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.microphoneId ? { exact: opts.microphoneId } : undefined,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
    } catch (e) {
      throw { kind: 'mic-denied', detail: describeError(e) } satisfies MicPermissionError
    }

    // System audio is best-effort. Main provides WASAPI loopback via
    // setDisplayMediaRequestHandler; we immediately drop the video track.
    if (opts.captureSystemAudio) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        })
        display.getVideoTracks().forEach((t) => {
          t.stop()
          display.removeTrack(t)
        })
        if (display.getAudioTracks().length > 0) {
          this.systemStream = display
          this.hasSystemAudio = true
        } else {
          opts.onSystemAudioUnavailable()
        }
      } catch {
        opts.onSystemAudioUnavailable()
      }
    }

    // Mix sources into one stream for recording; tap each for metering.
    this.ctx = new AudioContext()
    this.mixDest = this.ctx.createMediaStreamDestination()

    const micSource = this.ctx.createMediaStreamSource(this.micStream)
    micSource.connect(this.mixDest)
    this.micMeter = this.makeMeter(micSource)

    if (this.systemStream) {
      const sysSource = this.ctx.createMediaStreamSource(this.systemStream)
      sysSource.connect(this.mixDest)
      this.systemMeter = this.makeMeter(sysSource)
    }

    this.startSegment(0)
    this.rotateTimer = setInterval(() => {
      void this.rotate()
    }, SEGMENT_MS)
    this.sampling = true
    this.envelopeTimer = setInterval(() => this.sampleEnvelope(), 1000 / LEVEL_RATE_HZ)

    if (opts.onLiveWindow) {
      this.onLiveWindow = opts.onLiveWindow
      this.startLiveWindow()
      this.liveLastTick = performance.now()
      this.liveTimer = setInterval(() => this.liveTick(), LIVE_TICK_MS)
    }
  }

  /** Open a new live window on the mixed stream, starting at the current recorded time. */
  private startLiveWindow(): void {
    if (!this.mixDest) return
    const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : 'audio/webm'
    const recorder = new MediaRecorder(this.mixDest.stream, { mimeType })
    const win: OpenLiveWindow = {
      recorder,
      parts: [],
      startMs: this.recordedMs,
      endMs: this.recordedMs,
      peak: 0,
      quietMs: 0
    }
    recorder.ondataavailable = (ev: BlobEvent): void => {
      if (ev.data && ev.data.size > 0) win.parts.push(ev.data)
    }
    recorder.onstop = (): void => {
      const deliver = this.onLiveWindow
      if (!deliver || win.peak < LIVE_SPEECH_LEVEL || win.parts.length === 0) return
      void new Blob(win.parts, { type: mimeType }).arrayBuffer().then((audio) => {
        if (this.stopped) return
        deliver({ audio, startSec: win.startMs / 1000, endSec: win.endMs / 1000 })
      })
    }
    this.liveWindow = win
    recorder.start()
  }

  private liveTick(): void {
    const now = performance.now()
    const dt = now - this.liveLastTick
    this.liveLastTick = now
    const win = this.liveWindow
    if (!win || !this.sampling || this.stopped) return
    this.recordedMs += dt
    const level = Math.max(this.rawRms(this.micMeter), this.rawRms(this.systemMeter))
    win.peak = Math.max(win.peak, level)
    win.quietMs = level < LIVE_QUIET_LEVEL ? win.quietMs + dt : 0
    if (shouldCutWindow(this.recordedMs - win.startMs, win.quietMs)) {
      win.endMs = this.recordedMs
      // Start the next window before stopping this one so no audio falls
      // between them; the old recorder flushes in the background.
      this.startLiveWindow()
      if (win.recorder.state !== 'inactive') win.recorder.stop()
    }
  }

  /** Stop live windows without delivering the one in progress. */
  private stopLive(): void {
    if (this.liveTimer !== null) {
      clearInterval(this.liveTimer)
      this.liveTimer = null
    }
    this.onLiveWindow = null
    const rec = this.liveWindow?.recorder
    this.liveWindow = null
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  /** Create and start a MediaRecorder for the given segment on the mixed stream. */
  private startSegment(index: number): void {
    if (!this.mixDest) return
    const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : 'audio/webm'
    const recorder = new MediaRecorder(this.mixDest.stream, { mimeType })
    recorder.ondataavailable = (ev: BlobEvent): void => {
      if (ev.data && ev.data.size > 0) {
        const blob = ev.data
        // Enqueue synchronously so chunk order is preserved even though
        // arrayBuffer() and the IPC append are async.
        this.writeChain = this.writeChain.then(async () => {
          const buf = await blob.arrayBuffer()
          await this.onChunk?.(buf, index)
        })
      }
    }
    this.recorder = recorder
    recorder.start(TIMESLICE_MS)
  }

  /** Stop the current segment (flushing its final chunk) and open the next one. */
  private async rotate(): Promise<void> {
    const rec = this.recorder
    // Only rotate an actively recording segment; skip while paused/stopped.
    if (this.stopped || !rec || rec.state !== 'recording') return
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true })
      rec.stop()
    })
    if (this.stopped) return
    this.segmentIndex += 1
    this.startSegment(this.segmentIndex)
  }

  private makeMeter(source: AudioNode): SourceMeter {
    const analyser = this.ctx!.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    return { analyser, buffer: new Float32Array(analyser.fftSize) }
  }

  /** Plain RMS amplitude of a source, 0..1. */
  private rawRms(meter: SourceMeter | null): number {
    if (!meter) return 0
    meter.analyser.getFloatTimeDomainData(meter.buffer)
    let sum = 0
    for (let i = 0; i < meter.buffer.length; i++) sum += meter.buffer[i] * meter.buffer[i]
    return Math.sqrt(sum / meter.buffer.length)
  }

  private rms(meter: SourceMeter | null): number {
    // Perceptual boost so quiet speech still moves the meter; clamp to 0..1.
    return Math.min(1, this.rawRms(meter) * 3.2)
  }

  /** Instantaneous levels (0..1) for mic and system sources. */
  getLevels(): { mic: number; system: number } {
    return { mic: this.rms(this.micMeter), system: this.rms(this.systemMeter) }
  }

  /**
   * Append one sample per source. The meter values are boosted and clamped
   * for the UI, which throws away exactly the headroom the comparison needs,
   * so the envelope is built from the raw amplitude instead.
   */
  private sampleEnvelope(): void {
    if (!this.sampling) return
    this.micLevels.push(encodeLevel(this.rawRms(this.micMeter)))
    this.systemLevels.push(this.systemMeter ? encodeLevel(this.rawRms(this.systemMeter)) : 0)
  }

  /**
   * The recorded envelope. `system` comes back empty when there was no
   * system audio, which is what tells main there is nothing to compare.
   */
  getEnvelope(): LevelEnvelope {
    return {
      rate: LEVEL_RATE_HZ,
      mic: this.micLevels,
      system: this.systemMeter ? this.systemLevels : []
    }
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause()
      if (this.liveWindow?.recorder.state === 'recording') this.liveWindow.recorder.pause()
      // No audio is written while paused, so the envelope must not advance
      // either — otherwise it slides against the transcript by the length of
      // the pause.
      this.sampling = false
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume()
      if (this.liveWindow?.recorder.state === 'paused') this.liveWindow.recorder.resume()
      this.sampling = true
    }
  }

  get state(): 'inactive' | 'recording' | 'paused' {
    return this.recorder?.state ?? 'inactive'
  }

  /** Flush the final chunk, stop everything and release devices/context. */
  async stop(): Promise<void> {
    this.stopped = true
    this.sampling = false
    this.stopLive()
    if (this.rotateTimer !== null) {
      clearInterval(this.rotateTimer)
      this.rotateTimer = null
    }
    if (this.envelopeTimer !== null) {
      clearInterval(this.envelopeTimer)
      this.envelopeTimer = null
    }
    const rec = this.recorder
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
    }
    // Wait for every enqueued chunk (including the final one) to be written
    // before resolving — otherwise finishRecording could close the file first.
    await this.writeChain
    this.cleanup()
  }

  cleanup(): void {
    this.stopped = true
    this.sampling = false
    this.stopLive()
    if (this.rotateTimer !== null) {
      clearInterval(this.rotateTimer)
      this.rotateTimer = null
    }
    if (this.envelopeTimer !== null) {
      clearInterval(this.envelopeTimer)
      this.envelopeTimer = null
    }
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.systemStream?.getTracks().forEach((t) => t.stop())
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close()
    this.recorder = null
    this.micStream = null
    this.systemStream = null
    this.mixDest = null
    this.micMeter = null
    this.systemMeter = null
    this.ctx = null
  }
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) return `${e.name}: ${e.message}`
  if (e instanceof Error) return e.message
  return String(e)
}
