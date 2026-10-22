import { nativeTheme, type BrowserWindow, type TitleBarOverlayOptions } from 'electron'
import { getSettings } from './settings'

/** Height of the strip the renderer draws for the window controls (px). */
export const TITLE_BAR_HEIGHT = 36

// --bg and --fg-muted from src/renderer/src/assets/main.css, so the strip
// Windows draws behind its buttons is the same colour as the app.
const COLORS = {
  light: { color: '#faf9f7', symbolColor: '#56605a' },
  dark: { color: '#1a1917', symbolColor: '#a8a59d' }
}

let window: BrowserWindow | null = null

/** The overlay for the current theme, resolving 'system' like the renderer does. */
export function titleBarOverlay(): TitleBarOverlayOptions {
  const theme = getSettings().theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return { ...COLORS[dark ? 'dark' : 'light'], height: TITLE_BAR_HEIGHT }
}

/** Repaint the window controls after a theme change. */
export function refreshTitleBar(): void {
  if (!window || window.isDestroyed()) return
  window.setTitleBarOverlay(titleBarOverlay())
}

/** Keep the main window's controls in the app's colours from now on. */
export function trackTitleBar(win: BrowserWindow): void {
  if (!window) nativeTheme.on('updated', refreshTitleBar)
  window = win
}
