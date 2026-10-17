// Notices when a call starts in Teams, Zoom or a browser by watching which
// apps are using the microphone. Windows keeps that per app in the registry,
// the same data behind its own "microphone in use" indicator, so no meeting
// app has to be asked and nothing leaves the computer.

import { execFile } from 'child_process'
import type { CallApp } from '../shared/types'

const MIC_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
const POLL_MS = 5000
/** Polls in a row a call must last before it counts; skips a quick mic test. */
const POLLS_TO_COUNT = 2

/**
 * The registry keys of apps using the microphone right now, from `reg query
 * /s` output: a key whose last use has a start but no stop yet.
 */
export function micUsersFromReg(output: string): string[] {
  const users: string[] = []
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim())
    const key = lines.find((line) => line.startsWith('HKEY_'))
    if (!key) continue
    const value = (name: string): bigint | undefined => {
      const line = lines.find((l) => l.startsWith(`${name} `))
      const m = line && /REG_QWORD\s+(0x[0-9a-f]+)/i.exec(line)
      return m ? BigInt(m[1]) : undefined
    }
    const start = value('LastUsedTimeStart')
    const stop = value('LastUsedTimeStop')
    if (start !== undefined && start > 0n && stop === 0n) users.push(key)
  }
  return users
}

/** Which meeting app a microphone user is, or null for anything else. */
export function classifyApp(key: string): CallApp | null {
  const k = key.toLowerCase()
  if (k.includes('\\msteams_') || /#(ms-)?teams\.exe$/.test(k)) return 'teams'
  if (/#zoom\.exe$/.test(k)) return 'zoom'
  if (/#(chrome|msedge|firefox|brave|opera|vivaldi)\.exe$/.test(k)) return 'browser'
  return null
}

/**
 * Turns successive snapshots of which meeting apps use the microphone into
 * call starts and ends. A call counts after it has lasted a couple of polls,
 * and once per call: one that starts during a recording is never offered,
 * even after that recording stops.
 */
export class CallTracker {
  private seen = new Map<CallApp, number>()
  private handled = new Set<CallApp>()

  update(active: Set<CallApp>, recording: boolean): { started: CallApp[]; ended: CallApp[] } {
    const started: CallApp[] = []
    const ended: CallApp[] = []
    for (const app of active) {
      const polls = (this.seen.get(app) ?? 0) + 1
      this.seen.set(app, polls)
      if (polls >= POLLS_TO_COUNT && !this.handled.has(app)) {
        this.handled.add(app)
        if (!recording) started.push(app)
      }
    }
    for (const app of [...this.seen.keys()]) {
      if (active.has(app)) continue
      this.seen.delete(app)
      if (this.handled.delete(app)) ended.push(app)
    }
    return { started, ended }
  }

  reset(): void {
    this.seen.clear()
    this.handled.clear()
  }
}

function queryMicUsers(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('reg', ['query', MIC_KEY, '/s'], { windowsHide: true }, (err, stdout) => {
      resolve(err ? [] : micUsersFromReg(stdout))
    })
  })
}

/**
 * Poll the microphone users while `enabled` says so, and report calls that
 * start and end. Windows only; elsewhere it does nothing.
 */
export function watchCalls(opts: {
  enabled: () => boolean
  recording: () => boolean
  onStart: (app: CallApp) => void
  onEnd: (app: CallApp) => void
}): () => void {
  if (process.platform !== 'win32') return () => {}
  const tracker = new CallTracker()
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    if (!opts.enabled()) {
      tracker.reset()
      return
    }
    busy = true
    void queryMicUsers()
      .then((keys) => {
        const active = new Set(keys.map(classifyApp).filter((app): app is CallApp => app !== null))
        const { started, ended } = tracker.update(active, opts.recording())
        started.forEach(opts.onStart)
        ended.forEach(opts.onEnd)
      })
      .finally(() => {
        busy = false
      })
  }, POLL_MS)
  return () => clearInterval(timer)
}
