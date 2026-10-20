// The dictation status pill: a small always-on-top window near the bottom of
// the screen the user is working on. It never takes focus and lets clicks
// through, so dictating into another app is never interrupted. Only while
// its buttons show, and the pointer is on the pill, does it take a click —
// still without taking focus, so the text lands where the user was typing.

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { OVERLAY_CHANNELS, type OverlayAction, type OverlayState } from '../shared/dictationOverlay'

const WIDTH = 560
const HEIGHT = 96
/** Space between the pill window and the bottom of the work area. */
const MARGIN = 16

export class DictationOverlay {
  private window: BrowserWindow | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  /** The state shown has buttons. */
  private actions = false
  private listening = false

  constructor(private readonly onAction: (action: OverlayAction) => void) {}

  /**
   * Create the window hidden, ahead of the first dictation, so showing it is
   * instant rather than a page load.
   */
  prepare(): void {
    if (this.window && !this.window.isDestroyed()) return
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        sandbox: true,
        // A hidden window still has to react the moment dictation starts.
        backgroundThrottling: false
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    // Forwarded moves still reach the page, which says when the pointer is on the pill.
    window.setIgnoreMouseEvents(true, { forward: true })
    this.listen()
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/overlay.html'))
    }
    window.on('closed', () => {
      this.window = null
    })
    this.window = window
  }

  private listen(): void {
    if (this.listening) return
    this.listening = true
    const fromPill = (sender: Electron.WebContents): boolean =>
      !!this.window && !this.window.isDestroyed() && sender === this.window.webContents
    ipcMain.on(OVERLAY_CHANNELS.action, (event, action: unknown) => {
      if (!fromPill(event.sender) || !this.actions) return
      if (action === 'insert_raw' || action === 'cancel') this.onAction(action)
    })
    ipcMain.on(OVERLAY_CHANNELS.pointer, (event, over: unknown) => {
      if (fromPill(event.sender)) this.takeClicks(this.actions && over === true)
    })
  }

  private takeClicks(take: boolean): void {
    if (!this.window || this.window.isDestroyed()) return
    if (take) this.window.setIgnoreMouseEvents(false)
    else this.window.setIgnoreMouseEvents(true, { forward: true })
  }

  show(state: OverlayState): void {
    this.prepare()
    const window = this.window!
    this.clearHideTimer()
    this.actions = !!state.actions
    if (!this.actions) this.takeClicks(false)
    window.webContents.send(OVERLAY_CHANNELS.state, state)
    if (!window.isVisible()) {
      this.placeOnActiveScreen(window)
      window.showInactive()
    }
    if (state.autoHideMs) {
      this.hideTimer = setTimeout(() => this.hide(), state.autoHideMs)
    }
  }

  level(value: number): void {
    if (this.window?.isVisible()) this.window.webContents.send(OVERLAY_CHANNELS.level, value)
  }

  hide(): void {
    this.clearHideTimer()
    this.actions = false
    this.takeClicks(false)
    if (this.window?.isVisible()) this.window.hide()
  }

  destroy(): void {
    this.clearHideTimer()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private clearHideTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }

  /**
   * Bottom centre of the screen with the mouse on it — where the user is
   * working — above the taskbar, wherever the taskbar sits.
   */
  private placeOnActiveScreen(window: BrowserWindow): void {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    window.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height - HEIGHT - MARGIN),
      width: WIDTH,
      height: HEIGHT
    })
  }
}
