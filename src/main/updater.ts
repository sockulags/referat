// Silent auto-updates via electron-updater + GitHub Releases.
//
// Design goals (maintenance mode): invisible and never in the way. We check for
// updates 30s after the app is ready — so startup stays snappy — and then every
// 4 hours. Found updates download automatically and install on the next quit;
// a finished download also nudges the renderer so it can offer a calm "restart
// now" toast. Every failure is swallowed to a log line: a flaky network or a
// missing release must never surface an error to the user.

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import type { NsisUpdater } from 'electron-updater'
import { IPC } from './ipc'

const FIRST_CHECK_DELAY_MS = 30_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

function log(message: string, error?: unknown): void {
  // Update problems are logged, never shown. Keep this the only output path.
  if (error !== undefined) console.error(`[updater] ${message}`, error)
  else console.log(`[updater] ${message}`)
}

function checkQuietly(): void {
  autoUpdater.checkForUpdates().catch((error) => log('check failed', error))
}

/**
 * On Windows, electron-updater verifies the downloaded installer with
 * Authenticode (Get-AuthenticodeSignature) and requires a *trusted* result
 * whose publisher matches `win.publisherName`. Our installer is signed with a
 * self-signed certificate (subject `CN=Lucas Skog, O=referat`) that lives in no
 * end user's Trusted Root store, so that check can NEVER pass on a real
 * machine — even though the publisher name matches — and every update would be
 * rejected as "signature verification failed".
 *
 * We therefore replace the verifier with a no-op (returns null = "no error").
 * This is an acceptable trade-off because download integrity is still fully
 * protected by a different mechanism: electron-updater fetches `latest.yml`
 * over HTTPS from GitHub Releases and checks the installer's sha512 hash from
 * it before executing anything, so a tampered or MITM'd binary is rejected
 * regardless of the signature. What we forgo is the *additional* code-signing
 * identity guarantee — which a self-signed cert offers no real trust for anyway.
 *
 * `win.publisherName: ['Lucas Skog']` is set in electron-builder.yml to match
 * the current cert subject, so once installers are signed by a CA-trusted
 * certificate (SignPath, per the wiki Roadmap) this override can simply be
 * DELETED and full Authenticode verification is restored with no other change.
 */
function relaxCodeSignatureVerification(): void {
  if (process.platform !== 'win32') return
  // The exported `autoUpdater` is an NsisUpdater instance on Windows; the
  // setter only exists on that subclass, hence the cast.
  const nsis = autoUpdater as unknown as NsisUpdater
  nsis.verifyUpdateCodeSignature = (): Promise<string | null> => Promise.resolve(null)
}

/**
 * Wire up the auto-updater. Safe to call unconditionally: it no-ops in dev and
 * when the app is not packaged — there is no installer to replace and no
 * `app-update.yml` to read, so a real check would only throw.
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (is.dev || !app.isPackaged) {
    log('disabled (dev or not packaged)')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // We handle our own quiet logging; silence electron-updater's default logger.
  autoUpdater.logger = null

  relaxCodeSignatureVerification()

  autoUpdater.on('error', (error) => log('error event', error))
  autoUpdater.on('update-downloaded', (info) => {
    log(`version ${info.version} downloaded and staged`)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.updateDownloaded, { version: info.version })
    }
  })

  setTimeout(checkQuietly, FIRST_CHECK_DELAY_MS)
  setInterval(checkQuietly, RECHECK_INTERVAL_MS)
}

/**
 * Quit and install the downloaded update now (invoked by the toast action).
 *
 * IMPORTANT: the caller MUST set the app's `isQuitting` flag to true *before*
 * calling this. electron-updater closes all windows before emitting
 * `before-quit`, and the main window's close handler hides to tray instead of
 * quitting while a recording is active — without the flag it would swallow the
 * restart.
 */
export function installUpdateNow(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (error) {
    log('quitAndInstall failed', error)
  }
}
