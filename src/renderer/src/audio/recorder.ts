// Audio capture engine. Runs entirely in the renderer via Web APIs.
// Mic + optional system loopback are mixed into one webm/opus stream and
// streamed to main in 5s chunks. Per-source AnalyserNodes drive level meters.
// The MediaRecorder is rotated into a fresh segment every 10 min so each
// segment file stays under provider size caps and is independently decodable.

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
}

export type MicPermissionError = { kind: 'mic-denied'; detail: string }

export function isMicPermissionError(e: unknown): e is MicPermissionError {
  return typeof e === 'object' && e !== null && (e as { kind?: string }).kind === 'mic-denied'
}

const MIME = 'audio/webm;codecs=opus'
const TIMESLICE_MS = 5000
/** Rotate to a new segment every 10 minutes. */
const SEGMENT_MS = 10 * 60 * 1000

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
  /** Serialize chunk writes so ordering survives the async arrayBuffer()/IPC. */
  private writeChain: Promise<void> = Promise.resolve()
  private stopped = false

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

  private rms(meter: SourceMeter | null): number {
    if (!meter) return 0
    meter.analyser.getFloatTimeDomainData(meter.buffer)
    let sum = 0
    for (let i = 0; i < meter.buffer.length; i++) sum += meter.buffer[i] * meter.buffer[i]
    const rms = Math.sqrt(sum / meter.buffer.length)
    // Perceptual boost so quiet speech still moves the meter; clamp to 0..1.
    return Math.min(1, rms * 3.2)
  }

  /** Instantaneous levels (0..1) for mic and system sources. */
  getLevels(): { mic: number; system: number } {
    return { mic: this.rms(this.micMeter), system: this.rms(this.systemMeter) }
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause()
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume()
  }

  get state(): 'inactive' | 'recording' | 'paused' {
    return this.recorder?.state ?? 'inactive'
  }

  /** Flush the final chunk, stop everything and release devices/context. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.rotateTimer !== null) {
      clearInterval(this.rotateTimer)
      this.rotateTimer = null
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
    if (this.rotateTimer !== null) {
      clearInterval(this.rotateTimer)
      this.rotateTimer = null
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
