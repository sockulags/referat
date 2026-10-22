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

/**
 * Make the parts Windows and Chromium draw (window border, scrollbars, native
 * menus) follow referat's theme setting instead of Windows' own. 'system'
 * still follows Windows.
 */
export function applyNativeTheme(): void {
  nativeTheme.themeSource = getSettings().theme
}

/** The overlay for a light or dark page; before the page has said, a guess. */
export function titleBarOverlay(dark = nativeTheme.shouldUseDarkColors): TitleBarOverlayOptions {
  return { ...COLORS[dark ? 'dark' : 'light'], height: TITLE_BAR_HEIGHT }
}

/**
 * Paint the window controls for the theme the page actually shows. The page
 * reports it each time it applies a theme, so the buttons can never end up
 * in a different theme from the app around them.
 */
export function setTitleBarTheme(dark: boolean): void {
  if (!window || window.isDestroyed()) return
  window.setTitleBarOverlay(titleBarOverlay(dark))
}

/** The window whose controls follow the page's theme. */
export function trackTitleBar(win: BrowserWindow): void {
  window = win
}
