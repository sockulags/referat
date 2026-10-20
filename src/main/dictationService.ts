// Runs the dictation engine and shows what it reports in the status pill.
//
// Started when dictation is switched on in settings, and at launch when it
// was left on. REFERAT_DICTATION_ENGINE points at a locally built engine for
// development.

import { BrowserWindow, Notification } from 'electron'
import { isLocalAiComponentInstalled } from './localAiComponents'
import { overlayChange, type OverlayAction } from '../shared/dictationOverlay'
import type { DictationMicrophone, DictationSettings } from '../shared/types'
import { avoidedHeadset, dictationEngineConfig, dictationGlossaryConfig } from './dictationConfig'
import { glossaryPromptBlock, listGlossaryTerms } from './glossary'
import {
  getSettings,
  getSummaryConfig,
  headsetNoticesShown,
  markHeadsetNoticeShown
} from './settings'
import { rewriteDictation } from './providers/dictationRewrite'
import { DictationEngineProcess, dictationEngineProgram, type EngineEvent } from './dictation'
import { DictationOverlay } from './dictationOverlay'
import { addDictation } from './dictationHistory'
import { IPC } from './ipc'
import { applyPendingLocalAiComponentUpdate } from './localAiComponents'

const overlay = new DictationOverlay(onOverlayAction)
let engine: DictationEngineProcess | null = null
/** The engine's transcription server for meetings, once it has been started. */
let transcriptionUrl: string | null = null
let hotkey = 'f9'
/**
 * Dictation is on. The engine also runs with dictation off, for meetings; it
 * then has no key, and the pill shows nothing of what it reports.
 */
let dictationOn = false
/** A dictation is under way: from the key press until the engine is idle again. */
let dictating = false
/** Opens referat on the dictation settings; set by the app at launch. */
let openDictationSettings: () => void = () => undefined

export function onOpenDictationSettings(open: () => void): void {
  openDictationSettings = open
}

/** "Infoga råtext" or "Avbryt" on the pill, during a rewrite. */
function onOverlayAction(action: OverlayAction): void {
  engine?.connection.send(action).catch((error) => {
    console.error(`Dikteringsmotorn tog inte emot ${action}`, error)
  })
}

/**
 * The first time dictation leaves a Bluetooth headset alone, say why, once
 * per headset: the computer's microphone keeps the headset out of call mode,
 * so its sound stays at full quality.
 */
function noticeAvoidedHeadset(event: EngineEvent): void {
  const headset = avoidedHeadset(event, headsetNoticesShown())
  if (!headset) return
  markHeadsetNoticeShown(headset)
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'Dikteringen använder datorns mikrofon',
    body: `Så behåller ${headset} full ljudkvalitet. Klicka för att välja mikrofon själv.`
  })
  notification.on('click', () => openDictationSettings())
  notification.show()
}

