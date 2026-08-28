// Format of the per-source level envelope recorded alongside the audio.
// The renderer measures it while recording; main uses it to tell the
// microphone apart from the system audio afterwards. Both sides have to read
// the encoding the same way, so it is defined once here.

/** Samples per second. Transcript segments are seconds long — 10 Hz is plenty. */
export const LEVEL_RATE_HZ = 10

/** Levels are stored as 0..255 spanning this dynamic range, in decibels. */
export const LEVEL_FLOOR_DB = -80

export interface LevelEnvelope {
  /** Samples per second the arrays were recorded at. */
  rate: number
  /**
   * One sample per 1/rate second of *recorded* audio, microphone side. Paused
   * time is not sampled, so index/rate lines up with the transcript's seconds.
   */
  mic: number[]
  /** The same for system audio. Empty when none was captured. */
  system: number[]
}

/** RMS amplitude (0..1) -> stored level. Silence and anything under the floor is 0. */
export function encodeLevel(rms: number): number {
  if (!(rms > 0)) return 0
  const db = Math.min(0, 20 * Math.log10(rms))
  if (db <= LEVEL_FLOOR_DB) return 0
  return Math.round(((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * 255)
}

/** Stored level -> decibels, so two sources can be compared on a real scale. */
export function levelToDb(level: number): number {
  if (level <= 0) return LEVEL_FLOOR_DB
  return LEVEL_FLOOR_DB + (Math.min(255, level) / 255) * -LEVEL_FLOOR_DB
}
