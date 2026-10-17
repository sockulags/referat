import type { ConnectionTestResult } from '../../shared/types'
import { strings } from './strings'

/** The result to show when a connection test could not run at all. */
export function failedTest(error: unknown): ConnectionTestResult {
  return { ok: false, message: strings.errors.genericTitle, detail: String(error) }
}
