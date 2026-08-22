import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(() => Promise.resolve('C:\\Temp\\referat-codex-test')),
  rm: vi.fn(() => Promise.resolve()),
  statSync: vi.fn(() => ({ isFile: () => true }))
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ statSync: mocks.statSync }))
vi.mock('node:fs/promises', () => ({ mkdtemp: mocks.mkdtemp, rm: mocks.rm }))
vi.mock('node:os', () => ({
  tmpdir: (): string => 'C:\\Temp',
  homedir: (): string => 'C:\\Users\\x'
}))

import {
  CODEX_SUMMARY_ARGS,
  CodexCliError,
  codexErrorMessage,
  codexInstallCandidates,
  codexSpawnArgs,
  resolveCodexExecutable,
  runCodexSummary,
  type CodexLookup
} from './codex'

const CODEX_EXE = 'C:\\Programs\\Codex\\bin\\codex.exe'

function lookup(overrides: Partial<CodexLookup> = {}): CodexLookup {
  return {
    platform: 'win32',
    env: {},
    home: 'C:\\Users\\x',
    isFile: () => false,
    ...overrides
  }
}

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
  mocks.statSync.mockImplementation(() => ({ isFile: () => true }))
  // Pin the executable so the spawn tests do not depend on the machine they
  // run on; resolution itself is covered by its own tests below.
  vi.stubEnv('REFERAT_CODEX_PATH', CODEX_EXE)
})

afterEach(() => {
  vi.unstubAllEnvs()
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
      CODEX_EXE,
      [...CODEX_SUMMARY_ARGS],
      expect.objectContaining({
        cwd: 'C:\\Temp\\referat-codex-test',
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: false
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

  it('fails with the searched locations before spawning anything', async () => {
    mocks.statSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = runCodexSummary('prompt', 1000)
    await expect(result).rejects.toMatchObject({ kind: 'not-found' })
    await expect(result).rejects.toMatchObject({ detail: expect.stringContaining(CODEX_EXE) })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.rm).toHaveBeenCalled()
  })

  // The npm-installed CLI is a .cmd shim with no .exe beside it, which is what
  // a managed machine usually ends up with. Node cannot start it directly.
  it.skipIf(process.platform !== 'win32')('drives a .cmd shim through cmd.exe', async () => {
    vi.stubEnv('REFERAT_CODEX_PATH', 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')
    mocks.spawn.mockImplementation(() =>
      fakeChild((running) => {
        running.stdout.emit('data', Buffer.from('# Protokoll'))
        running.emit('close', 0, null)
      })
    )

    await expect(runCodexSummary('prompt', 1000)).resolves.toBe('# Protokoll')

    const [command, args, options] = mocks.spawn.mock.calls[0] as [string, string[], object]
    expect(command.toLowerCase()).toMatch(/cmd\.exe$/)
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(args[3]).toContain('codex.cmd')
    expect(options).toMatchObject({ windowsVerbatimArguments: true })
  })

  it('explains a spawn that throws instead of emitting an error', async () => {
    mocks.spawn.mockImplementation(() => {
      throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' })
    })

    const result = runCodexSummary('prompt', 1000)
    await expect(result).rejects.toMatchObject({ kind: 'failed' })
    await expect(result).rejects.toThrow('Codex CLI kunde inte startas')
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

describe('resolveCodexExecutable', () => {
  it('finds the Windows installer location when PATH does not carry it', () => {
    const installed = 'C:\\Users\\x\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'
    const resolved = resolveCodexExecutable(
      lookup({
        env: { PATH: 'C:\\windows\\system32', PATHEXT: '.EXE;.CMD' },
        isFile: (path) => path === installed
      })
    )
    expect(resolved).toEqual({ executable: installed })
  })

  it('prefers PATH over the install locations', () => {
    const onPath = 'D:\\tools\\codex.exe'
    const resolved = resolveCodexExecutable(
      lookup({ env: { PATH: 'D:\\tools', PATHEXT: '.EXE' }, isFile: () => true })
    )
    expect(resolved).toEqual({ executable: onPath })
  })

  it('honours an explicit override and reports it alone when it is wrong', () => {
    const env = { REFERAT_CODEX_PATH: 'E:\\custom\\codex.exe', PATH: 'D:\\tools' }
    expect(resolveCodexExecutable(lookup({ env, isFile: () => true }))).toEqual({
      executable: 'E:\\custom\\codex.exe'
    })
    expect(resolveCodexExecutable(lookup({ env, isFile: () => false }))).toEqual({
      searched: ['E:\\custom\\codex.exe']
    })
  })

  it('names the install locations it tried when nothing is found', () => {
    const resolved = resolveCodexExecutable(lookup({ env: { PATH: 'C:\\windows' } }))
    expect(resolved).toEqual({ searched: codexInstallCandidates(lookup()) })
  })

  it('reaches a Homebrew install on macOS', () => {
    const resolved = resolveCodexExecutable(
      lookup({
        platform: 'darwin',
        home: '/Users/x',
        env: { PATH: '/usr/bin' },
        isFile: (path) => path === '/opt/homebrew/bin/codex'
      })
    )
    expect(resolved).toEqual({ executable: '/opt/homebrew/bin/codex' })
  })
})

describe('codexSpawnArgs', () => {
  it('runs a real executable directly', () => {
    expect(codexSpawnArgs(CODEX_EXE, ['exec', '-'], { platform: 'win32', env: {} })).toEqual({
      command: CODEX_EXE,
      args: ['exec', '-'],
      verbatim: false
    })
  })

  it('routes a Windows shim through cmd.exe, which Node cannot spawn directly', () => {
    const shim = 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd'
    expect(
      codexSpawnArgs(shim, ['exec', '--config', 'web_search="disabled"'], {
        platform: 'win32',
        env: {}
      })
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${shim}" "exec" "--config" "web_search=\\"disabled\\"""`],
      verbatim: true
    })
  })

  it('leaves a .cmd suffix alone off Windows', () => {
    const result = codexSpawnArgs('/usr/local/bin/codex.cmd', ['exec'], {
      platform: 'linux',
      env: {}
    })
    expect(result.command).toBe('/usr/local/bin/codex.cmd')
    expect(result.verbatim).toBe(false)
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
