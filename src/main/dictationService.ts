// Runs the dictation engine and shows what it reports in the status pill.
//
// Started when dictation is switched on in settings, and at launch when it
// was left on. REFERAT_DICTATION_ENGINE points at a locally built engine for
// development.

import { BrowserWindow } from 'electron'
import { overlayChange } from '../shared/dictationOverlay'
import type { DictationMicrophone, DictationSettings } from '../shared/types'
import { dictationEngineConfig, dictationGlossaryConfig } from './dictationConfig'
import { glossaryPromptBlock, listGlossaryTerms } from './glossary'
import { getSettings, getSummaryConfig } from './settings'
import { rewriteDictation } from './providers/dictationRewrite'
import { DictationEngineProcess, dictationEngineProgram, type EngineEvent } from './dictation'
import { DictationOverlay } from './dictationOverlay'
import { addDictation } from './dictationHistory'
import { IPC } from './ipc'

const overlay = new DictationOverlay()
let engine: DictationEngineProcess | null = null
let hotkey = 'f9'

function onEvent(event: EngineEvent): void {
  if (event.event === 'level') {
    overlay.level(typeof event.value === 'number' ? event.value : 0)
    return
  }
  if (event.event === 'polish_request') {
    void answerRewrite(event)
    return
  }
  if (event.event === 'history' && typeof event.last === 'string' && event.last) {
    remember(event.last, typeof event.app === 'string' ? event.app : null)
    return
  }
  const change = overlayChange(event, hotkey)
  if (change === 'hide') overlay.hide()
  else if (change) overlay.show(change)
}

/**
 * The engine waits for the rewrite with the pill showing "infoga råtext" and
 * "avbryt"; a failure or no answer in time types the raw text instead.
 */
async function answerRewrite(event: EngineEvent): Promise<void> {
  const running = engine
  if (!running) return
  const request = event.request
  try {
    const text = await rewriteDictation(
      typeof event.text === 'string' ? event.text : '',
      getSettings().dictation.rewriteInstruction,
      glossaryPromptBlock(listGlossaryTerms().filter((term) => !term.projectId)),
      getSummaryConfig()
    )
    await running.connection.send('polished', { request, text })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await running.connection.send('polish_failed', { request, message }).catch(() => undefined)
  }
}

function remember(text: string, appName: string | null): void {
  try {
    const entry = addDictation(text, appName)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.dictationAdded, entry)
    }
  } catch (error) {
    console.error('Kunde inte spara diktatet i historiken', error)
  }
}

function onExit(reason: string): void {
  engine = null
  overlay.show({
    tone: 'warning',
    icon: 'alert',
    text: 'Dikteringen stannade – starta om referat',
    autoHideMs: 6000
  })
  console.error(`Dikteringsmotorn avslutades: ${reason}`)
}

/**
 * Start the engine (if it is not running) and give it these settings, with
 * the keys of Viska's config.json. Throws when no engine is installed.
 */
export async function startDictation(config: Record<string, unknown>): Promise<void> {
  if (typeof config.hotkey === 'string') hotkey = config.hotkey
  if (!engine) {
    const program = dictationEngineProgram()
    if (!program) throw new Error('Dikteringen är inte installerad')
    overlay.prepare()
    engine = await DictationEngineProcess.start(program, onEvent, onExit)
  }
  await engine.connection.send('configure', { config })
}

/** Start, reconfigure or stop the engine to match the settings. */
export async function applyDictationSettings(settings: DictationSettings): Promise<void> {
  if (settings.enabled) await startDictation(dictationEngineConfig(settings, listGlossaryTerms()))
  else await stopDictation()
}

/** Give a running engine the glossary as it is now, after a term changed. */
export async function syncDictationGlossary(): Promise<void> {
  if (!engine) return
  await engine.connection.send('configure', {
    config: dictationGlossaryConfig(listGlossaryTerms())
  })
}

/** The microphones the engine sees, for the settings page. */
export async function listDictationMicrophones(): Promise<DictationMicrophone[]> {
  if (!engine) return []
  const reply = await engine.connection.send('list_mics')
  return Array.isArray(reply.mics) ? (reply.mics as DictationMicrophone[]) : []
}

export async function stopDictation(): Promise<void> {
  const running = engine
  engine = null
  overlay.hide()
  if (running) await running.stop()
}

export function shutdownDictation(): void {
  void stopDictation().finally(() => overlay.destroy())
}
