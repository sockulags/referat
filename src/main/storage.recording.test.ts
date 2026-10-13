import { describe, it, expect, vi } from 'vitest'
import { cancelRecording, createMeeting, finishRecording, whenNoRecording } from './storage'

// Kept apart from storage.test.ts: that suite leaves its meetings in the
// recording state, and this one needs to see recording start and end.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-recording-'))
  return { app: { getPath: (): string => dir } }
})

const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false
  void promise.then(() => (done = true))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return done
}

describe('whenNoRecording', () => {
  it('resolves at once when nothing is being recorded', async () => {
    expect(await settled(whenNoRecording())).toBe(true)
  })

  it('waits until the last recording ends, whether finished or cancelled', async () => {
    const first = createMeeting('Första')
    const second = createMeeting('Andra')
    const waiting = whenNoRecording()

    await finishRecording(first.id, 60)
    expect(await settled(waiting)).toBe(false)

    await cancelRecording(second.id)
    expect(await settled(waiting)).toBe(true)
  })
})
