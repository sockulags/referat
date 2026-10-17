// referat in the background: starting with Windows, hidden in the tray.

import { app } from 'electron'

/** The flag the login item starts referat with, so it opens to the tray. */
const HIDDEN_FLAG = '--hidden'

/**
 * Register or remove referat as a login item. Only the installed app: in
 * development the executable is electron.exe, which must never end up in
 * the user's startup list.
 */
export function applyOpenAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
}

/** Whether this start came from the login item and should stay in the tray. */
export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_FLAG)
}
