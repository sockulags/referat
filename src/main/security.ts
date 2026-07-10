import { shell } from 'electron'

/**
 * Open a URL in the system browser, but only for web/mailto schemes.
 * Anything else (file:, smb:, custom protocol handlers) can launch local
 * programs and is rejected.
 */
export function openExternalSafe(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Promise.resolve()
  }
  if (
    parsed.protocol === 'http:' ||
    parsed.protocol === 'https:' ||
    parsed.protocol === 'mailto:'
  ) {
    return shell.openExternal(url)
  }
  return Promise.resolve()
}
