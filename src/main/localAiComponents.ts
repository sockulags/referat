import { app, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { spawn, type ChildProcess } from 'child_process'
import { dirname, join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { LocalAiComponent, LocalAiComponentStatus } from '../shared/types'
import { IPC } from './ipc'
import { trimBaseUrl } from './providers/shared'
import { parseSha256, updateDecision } from './componentUpdates'

/** In each component's folder: the checksum of the release asset it came from. */
const INSTALL_RECORD = 'referat-component.json'

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
    // A GPU has room for the large model, which hears Swedish markedly
    // better. If it does not fit, the start fails and the CPU build (small)
    // takes over, as for any GPU that cannot be used.
    args: [
      '--host',
      '127.0.0.1',
      '--port',
      '8310',
      '--device',
      'cuda',
      '--model',
      'KBLab/kb-whisper-large'
    ]
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
  // The dictation engine, built from dictation-engine/ by
  // scripts/build-local-ai-components.ps1.
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
const starting = new Map<LocalAiComponent, Promise<void>>()

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

/** A downloaded update, waiting for the component to stop before it is put in place. */
function pendingDir(component: LocalAiComponent): string {
  return join(componentsRoot(), `${component}.update`)
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
  message: string,
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
      message
    })
  })
  await pipeline(source, createWriteStream(destination, { flags: 'wx' }))
}

/** Download and verify the package; returns its checksum, for the install record. */
async function downloadPackage(
  component: LocalAiComponent,
  archive: string,
  definition: ComponentDefinition,
  message: string
): Promise<string> {
  if (!definition.parts) {
    await download(releaseUrl(definition.asset), archive, component, message)
    return verifySha256(archive, definition.asset)
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
        message,
        index / definition.parts,
        1 / definition.parts
      )
      await verifySha256(partPath, asset)
      await pipeline(createReadStream(partPath), createWriteStream(archive, { flags: 'a' }))
    }
    return await verifySha256(archive, definition.asset)
  } finally {
    await Promise.all(partPaths.map((partPath) => rm(partPath, { force: true })))
  }
}

/** The checksum this version's release gives for an asset. */
async function releaseSha256(asset: string): Promise<string> {
  const checksumResponse = await fetch(releaseUrl(`${asset}.sha256`))
  assertTrustedDownloadUrl(checksumResponse.url)
  if (!checksumResponse.ok) throw new Error('Kunde inte hämta komponentens kontrollsumma')
  const expected = parseSha256(await checksumResponse.text())
  if (!expected) throw new Error('Komponentens kontrollsumma är ogiltig')
  return expected
}

