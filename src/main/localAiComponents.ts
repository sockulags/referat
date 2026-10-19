import { app, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { mkdir, rename, rm } from 'fs/promises'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { LocalAiComponent, LocalAiComponentStatus } from '../shared/types'
import { IPC } from './ipc'
import { trimBaseUrl } from './providers/shared'

interface ComponentDefinition {
  asset: string
  executable: string
  /**
   * Where a server component listens. Absent for the dictation engine, which
   * talks over stdin/stdout and is started by dictation.ts, not here.
   */
  port?: number
  args: string[]
  /** GitHub release assets must stay below 2 GiB. */
  parts?: number
}

const DEFINITIONS: Record<LocalAiComponent, ComponentDefinition> = {
  'transcription-cpu': {
    asset: 'referat-transcription-cpu-win-x64.zip',
    executable: 'referat-transcription.exe',
    port: 8310,
    args: ['--host', '127.0.0.1', '--port', '8310', '--device', 'cpu']
  },
  'transcription-gpu': {
    asset: 'referat-transcription-gpu-win-x64.zip',
    executable: 'referat-transcription.exe',
    port: 8310,
    args: ['--host', '127.0.0.1', '--port', '8310', '--device', 'cuda']
  },
  'diarization-cpu': {
    asset: 'referat-diarization-cpu-win-x64.zip',
    executable: 'referat-diarization.exe',
    port: 8300,
    args: ['--host', '127.0.0.1', '--port', '8300', '--device', 'cpu']
  },
  'diarization-gpu': {
    asset: 'referat-diarization-gpu-win-x64.zip',
    executable: 'referat-diarization.exe',
    port: 8300,
    args: ['--host', '127.0.0.1', '--port', '8300', '--device', 'cuda'],
    parts: 2
  },
  // Viska's dictation engine (viska --engine), built from a pinned Viska
  // commit by scripts/build-local-ai-components.ps1.
  'dictation-cpu': {
    asset: 'referat-dictation-cpu-win-x64.zip',
    executable: 'viska-engine.exe',
    args: []
  },
  'dictation-gpu': {
    asset: 'referat-dictation-gpu-win-x64.zip',
    executable: 'viska-engine.exe',
    args: []
  }
}

const states = new Map<LocalAiComponent, LocalAiComponentStatus>()
const children = new Map<LocalAiComponent, ChildProcess>()

function componentsRoot(): string {
  const localBase = process.env.LOCALAPPDATA || app.getPath('userData')
  return join(localBase, 'referat', 'local-ai')
}

/**
 * Where a managed component listens. referat starts it itself, so the address
 * is a fact rather than a setting — the base URL in settings only ever
 * described an externally hosted server.
 */
export function localAiComponentBaseUrl(component: LocalAiComponent): string {
  return `http://127.0.0.1:${serverPort(component)}`
}

function serverPort(component: LocalAiComponent): number {
  const port = DEFINITIONS[component].port
  if (port === undefined) throw new Error(`${component} är ingen server`)
  return port
}

/** The program of an installed component, for components started elsewhere. */
export function localAiComponentExecutable(component: LocalAiComponent): string {
  return executablePath(component)
}

/**
 * The shared model cache every component that downloads models uses, so a
 * KB-Whisper model fetched once serves both transcription and dictation.
 */
export function localAiModelCache(): string {
  return join(componentsRoot(), 'models')
}

function componentDir(component: LocalAiComponent): string {
  return join(componentsRoot(), component)
}

function executablePath(component: LocalAiComponent): string {
  return join(componentDir(component), DEFINITIONS[component].executable)
}

function emit(status: LocalAiComponentStatus): LocalAiComponentStatus {
  states.set(status.component, status)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.localAiComponentProgress, status)
  }
  return status
}

function currentStatus(component: LocalAiComponent): LocalAiComponentStatus {
  const active = states.get(component)
  if (active && !['installed', 'not-installed'].includes(active.state)) return active
  return {
    component,
    state: existsSync(executablePath(component)) ? 'installed' : 'not-installed'
  }
}

/** Whether the component's program is on disk, whatever state it is in. */
export function isLocalAiComponentInstalled(component: LocalAiComponent): boolean {
  return existsSync(executablePath(component))
}

export function listLocalAiComponents(): LocalAiComponentStatus[] {
  return (Object.keys(DEFINITIONS) as LocalAiComponent[]).map(currentStatus)
}

