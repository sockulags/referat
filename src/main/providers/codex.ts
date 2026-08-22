// Non-interactive Codex CLI client. This deliberately uses the user's existing
// local Codex authentication instead of accepting or persisting an API key.

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix as posixPath, win32 as winPath, type PlatformPath } from 'node:path'
import type { Readable, Writable } from 'node:stream'

const CODEX_COMMAND = 'codex'
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024

export type CodexCliErrorKind = 'not-found' | 'access-denied' | 'timeout' | 'failed' | 'empty'

export class CodexCliError extends Error {
  constructor(
    public kind: CodexCliErrorKind,
    message: string,
    public detail = message
  ) {
    super(message)
    this.name = 'CodexCliError'
  }
}

/**
 * Flags are intentionally explicit so a user's Codex plugins, rules, MCP
 * servers, web search, shell access, or history settings cannot widen this
 * one-shot text-in/text-out operation.
 */
export const CODEX_SUMMARY_ARGS = [
  'exec',
  '--ephemeral',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--ignore-rules',
  '--sandbox',
  'read-only',
  '--config',
  'approval_policy="never"',
  '--config',
  'features.shell_tool=false',
  '--config',
  'features.apps=false',
  '--config',
  'features.plugins=false',
  '--config',
  'web_search="disabled"',
  '--config',
  'history.persistence="none"',
  '-'
] as const

// ---- Locating the CLI ----
//
// A desktop app cannot rely on PATH. Its environment is whatever launched it —
// a shortcut, another launcher, or a shell that predates the Codex install —
// so a working `codex` in the terminal says nothing about what the app sees.
// We therefore search PATH first and then the known install locations, and
// report which places were tried when nothing is found.

export interface CodexLookup {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  isFile: (path: string) => boolean
}

function realLookup(): CodexLookup {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    isFile: (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    }
  }
}

// The rules of the target platform, not of the machine running this code, so
// the lookup stays a pure function of what it is handed.
function pathRules(platform: NodeJS.Platform): PlatformPath {
  return platform === 'win32' ? winPath : posixPath
}

/** Directories the official installers and the common package managers use. */
export function codexInstallCandidates(lookup: CodexLookup): string[] {
  const { platform, env, home } = lookup
  const { join } = pathRules(platform)
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [
      join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      join(home, '.codex', 'bin', 'codex.exe'),
      join(appData, 'npm', 'codex.cmd'),
      join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.cmd')
    ]
  }
  return [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(home, '.codex', 'bin', 'codex'),
    join(home, '.local', 'bin', 'codex'),
    join(home, '.bun', 'bin', 'codex')
  ]
}

function pathCandidates(lookup: CodexLookup): string[] {
  const { platform, env } = lookup
  const { join, delimiter } = pathRules(platform)
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const extensions =
    platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  return dirs.flatMap((dir) =>
    // A PATH entry can be quoted, or hold an environment reference the parent
    // process never expanded; both simply fail the file check below.
    extensions.map((ext) => join(dir.replace(/^"|"$/g, ''), CODEX_COMMAND + ext.toLowerCase()))
  )
}

/**
 * The executable to run, or the list of places searched when there is none.
 * `REFERAT_CODEX_PATH` overrides everything for a non-standard install.
 */
export function resolveCodexExecutable(
  lookup: CodexLookup = realLookup()
): { executable: string } | { searched: string[] } {
  const override = lookup.env.REFERAT_CODEX_PATH?.trim()
  if (override) {
    return lookup.isFile(override) ? { executable: override } : { searched: [override] }
  }

  const searched = [...pathCandidates(lookup), ...codexInstallCandidates(lookup)]
  const found = searched.find(lookup.isFile)
  if (found) return { executable: found }
  return { searched: [...new Set(codexInstallCandidates(lookup))] }
}

// Resolved per run rather than cached, so installing Codex and pressing "Testa
// Codex" again works without restarting the app. A run costs one summary.
function codexExecutable(): string {
  const resolved = resolveCodexExecutable()
  if ('searched' in resolved) {
    throw new CodexCliError(
      'not-found',
      'Codex CLI hittades inte',
      `Sökte i:\n${resolved.searched.join('\n')}`
    )
  }
  return resolved.executable
}