async function verifySha256(archive: string, asset: string): Promise<string> {
  const expected = await releaseSha256(asset)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  const actual = hash.digest('hex')
  if (actual !== expected) throw new Error('Komponenten klarade inte integritetskontrollen')
  return expected
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
    // Windows' own tar by its full path: GNU tar from Git, often earlier on
    // PATH, reads "C:" in a path as a remote host and fails.
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const child = spawn(tar, ['-xf', archive, '-C', destination], {
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

/**
 * Download, verify and unpack the component into `target`, with the record
 * of what it was installed from. Leaves nothing behind when it fails.
 */
async function fetchComponent(
  component: LocalAiComponent,
  target: string,
  message: string
): Promise<void> {
  const root = componentsRoot()
  await mkdir(root, { recursive: true })
  const archive = join(root, `${component}-${Date.now()}.zip`)
  const staging = join(root, `${component}-${Date.now()}.staging`)
  assertManagedPath(archive)
  assertManagedPath(staging)
  assertManagedPath(target)
  try {
    emit({ component, state: 'downloading', progress: 0, message })
    const sha256 = await downloadPackage(component, archive, DEFINITIONS[component], message)
    emit({ component, state: 'installing', message: 'Installerar komponenten…' })
    await extractZip(archive, staging)
    if (!existsSync(join(staging, DEFINITIONS[component].executable))) {
      throw new Error('Komponentpaketet saknar den förväntade programfilen')
    }
    await writeFile(join(staging, INSTALL_RECORD), JSON.stringify({ sha256 }))
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
  } finally {
    await rm(archive, { force: true }).catch(() => undefined)
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function installLocalAiComponent(
  component: LocalAiComponent
): Promise<LocalAiComponentStatus> {
  const existing = currentStatus(component)
  if (existing.state === 'installed' || existing.state === 'running') return existing
  try {
    await fetchComponent(component, componentDir(component), 'Laddar ner komponenten…')
    await rm(pendingDir(component), { recursive: true, force: true })
    return emit({ component, state: 'installed', progress: 1, message: 'Installerad' })
  } catch (error) {
    return emit({
      component,
      state: 'error',
      message: 'Installationen misslyckades',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

async function installedSha256(component: LocalAiComponent): Promise<string | null> {
  try {
    const record = JSON.parse(await readFile(join(componentDir(component), INSTALL_RECORD), 'utf8'))
    return typeof record?.sha256 === 'string' ? record.sha256 : null
  } catch {
    return null
  }
}

function isRunning(component: LocalAiComponent): boolean {
  const child = children.get(component)
  return (!!child && child.exitCode === null) || starting.has(component)
}

/**
 * Bring installed components up to the ones this version's release ships.
 * Only rebuilt components are downloaded. An update is put in place at once
 * when the component is not running, and otherwise the next time it starts;
 * referat never stops a component that is in use. Returns the components
 * with a new build, in place or waiting. A component that cannot be checked
 * (offline, say) stays as it is until the next launch.
 *
 * `inUse` names components running outside this module: the dictation
 * engine, which the dictation service starts and which calls
 * applyPendingLocalAiComponentUpdate itself before it starts the engine.
 */
export async function updateLocalAiComponents(
  inUse: (component: LocalAiComponent) => boolean = () => false
): Promise<LocalAiComponent[]> {
  const busy = (component: LocalAiComponent): boolean => isRunning(component) || inUse(component)
  const updated: LocalAiComponent[] = []
  for (const component of Object.keys(DEFINITIONS) as LocalAiComponent[]) {
    const state = currentStatus(component).state
    if (
      !['installed', 'running', 'error'].includes(state) ||
      !isLocalAiComponentInstalled(component)
    )
      continue
    let release: string
    try {
      release = await releaseSha256(DEFINITIONS[component].asset)
    } catch (error) {
      console.error(`Kunde inte se om ${component} har en ny version`, error)
      continue
    }
    const installed = await installedSha256(component)
    const decision = updateDecision(component, installed, release)
    if (decision === 'current') continue
    if (decision === 'adopt') {
      await writeFile(
        join(componentDir(component), INSTALL_RECORD),
        JSON.stringify({ sha256: release })
      ).catch(() => undefined)
      continue
    }
    try {
      await fetchComponent(component, pendingDir(component), 'Uppdaterar komponenten…')
      updated.push(component)
      if (!busy(component)) {
        await applyPendingLocalAiComponentUpdate(component)
      } else {
        emit({ component, state: isRunning(component) ? 'running' : 'installed' })
      }
    } catch (error) {
      console.error(`Kunde inte uppdatera ${component}`, error)
      emit({ component, state: isRunning(component) ? 'running' : 'installed' })
    }
  }
  return updated
}

/**
 * Meetings and dictation share one speech component, the dictation engine.
 * An older transcription component is replaced by the engine of the same
 * kind (processor or Nvidia GPU): the engine is installed first, and the old
 * component removed once it is not in use. A failed download leaves the old
 * one working.
 */
export async function migrateSpeechComponents(): Promise<void> {
  for (const kind of ['cpu', 'gpu'] as const) {
    const legacy: LocalAiComponent = `transcription-${kind}`
    const speech: LocalAiComponent = `dictation-${kind}`
    if (!isLocalAiComponentInstalled(legacy)) continue
    if (!isLocalAiComponentInstalled(speech)) {
      const status = await installLocalAiComponent(speech)
      if (status.state !== 'installed') continue
    }
    if (!isRunning(legacy)) await removeLocalAiComponent(legacy)
  }
}

/**
 * Put a downloaded update in place, if there is one. Only for a component
 * that is not running: Windows keeps a running program's files locked.
 */
export async function applyPendingLocalAiComponentUpdate(
  component: LocalAiComponent
): Promise<boolean> {
  const pending = pendingDir(component)
  if (!existsSync(pending)) return false
  const destination = componentDir(component)
  assertManagedPath(pending)
  assertManagedPath(destination)
  // A process that just exited can hold its files for a moment longer.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(destination, { recursive: true, force: true })
      await rename(pending, destination)
      break
    } catch (error) {
      if (attempt >= 5) throw error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
  }
  emit({ component, state: 'installed', message: 'Uppdaterad' })
  return true
}

export async function removeLocalAiComponent(component: LocalAiComponent): Promise<void> {
  stopComponent(component)
  const target = componentDir(component)
  assertManagedPath(target)
  await rm(target, { recursive: true, force: true })
  await rm(pendingDir(component), { recursive: true, force: true })
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

  await applyPendingLocalAiComponentUpdate(component).catch((error) =>
    console.error(`Uppdateringen av ${component} kunde inte läggas på plats`, error)
  )

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
