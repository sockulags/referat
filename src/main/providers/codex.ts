// Non-interactive Codex CLI client. This deliberately uses the user's existing
// local Codex authentication instead of accepting or persisting an API key.

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

function appendCapped(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString('utf8')
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) return next
  return Buffer.from(next, 'utf8').subarray(-maxBytes).toString('utf8')
}

function runProcess(prompt: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_COMMAND, [...CODEX_SUMMARY_ARGS], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

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
    return 'Codex CLI hittades inte — installera Codex eller kontrollera PATH'
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
