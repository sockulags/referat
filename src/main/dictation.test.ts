import { PassThrough } from 'stream'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

import {
  EngineCommandError,
  EngineConnection,
  dictationEngineProgram,
  type EngineEvent
} from './dictation'

/** An engine on the other side of two streams, answering like viska --engine. */
function fakeEngine(answer: (command: Record<string, unknown>) => Record<string, unknown> | null): {
  connection: EngineConnection
  events: EngineEvent[]
  sent: Record<string, unknown>[]
  emit: (line: string) => void
} {
  const toEngine = new PassThrough()
  const fromEngine = new PassThrough()
  const events: EngineEvent[] = []
  const sent: Record<string, unknown>[] = []
  toEngine.setEncoding('utf8')
  toEngine.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      const command = JSON.parse(line) as Record<string, unknown>
      sent.push(command)
      const reply = answer(command)
      if (reply) fromEngine.write(JSON.stringify({ ...reply, id: command.id }) + '\n')
    }
  })
  const connection = new EngineConnection(toEngine, fromEngine, (event) => events.push(event), 200)
  return { connection, events, sent, emit: (line) => fromEngine.write(line) }
}

describe('EngineConnection', () => {
  it('settles a command with the reply that carries its id', async () => {
    const engine = fakeEngine((command) => ({ event: 'ok', cmd: command.cmd, items: [] }))
    const reply = await engine.connection.send('history')
    expect(reply).toMatchObject({ event: 'ok', cmd: 'history', items: [] })
    expect(engine.sent[0]).toMatchObject({ cmd: 'history', id: 1 })
  })

  it('rejects with the engine message when it refuses', async () => {
    const engine = fakeEngine(() => ({ event: 'error', message: 'språket måste vara sv eller en' }))
    await expect(engine.connection.send('set_language', { language: 'fi' })).rejects.toEqual(
      new EngineCommandError('språket måste vara sv eller en')
    )
  })

  it('passes events through and survives split and broken lines', async () => {
    const engine = fakeEngine(() => null)
    engine.emit('{"event": "liste')
    engine.emit('ning"}\nnot json\n{"event": "level", "value": 0.02}\n')
    await new Promise((resolve) => setImmediate(resolve))
    expect(engine.events).toEqual([{ event: 'listening' }, { event: 'level', value: 0.02 }])
  })

  it('gives up on a command nobody answers', async () => {
    const engine = fakeEngine(() => null)
    await expect(engine.connection.send('history')).rejects.toThrow('svarade inte')
  })

  it('fails waiting commands when the engine goes away', async () => {
    const engine = fakeEngine(() => null)
    const waiting = engine.connection.send('history')
    engine.connection.close(new Error('borta'))
    await expect(waiting).rejects.toThrow('borta')
    await expect(engine.connection.send('history')).rejects.toThrow('körs inte')
  })
})

describe('dictationEngineProgram', () => {
  it('prefers a locally built engine from the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-'))
    const exe = join(dir, 'viska-engine.exe')
    writeFileSync(exe, '')
    expect(dictationEngineProgram({ REFERAT_DICTATION_ENGINE: exe }, () => false)).toBe(exe)
    expect(dictationEngineProgram({ REFERAT_DICTATION_ENGINE: join(dir, 'saknas.exe') })).toBe(null)
  })

  it('takes the GPU component before the CPU one', () => {
    const installed = (component: string): boolean => component !== 'dictation-gpu'
    const program = dictationEngineProgram({}, installed, (component) => `${component}.exe`)
    expect(program).toBe('dictation-cpu.exe')
    expect(
      dictationEngineProgram(
        {},
        () => true,
        (c) => `${c}.exe`
      )
    ).toBe('dictation-gpu.exe')
    expect(dictationEngineProgram({}, () => false)).toBe(null)
  })
})

// Starts a real engine when one is pointed out, e.g. a locally built
// viska-engine.exe: REFERAT_DICTATION_ENGINE=...\viska-engine.exe npm run test:unit
describe.runIf(process.env.REFERAT_DICTATION_ENGINE)('DictationEngineProcess', () => {
  it('starts, answers and quits', async () => {
    const { DictationEngineProcess } = await import('./dictation')
    const events: EngineEvent[] = []
    const engine = await DictationEngineProcess.start(
      process.env.REFERAT_DICTATION_ENGINE!,
      (event) => events.push(event),
      () => undefined
    )
    const history = await engine.connection.send('history')
    expect(history).toMatchObject({ event: 'ok', items: [], last: '' })
    const mics = await engine.connection.send('list_mics')
    expect(Array.isArray(mics.mics)).toBe(true)
    await engine.stop()
  }, 60_000)
})
