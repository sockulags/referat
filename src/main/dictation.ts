// Dictation: the dictation engine in dictation-engine/, running as a component.
//
// The engine (viska-engine.exe, "python -m viska") owns everything that has to
// be fast and native — the global hotkey, the microphone, KB-Whisper and
// typing the text into the app that has focus. referat starts it, sends it
// settings and shows what it reports. The two talk in JSON lines over the
// engine's stdin and stdout; dictation-engine/PROTOCOL.md describes every
// command and event.

import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname } from 'path'
import type { Readable, Writable } from 'stream'
import type { LocalAiComponent } from '../shared/types'
import {
  isLocalAiComponentInstalled,
  localAiComponentExecutable,
  localAiModelCache
} from './localAiComponents'

/** A message from the engine: {"event": "listening"} and so on. */
export interface EngineEvent {
  event: string
  [field: string]: unknown
}

/** The engine refused a command; message is its explanation. */
export class EngineCommandError extends Error {}

const COMMAND_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (reply: EngineEvent) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The protocol over a pair of streams. Commands get an id; the engine's
 * "ok" or "error" with the same id settles the command's promise. Every other
 * line is an event for onEvent.
 */
export class EngineConnection {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private buffer = ''
  private closed = false

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly onEvent: (event: EngineEvent) => void,
    private readonly timeoutMs = COMMAND_TIMEOUT_MS
  ) {
    output.setEncoding('utf8')
    output.on('data', (chunk: string) => this.receive(chunk))
    output.on('end', () => this.close(new Error('Dikteringsmotorn stängde sin utdata')))
  }

  /** Send a command and wait for its reply. Rejects on "error" or timeout. */
  send(cmd: string, fields: Record<string, unknown> = {}): Promise<EngineEvent> {
    if (this.closed) return Promise.reject(new Error('Dikteringsmotorn körs inte'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Dikteringsmotorn svarade inte på ${cmd}`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.input.write(JSON.stringify({ ...fields, cmd, id }) + '\n')
    })
  }

  /** Fail every command still waiting; nothing more will answer them. */
  close(reason: Error): void {
    if (this.closed) return
    this.closed = true
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(reason)
    }
    this.pending.clear()
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: EngineEvent
    try {
      message = JSON.parse(line) as EngineEvent
    } catch {
      return // not protocol; the engine logs to stderr, never here
    }
    if (typeof message !== 'object' || message === null || typeof message.event !== 'string') {
      return
    }
    const id = typeof message.id === 'number' ? message.id : undefined
    const waiting = id !== undefined ? this.pending.get(id) : undefined
    if (waiting && (message.event === 'ok' || message.event === 'error')) {
      this.pending.delete(id!)
      clearTimeout(waiting.timer)
      if (message.event === 'ok') waiting.resolve(message)
      else waiting.reject(new EngineCommandError(String(message.message ?? 'Okänt fel')))
      return
    }
    this.onEvent(message)
  }
}

/**
 * Which engine program to run: REFERAT_DICTATION_ENGINE (a locally built
 * viska-engine.exe, for development) or the installed component, GPU first.
 */
export function dictationEngineProgram(
  env: NodeJS.ProcessEnv = process.env,
  installed: (component: LocalAiComponent) => boolean = isLocalAiComponentInstalled,
  executable: (component: LocalAiComponent) => string = localAiComponentExecutable
): string | null {
  const override = env.REFERAT_DICTATION_ENGINE?.trim()
  if (override) return existsSync(override) ? override : null
  for (const component of ['dictation-gpu', 'dictation-cpu'] as const) {
    if (installed(component)) return executable(component)
  }
  return null
}

/** A running engine process and its connection. */
export class DictationEngineProcess {
  private constructor(
    private readonly child: ChildProcess,
    readonly connection: EngineConnection
  ) {}

  /**
   * Start the engine. Resolves once it has said hello, so the first command
   * never races the engine's own start-up.
   */
  static start(
    program: string,
    onEvent: (event: EngineEvent) => void,
    onExit: (reason: string) => void
  ): Promise<DictationEngineProcess> {
    const child = spawn(program, [], {
      cwd: dirname(program),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HF_HOME: localAiModelCache() }
    })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_000)
    })
    return new Promise((resolve, reject) => {
      let started = false
      const connection = new EngineConnection(child.stdin!, child.stdout!, (event) => {
        if (!started && event.event === 'hello') {
          started = true
          resolve(new DictationEngineProcess(child, connection))
          return
        }
        onEvent(event)
      })
      const fail = (reason: string): void => {
        connection.close(new Error(reason))
        if (!started) reject(new Error(`${reason}\n${stderr}`.trim()))
        else onExit(`${reason}\n${stderr}`.trim())
      }
      child.once('error', (error) => fail(error.message))
      child.once('exit', (code, signal) =>
        fail(code !== null ? `Dikteringsmotorn avslutades (kod ${code})` : `signal ${signal}`)
      )
    })
  }

  /** Ask the engine to quit, and end it if it does not within a few seconds. */
  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
    try {
      await this.connection.send('quit')
    } catch {
      // Already gone or not answering: the kill below takes care of it.
    }
    const timer = setTimeout(() => this.child.kill(), 3_000)
    await exited
    clearTimeout(timer)
  }
}
