import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  session,
  desktopCapturer,
  ipcMain
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipcHandlers'
import { handleMediaRequests, registerMediaScheme } from './media'
import { stopAllLocalAiComponents } from './localAiComponents'
import { openExternalSafe } from './security'
import { recoverPipeline } from './pipeline'
import { isRecordingActive } from './storage'
import { getSettings } from './settings'
import { startedHidden } from './background'
import { watchCalls } from './callDetection'
import type { CallApp } from '../shared/types'
import { initAutoUpdater, installUpdateNow } from './updater'
import { IPC } from './ipc'
import {
  applyDictationSettings,
  dictationTranscriptionUrl,
  shutdownDictation
} from './dictationService'
import { shareTranscriptionWith } from './providers/transcription'
import { readViskaConfig, runViskaImport, viskaConfigPath } from './viskaImport'
import { mergeImportedDictation, recordViskaImport } from './settings'
import { addGlossaryEntry } from './glossary'

// Test hook: E2E harnesses point userData at a scratch directory so runs are
// isolated and repeatable. Also keeps `electron out/main` dev runs from
// sharing %APPDATA%\Electron with other dev apps.
if (process.env['REFERAT_USER_DATA']) {
  app.setPath('userData', process.env['REFERAT_USER_DATA'])
}

// One referat at a time. A second start, say from the Start menu while referat
// sits in the tray, shows the running one instead of starting another next to
// it. The lock follows userData, so isolated E2E runs do not collide.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}
app.on('second-instance', () => restoreWindow())

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
/** True until the first window has decided whether to show itself. */
let hiddenStart = startedHidden()

function restoreWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  tray?.setToolTip('referat')
}

const CALL_TITLES: Record<CallApp, string> = {
  teams: 'Ett Teams-möte har börjat',
  zoom: 'Ett Zoom-möte har börjat',
  browser: 'Ett möte i webbläsaren har börjat'
}

/**
 * Tell the app a call started, so Home can offer to record it, and show a
 * notification when the window is not in front. Clicking it brings referat
 * up with the offer.
 */
function announceCall(callApp: CallApp): void {
  mainWindow?.webContents.send(IPC.callDetected, { app: callApp, active: true })
  const inFront = mainWindow?.isVisible() && mainWindow.isFocused()
  if (inFront || !Notification.isSupported()) return
  const notification = new Notification({
    title: CALL_TITLES[callApp],
    body: 'Klicka för att spela in det med referat.'
  })
  notification.on('click', () => restoreWindow())
  notification.show()
}

function ensureTray(): void {
  if (tray) return
  const image = nativeImage.createFromPath(icon)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('referat')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Öppna referat', click: () => restoreWindow() },
      { type: 'separator' },
      {
        label: 'Avsluta',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => restoreWindow())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    // Started by the login item: stay in the tray until the user opens it.
    if (!hiddenStart) mainWindow?.show()
    hiddenStart = false
  })

  // While a recording is active, or when the user wants referat in the
  // background, closing hides to the tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    const recording = isRecordingActive()
    if (recording || getSettings().runInBackground) {
      event.preventDefault()
      mainWindow?.hide()
      ensureTray()
      tray?.setToolTip(recording ? 'referat – inspelning pågår' : 'referat körs i bakgrunden')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url)
    return { action: 'deny' }
  })

  // The app is a single local page; any main-frame navigation is hostile.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Grant the renderer's getDisplayMedia({audio,video}) request access to system
 * audio via WASAPI loopback on Windows. We auto-pick the first screen source.
 */
function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length === 0) {
            // No screen available: deny by returning an empty selection.
            callback({})
            return
          }
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

registerMediaScheme()

app.whenReady().then(() => {
  // Must match the installer's appId (electron-builder.yml): Windows only shows
  // notifications for an id a Start menu shortcut registered.
  electronApp.setAppUserModelId('se.lucasskog.referat')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDisplayMediaHandler()
  registerIpcHandlers()
  handleMediaRequests()
  ensureTray()
  recoverPipeline()

  createWindow()

  // Toast action: flip isQuitting first so the hide-to-tray close handler does
  // not swallow the restart, then quit and install the staged update.
  ipcMain.handle(IPC.installUpdateNow, () => {
    isQuitting = true
    installUpdateNow()
  })

  watchCalls({
    enabled: () => getSettings().detectCalls,
    recording: isRecordingActive,
    onStart: (callApp) => announceCall(callApp),
    onEnd: (callApp) =>
      mainWindow?.webContents.send(IPC.callDetected, { app: callApp, active: false })
  })

  // Background auto-updates. No-ops in dev / when not packaged.
  initAutoUpdater(() => mainWindow)

  // With dictation running, meetings use its model instead of a second one.
  shareTranscriptionWith(dictationTranscriptionUrl)

  // Someone coming from Viska keeps their dictation settings and words.
  try {
    const imported = runViskaImport({
      alreadyDone: () => getSettings().viskaImport !== null,
      read: () => readViskaConfig(viskaConfigPath()),
      saveDictation: mergeImportedDictation,
      addTerm: (canonical, heard) => void addGlossaryEntry(canonical, heard),
      record: recordViskaImport
    })
    if (imported) console.log(`Imported from Viska: ${imported.terms} glossary terms`)
  } catch (err) {
    console.error('Importing from Viska failed', err)
  }

  // Dictation left on last time starts again with referat. A locally built
  // engine (REFERAT_DICTATION_ENGINE) starts it regardless, for development.
  const dictation = getSettings().dictation
  if (dictation.enabled || process.env.REFERAT_DICTATION_ENGINE) {
    applyDictationSettings({ ...dictation, enabled: true }).catch((error) =>
      console.error('Dikteringen startade inte:', error)
    )
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopAllLocalAiComponents()
  shutdownDictation()
  isQuitting = true
})

// Quit when all windows are closed (Windows/Linux). A hidden-to-tray window is
// not "closed", so an active recording keeps the app alive.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
