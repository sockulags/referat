import { app, BrowserWindow, Tray, Menu, nativeImage, session, desktopCapturer } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipcHandlers'
import { openExternalSafe } from './security'
import { recoverPipeline } from './pipeline'
import { isRecordingActive } from './storage'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

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
    mainWindow?.show()
  })

  // While a recording is active, closing hides to tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (!isQuitting && isRecordingActive()) {
      event.preventDefault()
      mainWindow?.hide()
      ensureTray()
      tray?.setToolTip('referat – inspelning pågår')
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('se.referat.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDisplayMediaHandler()
  registerIpcHandlers()
  ensureTray()
  recoverPipeline()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

// Quit when all windows are closed (Windows/Linux). A hidden-to-tray window is
// not "closed", so an active recording keeps the app alive.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
