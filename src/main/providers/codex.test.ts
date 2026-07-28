import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(() => Promise.resolve('C:\\Temp\\referat-codex-test')),
  rm: vi.fn(() => Promise.resolve())
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', () => ({ mkdtemp: mocks.mkdtemp, rm: mocks.rm }))
vi.mock('node:os', () => ({ tmpdir: (): string => 'C:\\Temp' }))

import { CODEX_SUMMARY_ARGS, CodexCliError, codexErrorMessage, runCodexSummary } from './codex'

interface FakeChild extends EventEmitter {
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(run: (child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  queueMicrotask(() => run(child))
  return child
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runCodexSummary', () => {
  it('uses the authenticated CLI as a locked-down ephemeral text process', async () => {
    let child: FakeChild | undefined
    mocks.spawn.mockImplementation(() => {
      child = fakeChild((running) => {
        running.stderr.emit('data', Buffer.from('progress'))
        running.stdout.emit('data', Buffer.from('  # Protokoll\n'))
        running.emit('close', 0, null)
      })
      return child
    })

    await expect(runCodexSummary('PROMPT MED TRANSKRIPT', 1000)).resolves.toBe('# Protokoll')

    expect(mocks.spawn).toHaveBeenCalledWith(
      'codex',
      [...CODEX_SUMMARY_ARGS],
      expect.objectContaining({
        cwd: 'C:\\Temp\\referat-codex-test',
        shell: false,
        windowsHide: true
      })
    )
    expect(CODEX_SUMMARY_ARGS).toEqual(
      expect.arrayContaining([
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        'read-only',
        'approval_policy="never"',
        'features.shell_tool=false',
        'features.apps=false',
        'features.plugins=false',
        'web_search="disabled"',
        'history.persistence="none"',
        '-'
      ])
    )
    expect(child?.stdin.end).toHaveBeenCalledWith('PROMPT MED TRANSKRIPT', 'utf8')
    expect(mocks.rm).toHaveBeenCalledWith('C:\\Temp\\referat-codex-test', {
      recursive: true,
      force: true
    })
  })

  it('reports a missing CLI and still removes the temporary workspace', async () => {
    mocks.spawn.mockImplementation(() => {
      return fakeChild((running) => {
        const err = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })
        running.emit('error', err)
      })
    })

    const result = runCodexSummary('prompt', 1000)
    await expect(result).rejects.toMatchObject({ kind: 'not-found' })
    await expect(result).rejects.toThrow('Codex CLI hittades inte')
    expect(mocks.rm).toHaveBeenCalled()
  })

  it('keeps CLI stderr as technical detail for a failed authenticated run', async () => {
    mocks.spawn.mockImplementation(() => {
      return fakeChild((running) => {
        running.stderr.emit('data', Buffer.from('Not logged in. Run codex login.'))
        running.emit('close', 1, null)
      })
    })

    const result = runCodexSummary('prompt', 1000)
    await expect(result).rejects.toMatchObject({
      kind: 'failed',
      detail: 'Not logged in. Run codex login.'
    })
  })
})

describe('codexErrorMessage', () => {
  it('maps authentication failures to an actionable Swedish message', () => {
    const err = new CodexCliError('failed', 'exit 1', 'Authentication required')
    expect(codexErrorMessage(err)).toBe('Codex är inte inloggat — kör codex login')
  })

  it('distinguishes missing and inaccessible executables', () => {
    expect(codexErrorMessage(new CodexCliError('not-found', 'missing'))).toContain(
      'Codex CLI hittades inte'
    )
    expect(codexErrorMessage(new CodexCliError('access-denied', 'denied'))).toContain(
      'Windows-behörigheterna'
    )
  })
})