function onEvent(event: EngineEvent): void {
  if (event.event === 'listening') dictating = true
  else if (event.event === 'idle') dictating = false
  if (event.event === 'level') {
    overlay.level(typeof event.value === 'number' ? event.value : 0)
    return
  }
  if (event.event === 'polish_request') {
    void answerRewrite(event)
    return
  }
  if (!dictationOn) return
  if (event.event === 'mic') {
    noticeAvoidedHeadset(event)
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
  dictating = false
  transcriptionUrl = null
  if (dictationOn) {
    overlay.show({
      tone: 'warning',
      icon: 'alert',
      text: 'Dikteringen stannade – starta om referat',
      autoHideMs: 6000
    })
  }
  console.error(`Dikteringsmotorn avslutades: ${reason}`)
}

/**
 * Start the engine (if it is not running) and give it these settings, with
 * the keys of Viska's config.json. Throws when no engine is installed.
 */
export async function startDictation(config: Record<string, unknown>): Promise<void> {
  if (typeof config.hotkey === 'string' && config.hotkey) hotkey = config.hotkey
  dictationOn = typeof config.hotkey === 'string' && config.hotkey !== ''
  if (!engine) {
    for (const component of ['dictation-gpu', 'dictation-cpu'] as const) {
      await applyPendingLocalAiComponentUpdate(component).catch((error) =>
        console.error('Dikteringens uppdatering kunde inte läggas på plats', error)
      )
    }
    const program = dictationEngineProgram()
    if (!program) throw new Error('Dikteringen är inte installerad')
    if (dictationOn) overlay.prepare()
    engine = await DictationEngineProcess.start(program, onEvent, onExit)
  }
  await engine.connection.send('configure', { config })
}

function engineConfig(settings: DictationSettings): Record<string, unknown> {
  return dictationEngineConfig(settings, listGlossaryTerms(), getSettings().speechModel)
}

/**
 * Start or reconfigure the engine to match the settings. Turning dictation
 * off takes the key away but keeps a running engine: meetings may be using
 * its model.
 */
export async function applyDictationSettings(settings: DictationSettings): Promise<void> {
  if (settings.enabled || engine) await startDictation(engineConfig(settings))
  if (!settings.enabled) overlay.hide()
}

/** Whether speech recognition on the computer (the engine) is installed. */
export function isSpeechInstalled(): boolean {
  return (
    isLocalAiComponentInstalled('dictation-gpu') || isLocalAiComponentInstalled('dictation-cpu')
  )
}

/**
 * The engine's transcription server for a meeting, starting the engine (with
 * no key, if dictation is off) when it is not running. Null when speech
 * recognition is not installed, so meetings fall back to an older component.
 */
export async function speechTranscriptionUrl(): Promise<string | null> {
  if (!isSpeechInstalled() && !process.env.REFERAT_DICTATION_ENGINE) return null
  if (!engine) await startDictation(engineConfig(getSettings().dictation))
  return dictationTranscriptionUrl()
}

/** A new model choice: a running engine loads it at once. */
export async function applySpeechModel(): Promise<void> {
  if (!engine) return
  await engine.connection.send('configure', {
    config: {
      model: dictationEngineConfig(getSettings().dictation, [], getSettings().speechModel).model
    }
  })
}

/** Give a running engine the glossary as it is now, after a term changed. */
export async function syncDictationGlossary(): Promise<void> {
  if (!engine) return
  await engine.connection.send('configure', {
    config: dictationGlossaryConfig(listGlossaryTerms())
  })
}

/** The microphone the engine would pick now, or null without a running engine. */
export async function dictationMicrophone(): Promise<string | null> {
  if (!engine) return null
  try {
    const reply = await engine.connection.send('current_mic')
    return typeof reply.name === 'string' && reply.name ? reply.name : null
  } catch {
    return null // an engine too old to answer: the meeting keeps the default
  }
}

/** The microphones the engine sees, for the settings page. */
export async function listDictationMicrophones(): Promise<DictationMicrophone[]> {
  if (!engine) return []
  const reply = await engine.connection.send('list_mics')
  return Array.isArray(reply.mics) ? (reply.mics as DictationMicrophone[]) : []
}

/**
 * The engine's OpenAI-compatible transcription server, started on first use,
 * so meetings use the model dictation already has loaded. Null when the
 * engine is not running, or is too old to offer one.
 */
export async function dictationTranscriptionUrl(): Promise<string | null> {
  if (!engine) return null
  if (transcriptionUrl) return transcriptionUrl
  try {
    const reply = await engine.connection.send('serve_transcription')
    transcriptionUrl = typeof reply.url === 'string' ? reply.url : null
  } catch (error) {
    console.error('Dikteringsmotorn kunde inte ta emot mötesljud', error)
    return null
  }
  return transcriptionUrl
}

/** The engine runs, and holds its program's files. */
export function isDictationRunning(): boolean {
  return engine !== null
}

/**
 * Restart the engine on its updated build, once no dictation is under way.
 * Without a running engine the update waits for the next start.
 */
export async function restartDictationAfterUpdate(): Promise<void> {
  while (engine && dictating) await new Promise((resolve) => setTimeout(resolve, 1_000))
  if (!engine) return
  await stopDictation()
  await applyDictationSettings(getSettings().dictation)
}

export async function stopDictation(): Promise<void> {
  const running = engine
  engine = null
  dictationOn = false
  transcriptionUrl = null
  overlay.hide()
  if (running) await running.stop()
}

export function shutdownDictation(): void {
  void stopDictation().finally(() => overlay.destroy())
}