function quoteForCmd(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

/**
 * Node refuses to spawn `.cmd`/`.bat` files directly, so an npm-installed Codex
 * has to go through cmd.exe. The argument list is a fixed constant — no
 * transcript text reaches it — and the prompt is written to stdin.
 */
export function codexSpawnArgs(
  executable: string,
  args: readonly string[],
  lookup: Pick<CodexLookup, 'platform' | 'env'>
): { command: string; args: string[]; verbatim: boolean } {
  const extension = pathRules(lookup.platform).extname(executable).toLowerCase()
  if (lookup.platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    const line = [executable, ...args].map(quoteForCmd).join(' ')
    return {
      command: lookup.env.COMSPEC ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      verbatim: true
    }
  }
  return { command: executable, args: [...args], verbatim: false }
}

function appendCapped(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString('utf8')
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) return next
  return Buffer.from(next, 'utf8').subarray(-maxBytes).toString('utf8')
}

/**
 * Node rejects some targets before a process exists, and throws instead of
 * emitting 'error': a script Windows cannot execute directly fails with EINVAL
 * on the spot. Left unhandled it surfaces as an unexplained generic error,
 * since none of the listeners below are attached yet.
 */
function startProcess(
  invocation: ReturnType<typeof codexSpawnArgs>,
  cwd: string
): ChildProcessByStdio<Writable, Readable, Readable> {
  try {
    return spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (err) {
    throw new CodexCliError(
      'failed',
      'Codex CLI kunde inte startas',
      `${String(err)}\nGäller ${invocation.command}`
    )
  }
}

function runProcess(prompt: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const executable = codexExecutable()
    const invocation = codexSpawnArgs(executable, CODEX_SUMMARY_ARGS, process)

    const child = startProcess(invocation, cwd)

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let timedOut = false
    let outputTooLarge = false
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        outputTooLarge = true
        child.kill()
        return
      }
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, MAX_STDERR_BYTES)
    })

    child.once('error', (err: NodeJS.ErrnoException) => {
      finish(() => {
        if (err.code === 'ENOENT') {
          reject(
            new CodexCliError('not-found', 'Codex CLI hittades inte', `${err.name}: ${err.message}`)
          )
        } else if (err.code === 'EACCES' || err.code === 'EPERM') {
          reject(
            new CodexCliError(
              'access-denied',
              'Codex CLI kunde inte startas',
              `${err.name}: ${err.message}`
            )
          )
        } else {
          reject(new CodexCliError('failed', 'Codex CLI kunde inte startas', String(err)))
        }
      })
    })

    child.once('close', (code, signal) => {
      finish(() => {
        const detail = stderr.trim() || `Codex avslutades med kod ${code ?? 'okänd'}`
        if (timedOut) {
          reject(new CodexCliError('timeout', 'Codex svarar inte (timeout)', detail))
        } else if (outputTooLarge) {
          reject(
            new CodexCliError(
              'failed',
              'Codex gav ett oväntat stort svar',
              `Stdout överskred ${MAX_STDOUT_BYTES} byte`
            )
          )
        } else if (code !== 0 || signal) {
          reject(
            new CodexCliError(
              'failed',
              `Codex avslutades med ${signal ? `signal ${signal}` : `kod ${code ?? 1}`}`,
              detail
            )
          )
        } else {
          const result = stdout.trim()
          if (!result) {
            reject(new CodexCliError('empty', 'Codex gav ett tomt svar', detail))
          } else {
            resolve(result)
          }
        }
      })
    })

    child.stdin.on('error', () => {
      // A failed/early-exiting CLI is reported by the error/close handlers with
      // its useful stderr. Avoid replacing that diagnostic with a generic EPIPE.
    })
    child.stdin.end(prompt, 'utf8')
  })
}

/** Run a single, non-persisted Codex turn in an otherwise empty workspace. */
export async function runCodexSummary(prompt: string, timeoutMs: number): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'referat-codex-'))
  try {
    return await runProcess(prompt, workDir, timeoutMs)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function codexErrorMessage(err: CodexCliError): string {
  if (err.kind === 'not-found') {
    return 'Codex CLI hittades inte — installera Codex, eller peka ut den med REFERAT_CODEX_PATH'
  }
  if (err.kind === 'access-denied') {
    return 'Codex CLI kunde inte startas — kontrollera Windows-behörigheterna'
  }
  if (err.kind === 'timeout') return 'Codex svarar inte (timeout)'

  const detail = err.detail.toLowerCase()
  if (
    detail.includes('not logged in') ||
    detail.includes('login required') ||
    detail.includes('authentication') ||
    detail.includes('unauthorized') ||
    detail.includes('401')
  ) {
    return 'Codex är inte inloggat — kör codex login'
  }
  return 'Codex kunde inte skapa protokollet'
}
