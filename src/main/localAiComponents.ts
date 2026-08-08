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

interface ComponentDefinition {
  asset: string
  executable: string
  port: number
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
  }
}

const states = new Map<LocalAiComponent, LocalAiComponentStatus>()
const children = new Map<LocalAiComponent, ChildProcess>()

function componentsRoot(): string {
  const localBase = process.env.LOCALAPPDATA || app.getPath('userData')
  return join(localBase, 'referat', 'local-ai')
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

export function listLocalAiComponents(): LocalAiComponentStatus[] {
  return (Object.keys(DEFINITIONS) as LocalAiComponent[]).map(currentStatus)
}

function releaseUrl(asset: string): string {
  const override = process.env.REFERAT_COMPONENT_BASE_URL?.replace(/\/$/, '')
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

async function waitForHealth(port: number): Promise<void> {
  // First start also downloads and warms the model; slow connections need room.
  const deadline = Date.now() + 15 * 60_000
  let lastError = ''
  while (Date.now() < deadline) {
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

export async function ensureLocalAiComponentRunning(
  component: LocalAiComponent,
  secrets?: { hfToken?: string }
): Promise<void> {
  const definition = DEFINITIONS[component]
  if (!existsSync(executablePath(component))) {
    throw new Error(
      'Den lokala AI-komponenten är inte installerad. Installera den i Inställningar.'
    )
  }
  const existing = children.get(component)
  if (existing && existing.exitCode === null) return

  // CPU/GPU diarization variants share a port and must never run together.
  if (component.startsWith('diarization-')) {
    stopComponent(component === 'diarization-cpu' ? 'diarization-gpu' : 'diarization-cpu')
  }
  emit({ component, state: 'starting', message: 'Startar komponenten…' })
  const child = spawn(executablePath(component), definition.args, {
    cwd: dirname(executablePath(component)),
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PYANNOTE_METRICS_ENABLED: '0',
      HF_HOME: join(componentsRoot(), 'models'),
      ...(secrets?.hfToken ? { HF_TOKEN: secrets.hfToken } : {})
    }
  })
  children.set(component, child)
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8_000)
  })
  child.once('exit', (code) => {
    children.delete(component)
    if (code !== 0) {
      emit({ component, state: 'error', message: 'Komponenten stannade', detail: stderr })
    }
  })
  try {
    await waitForHealth(definition.port)
    emit({ component, state: 'running', message: 'Körs' })
  } catch (error) {
    stopComponent(component)
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`.trim())
  }
}

function stopComponent(component: LocalAiComponent): void {
  const child = children.get(component)
  if (child && child.exitCode === null) child.kill()
  children.delete(component)
}

export function stopAllLocalAiComponents(): void {
  for (const component of [...children.keys()]) stopComponent(component)
}
