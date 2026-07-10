// Orchestrates the E2E run: start the mock AI server, wait until it answers,
// run the Playwright walkthrough, then tear the server down. Propagates the
// walkthrough's exit code so CI fails on any assertion failure.
//
// Assumes `npm run build` has already produced out/ (CI builds first; locally
// run `npm run build && node e2e/runner.mjs`).
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const PORT = 8000

function log(msg) {
  console.log(`[runner] ${msg}`)
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const mock = spawn('node', [path.join(REPO, 'scripts', 'mock-ai-server.mjs'), String(PORT)], {
  cwd: REPO,
  stdio: ['ignore', 'inherit', 'inherit']
})

let mockExited = false
mock.on('exit', () => {
  mockExited = true
})

function stopMock() {
  if (!mockExited && mock.pid) {
    try {
      mock.kill()
    } catch {
      /* ignore */
    }
  }
}

process.on('exit', stopMock)
process.on('SIGINT', () => {
  stopMock()
  process.exit(130)
})

let exitCode = 1
try {
  log(`starting mock AI server on :${PORT}`)
  const up = await waitForServer(`http://localhost:${PORT}/v1/models`)
  if (!up) throw new Error('mock AI server did not become ready in time')
  log('mock server ready — launching walkthrough')

  exitCode = await new Promise((resolve) => {
    const child = spawn('node', [path.join(HERE, 'run.mjs')], {
      cwd: REPO,
      stdio: 'inherit'
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', (err) => {
      console.error('[runner] failed to launch run.mjs:', err)
      resolve(1)
    })
  })
} catch (err) {
  console.error('[runner] error:', err?.stack || String(err))
  exitCode = 1
} finally {
  stopMock()
}

log(`walkthrough exit code: ${exitCode}`)
process.exit(exitCode)
