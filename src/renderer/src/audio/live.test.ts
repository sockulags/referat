import { describe, expect, it } from 'vitest'
import {
  LIVE_MAX_WINDOW_MS,
  LIVE_MIN_WINDOW_MS,
  LIVE_QUIET_MS,
  LiveQueue,
  shouldCutWindow,
  type LiveState,
  type LiveWindow
} from './live'

describe('shouldCutWindow', () => {
  it('never cuts before the minimum length, however quiet', () => {
    expect(shouldCutWindow(LIVE_MIN_WINDOW_MS - 1, 10_000)).toBe(false)
  })

  it('cuts at a pause once the minimum is reached', () => {
    expect(shouldCutWindow(LIVE_MIN_WINDOW_MS, LIVE_QUIET_MS)).toBe(true)
    expect(shouldCutWindow(LIVE_MIN_WINDOW_MS + 5000, LIVE_QUIET_MS - 1)).toBe(false)
  })

  it('cuts at the maximum even mid-speech', () => {
    expect(shouldCutWindow(LIVE_MAX_WINDOW_MS, 0)).toBe(true)
  })
})

function win(startSec: number): LiveWindow {
  return { audio: new ArrayBuffer(0), startSec, endSec: startSec + 20 }
}

/** A transcriber whose calls resolve or reject only when the test says so. */
function controlled(): {
  transcribe: (w: LiveWindow) => Promise<string>
  calls: number[]
  resolve: (text: string) => Promise<void>
  reject: () => Promise<void>
} {
  const waiting: { resolve: (t: string) => void; reject: (e: Error) => void }[] = []
  const calls: number[] = []
  const settle = async (): Promise<void> => {
    // Let the queue's continuation (and any follow-up run) execute.
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return {
    calls,
    transcribe: (w) =>
      new Promise<string>((resolve, reject) => {
        calls.push(w.startSec)
        waiting.push({ resolve, reject })
      }),
    resolve: async (text) => {
      waiting.shift()!.resolve(text)
      await settle()
    },
    reject: async () => {
      waiting.shift()!.reject(new Error('down'))
      await settle()
    }
  }
}

function track(): { state: () => LiveState; onChange: (s: LiveState) => void } {
  let last: LiveState = { entries: [], status: 'waiting' }
  return { state: () => last, onChange: (s) => (last = s) }
}

describe('LiveQueue', () => {
  it('transcribes windows in order and collects their text', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    await t.resolve('  Hej allihop. ')
    q.push(win(20))
    await t.resolve('Då börjar vi.')
    expect(out.state().status).toBe('working')
    expect(out.state().entries).toEqual([
      { kind: 'text', startSec: 0, text: 'Hej allihop.' },
      { kind: 'text', startSec: 20, text: 'Då börjar vi.' }
    ])
  })

  it('keeps one request in flight and only the newest window waiting', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    q.push(win(20))
    q.push(win(40)) // replaces 20, which is skipped
    expect(t.calls).toEqual([0])
    expect(out.state().status).toBe('behind')

    await t.resolve('ett')
    expect(t.calls).toEqual([0, 40])
    expect(out.state().status).toBe('behind')
    await t.resolve('tre')

    expect(out.state().status).toBe('working')
    expect(out.state().entries).toEqual([
      { kind: 'text', startSec: 0, text: 'ett' },
      { kind: 'gap', startSec: 20 },
      { kind: 'text', startSec: 40, text: 'tre' }
    ])
  })

  it('collapses consecutive skipped windows into one gap', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    q.push(win(20))
    q.push(win(40))
    q.push(win(60))
    await t.resolve('ett')
    await t.resolve('fyra')
    expect(out.state().entries).toEqual([
      { kind: 'text', startSec: 0, text: 'ett' },
      { kind: 'gap', startSec: 20 },
      { kind: 'text', startSec: 60, text: 'fyra' }
    ])
  })

  it('adds no entry for a window with no speech', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    await t.resolve('   ')
    expect(out.state().entries).toEqual([])
    expect(out.state().status).toBe('working')
  })

  it('backs off after repeated failures and retries after the cooldown', async () => {
    const t = controlled()
    const out = track()
    let now = 0
    const q = new LiveQueue(t.transcribe, out.onChange, {
      maxFailures: 2,
      cooldownMs: 1000,
      now: () => now
    })
    q.push(win(0))
    await t.reject()
    expect(out.state().status).not.toBe('unavailable')
    q.push(win(20))
    await t.reject()
    expect(out.state().status).toBe('unavailable')

    q.push(win(40)) // inside the cooldown: not even tried
    expect(t.calls).toEqual([0, 20])

    now = 1000
    q.push(win(60))
    await t.resolve('tillbaka')
    expect(out.state().status).toBe('working')
    expect(out.state().entries).toEqual([
      { kind: 'gap', startSec: 0 },
      { kind: 'text', startSec: 60, text: 'tillbaka' }
    ])
  })

  it('a single failure does not stop the next window', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    await t.reject()
    q.push(win(20))
    await t.resolve('igen')
    expect(t.calls).toEqual([0, 20])
    expect(out.state().entries).toEqual([
      { kind: 'gap', startSec: 0 },
      { kind: 'text', startSec: 20, text: 'igen' }
    ])
  })

  it('ignores results and new windows after stop', async () => {
    const t = controlled()
    const out = track()
    const q = new LiveQueue(t.transcribe, out.onChange)
    q.push(win(0))
    q.push(win(20))
    q.stop()
    await t.resolve('för sent')
    q.push(win(40))
    expect(t.calls).toEqual([0])
    expect(out.state().entries).toEqual([])
  })
})