function releaseUrl(asset: string): string {
  const override = trimBaseUrl(process.env.REFERAT_COMPONENT_BASE_URL ?? '')
  if (override) return `${override}/${asset}`
  return `https://github.com/sockulags/referat/releases/download/v${app.getVersion()}/${asset}`
}

async function download(
  url: string,
  destination: string,
  component: LocalAiComponent,
  progressStart = 0,
  progressSpan = 1
): Promise<void> {
  const response = await fetch(url)
  assertTrustedDownloadUrl(response.url)
  if (!response.ok || !response.body) {
    throw new Error(`Nedladdningen misslyckades: HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length') || 0)
  let received = 0
  const source = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    emit({
      component,
      state: 'downloading',
      progress: total > 0 ? progressStart + (received / total) * progressSpan : undefined,
      message: 'Laddar ner komponenten…'
    })
  })
  await pipeline(source, createWriteStream(destination, { flags: 'wx' }))
}

async function downloadPackage(
  component: LocalAiComponent,
  archive: string,
  definition: ComponentDefinition
): Promise<void> {
  if (!definition.parts) {
    await download(releaseUrl(definition.asset), archive, component)
    await verifySha256(archive, releaseUrl(`${definition.asset}.sha256`))
    return
  }

  const partPaths: string[] = []
  try {
    for (let index = 0; index < definition.parts; index += 1) {
      const suffix = `part${String(index + 1).padStart(2, '0')}`
      const asset = `${definition.asset}.${suffix}`
      const partPath = `${archive}.${suffix}`
      partPaths.push(partPath)
      await download(
        releaseUrl(asset),
        partPath,
        component,
        index / definition.parts,
        1 / definition.parts
      )
      await verifySha256(partPath, releaseUrl(`${asset}.sha256`))
      await pipeline(createReadStream(partPath), createWriteStream(archive, { flags: 'a' }))
    }
    await verifySha256(archive, releaseUrl(`${definition.asset}.sha256`))
  } finally {
    await Promise.all(partPaths.map((partPath) => rm(partPath, { force: true })))
  }
}

async function verifySha256(archive: string, checksumUrl: string): Promise<void> {
  const checksumResponse = await fetch(checksumUrl)
  assertTrustedDownloadUrl(checksumResponse.url)
  if (!checksumResponse.ok) throw new Error('Kunde inte hämta komponentens kontrollsumma')
  const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase()
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('Komponentens kontrollsumma är ogiltig')
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  const actual = hash.digest('hex')
  if (actual !== expected) throw new Error('Komponenten klarade inte integritetskontrollen')
}

function assertTrustedDownloadUrl(rawUrl: string): void {
  const parsed = new URL(rawUrl)
  const override = process.env.REFERAT_COMPONENT_BASE_URL
  if (override && parsed.origin === new URL(override).origin) return
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname !== 'github.com' &&
    !hostname.endsWith('.github.com') &&
    !hostname.endsWith('.githubusercontent.com')
  ) {
    throw new Error(`Komponentnedladdningen omdirigerades till en otillåten värd: ${hostname}`)
  }
}

async function extractZip(archive: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar.exe', ['-xf', archive, '-C', destination], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(stderr || `tar avslutades med ${code}`))
    )
  })
}

function assertManagedPath(path: string): void {
  const root = resolve(componentsRoot())
  const target = resolve(path)
  if (target === root || !target.startsWith(root + '\\')) {
    throw new Error('Vägrar ändra en sökväg utanför Referats komponentkatalog')
  }
}

export async function installLocalAiComponent(
  component: LocalAiComponent
): Promise<LocalAiComponentStatus> {
  const existing = currentStatus(component)
  if (existing.state === 'installed' || existing.state === 'running') return existing

  const root = componentsRoot()
  await mkdir(root, { recursive: true })
  const definition = DEFINITIONS[component]
  const archive = join(root, `${component}-${Date.now()}.zip`)
  const staging = join(root, `${component}-${Date.now()}.staging`)
  const destination = componentDir(component)
  assertManagedPath(archive)
  assertManagedPath(staging)
  assertManagedPath(destination)

  try {
    emit({ component, state: 'downloading', progress: 0, message: 'Laddar ner komponenten…' })
    await downloadPackage(component, archive, definition)
    emit({ component, state: 'installing', message: 'Installerar komponenten…' })
    await extractZip(archive, staging)
    if (!existsSync(join(staging, DEFINITIONS[component].executable))) {
      throw new Error('Komponentpaketet saknar den förväntade programfilen')
    }
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    return emit({ component, state: 'installed', progress: 1, message: 'Installerad' })
  } catch (error) {
    return emit({
      component,
      state: 'error',
      message: 'Installationen misslyckades',
      detail: error instanceof Error ? error.message : String(error)
    })
  } finally {
    await rm(archive, { force: true }).catch(() => undefined)
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function removeLocalAiComponent(component: LocalAiComponent): Promise<void> {
  stopComponent(component)
  const target = componentDir(component)
  assertManagedPath(target)
  await rm(target, { recursive: true, force: true })
  emit({ component, state: 'not-installed' })
}

/**
 * Poll until the component answers. `exited` reports why the process is gone,
 * so a component that crashes while loading (a GPU build on a machine whose
 * CUDA setup does not work, say) fails in seconds instead of after the
 * timeout meant for a first-start model download.
 */
async function waitForHealth(port: number, exited: () => string | null): Promise<void> {
  // First start also downloads and warms the model; slow connections need room.
  const deadline = Date.now() + 15 * 60_000
  let lastError = ''
  while (Date.now() < deadline) {
    const exitReason = exited()
    if (exitReason) throw new Error(`Komponenten avslutades innan den blev redo (${exitReason})`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_500)
      })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error(`Komponenten blev inte redo: ${lastError}`)
}

const starting = new Map<LocalAiComponent, Promise<void>>()

/**
 * Start the component unless it already runs. Callers that arrive while it is
 * starting share that start, so none of them talks to a process that is not
 * ready yet — or that is about to fail.
 */
export function ensureLocalAiComponentRunning(component: LocalAiComponent): Promise<void> {
  const pending = starting.get(component)
  if (pending) return pending
  const start = startComponent(component).finally(() => starting.delete(component))
  starting.set(component, start)
  return start
}

async function startComponent(component: LocalAiComponent): Promise<void> {
  const definition = DEFINITIONS[component]
  const port = serverPort(component)
  if (!existsSync(executablePath(component))) {
    throw new Error(
      'Den lokala AI-komponenten är inte installerad. Installera den i Inställningar.'
    )
  }
  const existing = children.get(component)
  if (existing && existing.exitCode === null) return

  // CPU and GPU variants of a service share its port and must never run together.
  for (const other of Object.keys(DEFINITIONS) as LocalAiComponent[]) {
    if (other !== component && DEFINITIONS[other].port === port) stopComponent(other)
  }
  emit({ component, state: 'starting', message: 'Startar komponenten…' })
  const child = spawn(executablePath(component), definition.args, {
    cwd: dirname(executablePath(component)),
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PYANNOTE_METRICS_ENABLED: '0',
      // Diarization ships its model inside the component, so point the cache
      // at it and forbid network lookups: no account, no token, works offline.
      // Transcription still fetches its model on first start, so it keeps the
      // shared cache it has already filled.
      ...(component.startsWith('diarization-')
        ? { HF_HOME: join(componentDir(component), 'models'), HF_HUB_OFFLINE: '1' }
        : { HF_HOME: localAiModelCache() })
    }
  })
  children.set(component, child)
  let stderr = ''
  let exitReason: string | null = null
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8_000)
  })
  child.once('error', (error) => {
    exitReason = error.message
  })
  child.once('exit', (code, signal) => {
    exitReason = code !== null ? `kod ${code}` : `signal ${signal}`
    // A process stopped on purpose (stopComponent) is no longer the current
    // child; only a process that died on its own is an error to show.
    if (children.get(component) !== child) return
    children.delete(component)
    if (code !== 0) {
      emit({ component, state: 'error', message: 'Komponenten stannade', detail: stderr })
    }
  })
  try {
    await waitForHealth(port, () => exitReason)
    emit({ component, state: 'running', message: 'Körs' })
  } catch (error) {
    stopComponent(component)
    const reason = error instanceof Error ? error.message : String(error)
    emit({
      component,
      state: 'error',
      message: 'Komponenten kunde inte starta',
      detail: `${reason}\n${stderr}`.trim()
    })
    throw new Error(`${reason}\n${stderr}`.trim(), { cause: error })
  }
}

function stopComponent(component: LocalAiComponent): void {
  const child = children.get(component)
  children.delete(component)
  if (child && child.exitCode === null) {
    child.kill()
    emit({ component, state: 'installed' })
  }
}

export function stopAllLocalAiComponents(): void {
  for (const component of [...children.keys()]) stopComponent(component)
}
