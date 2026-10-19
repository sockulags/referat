// Runs the dictation engine and shows what it reports in the status pill.
//
// Started from settings once dictation can be switched on there; until then
// only when REFERAT_DICTATION_ENGINE points at a locally built engine.

import { overlayChange } from '../shared/dictationOverlay'
import { DictationEngineProcess, dictationEngineProgram, type EngineEvent } from './dictation'
import { DictationOverlay } from './dictationOverlay'

const overlay = new DictationOverlay()
let engine: DictationEngineProcess | null = null
let hotkey = 'f9'

function onEvent(event: EngineEvent): void {
  if (event.event === 'level') {
    overlay.level(typeof event.value === 'number' ? event.value : 0)
    return
  }
  const change = overlayChange(event, hotkey)
  if (change === 'hide') overlay.hide()
  else if (change) overlay.show(change)
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

export async function stopDictation(): Promise<void> {
  const running = engine
  engine = null
  overlay.hide()
  if (running) await running.stop()
}

export function shutdownDictation(): void {
  void stopDictation().finally(() => overlay.destroy())
}
