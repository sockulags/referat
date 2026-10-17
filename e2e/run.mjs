// E2E walkthrough of the referat app: onboarding -> recording -> mock pipeline
// -> protocol. Assumes `npm run build` has produced out/ and that a mock
// OpenAI-compatible server is listening on :8000 (see e2e/runner.mjs).
//
// Deterministic and CI-friendly:
//  - fresh, isolated userData under RUNNER_TEMP/os.tmpdir via the
//    REFERAT_USER_DATA test hook, so runs never share first-run state;
//  - fake mic via Chromium flags so recording works headlessly, fed with a
//    generated file of tone bursts and pauses so live windows are cut at a
//    pause the way they are with real speech;
//  - screenshots to e2e/artifacts/;
//  - collects renderer console errors;
//  - exits non-zero on any failed assertion, pipeline error, or console error.
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const ARTIFACTS = path.join(HERE, 'artifacts')
fs.rmSync(ARTIFACTS, { recursive: true, force: true })
fs.mkdirSync(ARTIFACTS, { recursive: true })

// Fresh isolated userData for a clean first run.
const tmpRoot = process.env.RUNNER_TEMP || os.tmpdir()
const userData = fs.mkdtempSync(path.join(tmpRoot, 'referat-e2e-'))

/**
 * 16-bit mono WAV of 2 s tone, 0.8 s silence, repeated. Chromium's default
 * fake mic never goes quiet, so a live window would only ever end at its
 * maximum length; real speech pauses, and this is what that looks like.
 */
function writeSpeechLikeWav(file, seconds = 60, rate = 16000) {
  const samples = seconds * rate
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    const on = t % 2.8 < 2
    const v = on ? Math.sin(2 * Math.PI * 440 * t) * 0.3 : 0
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  fs.writeFileSync(file, buf)
}
const fakeAudio = path.join(userData, 'fake-mic.wav')
writeSpeechLikeWav(fakeAudio)

const electronExe = path.join(
  REPO,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)
const mainEntry = path.join(REPO, 'out', 'main', 'index.js')

const consoleErrors = []
const failures = []
let step = 0

function assert(cond, message) {
  if (cond) {
    console.log(`PASS  ${message}`)
  } else {
    console.log(`FAIL  ${message}`)
    failures.push(message)
  }
}

let app
let page
const shot = async (name) => {
  step++
  const file = path.join(ARTIFACTS, `${String(step).padStart(2, '0')}-${name}.png`)
  try {
    await page.screenshot({ path: file })
  } catch {
    /* window may be gone during teardown */
  }
}

/** True if the given exact text is visible within the timeout. */
async function seen(text, timeout = 15000) {
  try {
    await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!fs.existsSync(mainEntry)) {
    throw new Error(`Missing build output: ${mainEntry} — run \`npm run build\` first`)
  }
  // Electron 43 dropped the postinstall hook that used to fetch this binary, so
  // a missing dist/ is now a plausible state after a plain install. Playwright
  // reports it as a bare "Process failed to launch!", which says nothing about
  // the cause — check it here and name the fix instead.
  if (!fs.existsSync(electronExe)) {
    throw new Error(
      `Missing Electron binary: ${electronExe}\n` +
        'The electron package no longer downloads it on install. Run `npm run postinstall` ' +
        '(or `npx install-electron`) before the E2E run.'
    )
  }

  app = await electron.launch({
    executablePath: electronExe,
    args: [
      mainEntry,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudio}`
    ],
    env: { ...process.env, REFERAT_USER_DATA: userData }
  })

  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  // --- Onboarding step 1: welcome
  await shot('onboarding-welcome')
  assert(await seen('Kom igång'), 'onboarding welcome screen shows "Kom igång"')
  await page.getByText('Kom igång', { exact: true }).click()
  await page.waitForTimeout(400)

  // --- Step 2: where does the AI run -> company server
  await shot('onboarding-provider')
  await page.getByText('På företagets server').click()
  await page.waitForTimeout(400)
  const addr = page.locator('input[type="text"], input[type="url"], input:not([type])').first()
  await addr.fill('http://localhost:8000/v1')
  await page.getByText('Nästa', { exact: true }).click()
  await page.waitForTimeout(400)

  // --- Step 3: connection test (mock server delays ~2-3s per endpoint)
  await shot('onboarding-test')
  await page.getByText('Testa anslutningen', { exact: true }).click()
  await page.waitForTimeout(9000)
  await shot('onboarding-test-result')
  const nasta = page.getByText('Nästa', { exact: true })
  if (await nasta.count()) await nasta.first().click()
  else await page.getByText('Fortsätt ändå').click()
  await page.waitForTimeout(400)

  // --- Step 4: mic test
  await shot('onboarding-mic')
  await page.waitForTimeout(2500)
  await shot('onboarding-mic-live')
  assert(await seen('Klar — sätt igång'), 'mic step shows finish button')
  await page.getByText('Klar — sätt igång').click()
  await page.waitForTimeout(1000)

  // --- Home: onboarding complete
  await shot('home-empty')
  assert(await seen('Starta inspelning'), 'onboarding completes -> home shows "Starta inspelning"')

  // --- Settings: enable speaker identification against the mock server
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click()
  await page.waitForTimeout(1000)
  await shot('settings')
  assert(await seen('Identifiera talare'), 'settings shows the speaker section')

  // In the background: with the setting on, closing the window hides it to
  // the tray instead of quitting, and it can be shown again.
  await page.getByLabel('Ligg kvar i systemfältet när fönstret stängs', { exact: true }).click()
  // The real watcher would react to whatever uses this machine's microphone;
  // the call banner is exercised with a simulated call further down instead.
  await page.getByLabel('Fråga när ett möte börjar', { exact: true }).click()
  await page.waitForTimeout(500)
  const closed = await app.evaluate(
    ({ BrowserWindow }) =>
      new Promise((resolve) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.close()
        setTimeout(
          () =>
            resolve({ windows: BrowserWindow.getAllWindows().length, visible: win.isVisible() }),
          500
        )
      })
  )
  assert(
    closed.windows === 1 && closed.visible === false,
    `closing the window keeps referat running in the tray (got ${JSON.stringify(closed)})`
  )
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
  await page.waitForTimeout(500)

  const transcriptionCard = page
    .getByRole('heading', { name: 'Transkribering', exact: true })
    .locator('../..')
  await transcriptionCard.getByLabel('Förval').selectOption('built-in')
  assert(
    await seen('Lokal CPU-transkribering'),
    'built-in transcription preset shows the managed installer'
  )
  await transcriptionCard.getByLabel('Förval').selectOption('custom')

  // Codex summary backend: selecting it hides HTTP/key fields, explains the
  // existing-login behavior, and persists the backend discriminator.
  const summaryCard = page
    .getByRole('heading', { name: 'Sammanfattning', exact: true })
    .locator('../..')
  await summaryCard.getByLabel('Förval').selectOption('codex')
  await page.waitForTimeout(300)
  assert(
    await seen('Använder din befintliga Codex-inloggning'),
    'Codex preset explains that it reuses the existing login'
  )
  assert(
    (await summaryCard.getByLabel('API-nyckel').count()) === 0,
    'Codex preset does not ask for an API key'
  )
  await summaryCard.getByRole('button', { name: 'Spara', exact: true }).click()
  const savedCodexSettings = await page.evaluate(() => window.api.getSettings())
  assert(
    savedCodexSettings.summary.backend === 'codex-cli',
    'Codex preset persists the codex-cli backend'
  )
  await shot('settings-codex')

  // Restore the mock HTTP summary provider used by the rest of this walkthrough.
  await summaryCard.getByLabel('Förval').selectOption('custom')
  await summaryCard.getByLabel('Bas-URL').fill('http://localhost:8000/v1')
  await summaryCard.getByRole('button', { name: 'Spara', exact: true }).click()

  await page.getByLabel('Identifiera talare').click()
  await page.waitForTimeout(300)
  // Voice recognition across meetings (renaming a speaker saves a profile).
  assert(await seen('Känn igen talare mellan möten'), 'settings shows the voice recognition toggle')
  await page.getByLabel('Känn igen talare mellan möten').click()
  await page.waitForTimeout(300)
  await page.getByLabel('Kör talaridentifiering').selectOption('server')
  await page.getByLabel('Serveradress').fill('http://localhost:8000')
  // Only Transkribering, Sammanfattning and Talare have a Spara button; Talare is last.
  await page.getByRole('button', { name: 'Spara', exact: true }).last().click()
  await page.waitForTimeout(1000)
  await shot('settings-diarization')
  await page.getByRole('button', { name: 'Hem', exact: true }).click()
  await page.waitForTimeout(1000)
  assert(await seen('Starta inspelning'), 'back home after enabling speaker identification')

  const title = page.getByPlaceholder(/titel/i)
  // The template picker decides what the automatic summary becomes.
  const templatePicker = page.getByLabel('Sammanfattning', { exact: true })
  assert((await templatePicker.count()) > 0, 'home shows the summary template picker')
  const templateNames = await templatePicker.locator('option').allTextContents()
  assert(
    templateNames.includes('Protokoll') && templateNames.includes('Uppföljningsmejl'),
    `template picker lists the built-in templates (got ${JSON.stringify(templateNames)})`
  )

  if (await title.count()) await title.fill('Veckomöte HR')
  await page.getByText('Starta inspelning', { exact: true }).first().click()
  await page.waitForTimeout(3000)

  // --- Recording: timer + stop control visible
  await shot('recording')
  const stopVisible = await seen('Stoppa och spara')
  assert(stopVisible, 'recording view shows the "Stoppa och spara" control')
  const timerText = await page
    .locator('.tabular-nums')
    .first()
    .textContent()
    .catch(() => '')
  assert(/\d{1,2}:\d{2}/.test(timerText || ''), `recording view shows a timer (got "${timerText}")`)
  // The mock transcriber runs on localhost, so live text is on by default.
  assert(await seen('Live-text', 2000), 'recording view shows the live text panel')
  await page.waitForTimeout(12000)
  // The fake mic's tone gives the first window after ~10s, then the mock
  // answers in ~3s; allow some slack on slow runners.
  const liveText = await page
    .getByTestId('live-transcript')
    .getByText(/rekryteringar/)
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  await shot('recording-12s')
  assert(liveText, 'live text from the transcriber appears while still recording')
  await page.getByText('Stoppa och spara').click()
  await page.waitForTimeout(1500)

  // --- Pipeline -> protocol (transcription ~3s + summary ~2s + buffer)
  await shot('pipeline')
  const done = await seen('Protokoll', 40000)
  assert(done, 'pipeline reaches done -> protocol tab appears')
  await page.waitForTimeout(1000)
  await shot('meeting-done')
  const actionItem = page.getByLabel('Actionpunkt', { exact: true }).first()
  const extracted = await actionItem
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(async () => (await actionItem.inputValue()) === 'Ta fram en ny annonsmall')
    .catch(() => false)
  assert(extracted, 'the pipeline takes the action items out and the meeting view lists them')
  await actionItem.scrollIntoViewIfNeeded()
  await shot('action-items')

  // Editing: the change saves on its own and is still there after leaving
  // the meeting and coming back.
  await actionItem.fill('Ta fram en ny annonsmall och skicka den till HR')
  await page.getByLabel('Ansvarig', { exact: true }).first().fill('Anna Berg')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Hem', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Senaste mötet', exact: true }).click()
  await page.waitForTimeout(1000)
  assert(
    (await page.getByLabel('Actionpunkt', { exact: true }).first().inputValue()) ===
      'Ta fram en ny annonsmall och skicka den till HR',
    'an edited action item is saved and still there after leaving the meeting'
  )
  assert(
    (await page.getByLabel('Ansvarig', { exact: true }).first().inputValue()) === 'Anna Berg',
    'an edited owner is saved'
  )
  await page.getByRole('button', { name: 'Kopiera som lista', exact: true }).click()
  await page.waitForTimeout(800)
  const copiedList = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert(
    copiedList === '- Ta fram en ny annonsmall och skicka den till HR — Anna Berg',
    `the action items copy as a list (got ${JSON.stringify(copiedList)})`
  )
  // The protocol itself carries the corrected list, not a version of its own.
  await page.getByRole('button', { name: 'Kopiera', exact: true }).click()
  await page.waitForTimeout(800)
  const copiedProtocol = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert(
    copiedProtocol.includes(
      '## Actionpunkter\n\n- Ta fram en ny annonsmall och skicka den till HR — Anna Berg'
    ),
    'the copied protocol carries the corrected action items'
  )

  // The recorder writes a level envelope alongside the audio, which is what
  // lets main tell the microphone apart from the system audio. The fake mic
  // here produces no system audio, so only the plumbing is checked.
  const meetingDirs = fs
    .readdirSync(path.join(userData, 'meetings'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  const levelsPath = path.join(userData, 'meetings', meetingDirs[0], 'levels.json')
  const hasLevels = fs.existsSync(levelsPath)
  assert(hasLevels, 'the recorder saves a level envelope for the meeting')
  if (hasLevels) {
    const envelope = JSON.parse(fs.readFileSync(levelsPath, 'utf8'))
    const covered = envelope.mic.length / envelope.rate
    assert(
      covered > 10 && covered < 30,
      `the envelope covers the recorded audio (${covered.toFixed(1)}s of a ~15s recording)`
    )
  }

  // Protocol content from the mock server is rendered.
  const protocolHeading = await seen('Sammanfattning', 10000)
  assert(protocolHeading, 'protocol tab renders the mock protocol ("Sammanfattning" heading)')
  const decision = await seen('Introduktionsdagen flyttas till den 15:e.', 5000)
  assert(decision, 'protocol tab renders a mock decision bullet')

  // --- A second summary of the same meeting: another template, and a focus
  // that narrows it to one part of the meeting.
  await page.getByText('Ny sammanfattning', { exact: true }).first().click()
  await page.waitForTimeout(500)
  await shot('new-summary-modal')
  assert(
    await seen('Skapa sammanfattning', 3000),
    'the protocol tab offers to generate another summary'
  )
  await page.getByLabel('Mall', { exact: true }).selectOption({ label: 'Uppföljningsmejl' })
  await page.getByLabel('Fokus (valfritt)').fill('bara rekryteringen')
  await page.getByText('Skapa sammanfattning', { exact: true }).click()
  await page.waitForTimeout(1000)

  // The picker only appears once there are two summaries, so a second chip is
  // the signal that the new one landed.
  const secondSummary = await page
    .locator('button[aria-pressed]')
    .nth(1)
    .waitFor({ state: 'visible', timeout: 40000 })
    .then(() => true)
    .catch(() => false)
  assert(secondSummary, 'the second summary appears in the protocol tab')
  assert(
    await seen('Fokus: bara rekryteringen', 5000),
    'the second summary shows what it was asked to focus on'
  )
  // Not clicked: it would open the machine's real mail program.
  assert(
    (await page.getByRole('button', { name: 'Öppna som mejlutkast', exact: true }).count()) === 1,
    'a follow-up email summary offers to open as a mail draft'
  )
  const chips = await page.locator('button[aria-pressed]').allTextContents()
  assert(
    chips.some((c) => c.includes('Protokoll')) && chips.some((c) => c.includes('Uppföljningsmejl')),
    `both summaries are listed side by side (chips: ${JSON.stringify(chips)})`
  )
  await shot('two-summaries')

  // --- Removing a summary leaves the other one alone.
  await page.getByText('Ta bort', { exact: true }).first().click()
  await page.waitForTimeout(400)
  assert(await seen('Ta bort sammanfattningen?', 3000), 'deleting a summary asks for confirmation')
  await shot('delete-summary-modal')
  await page.getByRole('dialog').getByRole('button', { name: 'Ta bort', exact: true }).click()
  await page.waitForTimeout(1200)

  const remaining = await page.locator('button[aria-pressed]').count()
  assert(remaining === 0, `the picker collapses back to a single summary (chips: ${remaining})`)
  assert(
    await seen('Introduktionsdagen flyttas till den 15:e.', 5000),
    'the summary that was kept is still rendered'
  )
  await shot('after-delete')

  // Transcript tab renders the mock transcript.
  const transkript = page.getByText('Transkript', { exact: true })
  if (await transkript.count()) {
    await transkript.first().click()
    await page.waitForTimeout(600)
    await shot('transcript-tab')
    assert(
      await seen('Anna tar fram en ny annonsmall till fredag.', 5000),
      'transcript tab renders mock transcript segments'
    )

    // Playback: the recording loads through the media protocol, and a
    // transcript timestamp moves the player to that point.
    const audioLoads = await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const audio = new Audio(`referat-media://meeting/${id}/0`)
          audio.onloadedmetadata = () => resolve(true)
          audio.onerror = () => resolve(false)
          setTimeout(() => resolve(false), 8000)
        }),
      meetingDirs[0]
    )
    assert(audioLoads, 'the recording loads through the referat-media protocol')
    await page.getByRole('button', { name: 'Spela från 00:06' }).first().click()
    assert(await seen('00:06 / 00:15', 5000), 'a transcript timestamp moves the player there')
    await shot('audio-player')
    await page
      .getByRole('button', { name: 'Pausa' })
      .click()
      .catch(() => {})

    // Search: a hit opens the meeting's transcript at that moment.
    await page.getByRole('button', { name: 'Sök i möten', exact: true }).click()
    await page.getByLabel('Sök efter', { exact: true }).fill('introduktionsdagen femtonde')
    const searchHit = page.getByRole('button', { name: /00:12/ }).first()
    const found = await searchHit
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    assert(found, 'search finds the transcript line with every word of the query')
    await shot('search')
    if (found) await searchHit.click()
    assert(await seen('00:12 / 00:15', 8000), 'a search hit opens the meeting at that moment')

    // Speaker labels from diarization (mock server: S1/S2 -> Talare 1/Talare 2).
    assert(await seen('Talare 1', 8000), 'transcript tab shows speaker label "Talare 1"')
    assert(await seen('Talare 2', 5000), 'transcript tab shows speaker label "Talare 2"')
    await shot('transcript-speakers')

    // Rename flow: click a "Talare 1" label, type a name, Enter -> renamed everywhere.
    await page.getByText('Talare 1', { exact: true }).first().click()
    await page.waitForTimeout(400)
    const speakerInput = page.getByPlaceholder('Namn, t.ex. Anna')
    await speakerInput.fill('Anna')
    await speakerInput.press('Enter')
    await page.waitForTimeout(1500)
    assert(await seen('Anna', 5000), 'renamed speaker label "Anna" is visible')
    assert(
      (await page.getByText('Talare 1', { exact: true }).count()) === 0,
      'old label "Talare 1" is gone after the rename'
    )
    await shot('transcript-renamed')

    // Glossary: select a misheard word in the transcript, give it the correct
    // spelling, and the transcript is rewritten in place.
    const selected = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('p')).find((el) =>
        el.textContent?.includes('annonsmall')
      )
      const node = p?.firstChild
      if (!node || !node.textContent) return false
      const start = node.textContent.indexOf('annonsmall')
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + 'annonsmall'.length)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      // The transcript view acts on pointerup, once a selection is finished.
      document.dispatchEvent(new Event('pointerup', { bubbles: true }))
      return true
    })
    assert(selected, 'a word in the transcript can be selected')
    await page.waitForTimeout(400)
    assert(
      await seen('Lägg till i ordlistan', 3000),
      'selecting transcript text offers "add to glossary"'
    )
    await page.getByText('Lägg till i ordlistan', { exact: true }).first().click()
    await page.waitForTimeout(400)
    await shot('glossary-modal')

    const heardField = page.getByLabel('Hördes som')
    assert(
      (await heardField.inputValue()) === 'annonsmall',
      'the dialog is prefilled with the selected word'
    )
    await page.getByLabel('Ska vara').fill('Annonsmall CMS')
    await page.getByText('Spara i ordlistan', { exact: true }).click()
    await page.waitForTimeout(1200)

    assert(await seen('Annonsmall CMS', 5000), 'the transcript is corrected from the glossary')
    assert(
      await seen('Transkriptet är rättat från ordlistan. Skapa protokollet igen.', 5000),
      'the glossary change offers to rebuild the protocol'
    )
    await shot('transcript-glossary')
  }

  // --- Back home: list shows the Klar chip
  const back = page.getByRole('button', { name: 'Hem', exact: true })
  if (await back.count()) await back.first().click()
  else await page.getByText('referat', { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await shot('home-list')
  assert(await seen('Klar', 8000), 'meeting list shows the "Klar" status chip')

  // A call in a meeting app: Home offers to record it, and "Inte nu" lets go.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('calls:detected', {
      app: 'teams',
      active: true
    })
  )
  assert(await seen('Ett Teams-möte pågår', 5000), 'Home offers to record a call in Teams')
  await shot('call-banner')
  await page.getByRole('button', { name: 'Inte nu', exact: true }).click()
  await page.waitForTimeout(300)
  assert(
    (await page.getByText('Ett Teams-möte pågår', { exact: true }).count()) === 0,
    'the call offer can be turned down'
  )

  // --- Projects: create one with its own default template, move the first
  // meeting into it, and record the second meeting there.
  await page.getByRole('button', { name: 'Nytt projekt' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('Namn', { exact: true }).fill('Styrgrupp')
  await page.getByRole('button', { name: 'Skapa projekt' }).click()
  await page.waitForTimeout(800)
  assert(await seen('Spelas in i Styrgrupp', 3000), 'a new project is selected and recorded into')
  assert(
    await seen(
      'Inga möten i projektet ännu. Det du spelar in här hamnar i projektet, och tidigare möten kan du flytta hit från Alla möten.',
      3000
    ),
    'a new project starts empty'
  )

  await page.getByRole('button', { name: 'Projektinställningar' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('Standardmall').selectOption('beslutslogg')
  await page
    .getByLabel('Bakgrund till sammanfattningen')
    .fill('Styrgrupp för rekryteringen. Anna är HR-ansvarig.')
  await shot('project-settings')
  await page.getByRole('button', { name: 'Spara', exact: true }).click()
  await page.waitForTimeout(800)
  const startTemplate = await page.getByLabel('Sammanfattning', { exact: true }).inputValue()
  assert(
    startTemplate === 'beslutslogg',
    `the project's default template is preselected (got "${startTemplate}")`
  )

  await page.getByRole('button', { name: 'Alla möten' }).click()
  await page.waitForTimeout(400)
  const allTemplate = await page.getByLabel('Sammanfattning', { exact: true }).inputValue()
  assert(
    allTemplate !== 'beslutslogg',
    `outside the project the project default does not apply (got "${allTemplate}")`
  )
  await page.getByRole('button', { name: 'Flytta till projekt' }).first().click()
  await page.waitForTimeout(300)
  await page
    .getByRole('dialog')
    .getByLabel('Projekt', { exact: true })
    .selectOption({ label: 'Styrgrupp' })
  await page.getByRole('button', { name: 'Flytta', exact: true }).click()
  await page.waitForTimeout(800)
  await shot('home-projects')
  assert(
    (await page
      .locator('li')
      .filter({ hasText: 'Veckomöte HR' })
      .filter({ hasText: 'Styrgrupp' })
      .count()) > 0,
    'the moved meeting shows its project in the full list'
  )
  await page.getByRole('button', { name: 'Utan projekt' }).click()
  await page.waitForTimeout(400)
  assert(
    await seen('Alla möten ligger i ett projekt.', 3000),
    'no meetings are left outside a project'
  )
  await page.getByRole('button', { name: 'Styrgrupp', exact: true }).click()
  await page.waitForTimeout(400)
  assert(await seen('Veckomöte HR', 3000), 'the project lists the moved meeting')

  // --- Second meeting: the voice enrolled as "Anna" is recognized again
  const title2 = page.getByPlaceholder(/titel/i)
  if (await title2.count()) await title2.fill('Uppföljning HR')
  await page.getByText('Starta inspelning', { exact: true }).first().click()
  await page.waitForTimeout(3000)
  await page.waitForTimeout(12000)
  await page.getByText('Stoppa och spara').click()
  await page.waitForTimeout(1500)
  assert(await seen('Protokoll', 40000), 'second meeting pipeline reaches done')
  {
    const prompt = await fetch('http://localhost:8000/__last-prompt').then((r) => r.text())
    assert(
      prompt.includes('Bakgrund om projektet "Styrgrupp"') &&
        prompt.includes('Anna är HR-ansvarig.'),
      "the project's background reaches the summary prompt"
    )
    const metas = fs
      .readdirSync(path.join(userData, 'meetings'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) =>
        JSON.parse(fs.readFileSync(path.join(userData, 'meetings', e.name, 'meta.json'), 'utf8'))
      )
    const second = metas.find((m) => m.title === 'Uppföljning HR')
    const projectsFile = JSON.parse(fs.readFileSync(path.join(userData, 'projects.json'), 'utf8'))
    assert(
      second?.projectId === projectsFile[0]?.id && second?.templateId === 'beslutslogg',
      `a meeting recorded in a project is filed there with its default template (got ${JSON.stringify({ projectId: second?.projectId, templateId: second?.templateId })})`
    )
  }
  await page.waitForTimeout(1000)

  await page.getByText('Transkript', { exact: true }).first().click()
  await page.waitForTimeout(600)
  assert(await seen('Anna?', 8000), 'second meeting transcript shows the "Anna?" voice suggestion')
  await shot('transcript-suggestion')

  // Confirm the suggestion: click the label, keep the prefilled name, Enter.
  await page.getByText('Anna?', { exact: true }).first().click()
  await page.waitForTimeout(400)
  const suggestionInput = page.getByPlaceholder('Namn, t.ex. Anna')
  assert(
    (await suggestionInput.inputValue()) === 'Anna',
    'rename input is prefilled with the suggested name "Anna"'
  )
  await suggestionInput.press('Enter')
  await page.waitForTimeout(1500)
  assert(await seen('Anna', 5000), 'confirmed speaker label "Anna" is visible')
  assert(
    (await page.getByText('Anna?', { exact: true }).count()) === 0,
    'suggestion label "Anna?" is gone after confirming'
  )
  await shot('transcript-suggestion-confirmed')

  // --- Project glossary: in a project's meeting a new term defaults to that
  // project only.
  {
    const word = 'introduktionsdagen'
    const picked = await page.evaluate((w) => {
      const p = Array.from(document.querySelectorAll('p')).find((el) => el.textContent?.includes(w))
      const node = p?.firstChild
      if (!node || !node.textContent) return false
      const start = node.textContent.indexOf(w)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + w.length)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('pointerup', { bubbles: true }))
      return true
    }, word)
    assert(picked, 'a word in the project meeting transcript can be selected')
    await page.waitForTimeout(400)
    await page.getByText('Lägg till i ordlistan', { exact: true }).first().click()
    await page.waitForTimeout(400)
    const scope = page.getByRole('dialog').getByLabel('Gäller för')
    assert(
      (await scope.locator('option:checked').textContent()) === 'Bara projektet Styrgrupp',
      'in a project meeting a new glossary term defaults to the project'
    )
    await page.getByLabel('Ska vara').fill('Introdagen')
    await shot('glossary-modal-project')
    await page.getByText('Spara i ordlistan', { exact: true }).click()
    await page.waitForTimeout(1200)
    assert(await seen('Introdagen', 5000), 'the project term corrects the project meeting')
  }

  // --- Settings: the saved voice is listed under "Sparade röster"
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click()
  await page.waitForTimeout(1000)
  assert(await seen('Sparade röster', 8000), 'settings shows the saved voices list')
  assert(await seen('Anna', 5000), 'saved voice "Anna" is listed under "Sparade röster"')
  await shot('settings-voices')

  // --- Settings: the glossary term added from the transcript is listed
  assert(await seen('Ordlista', 8000), 'settings shows the glossary section')
  assert(
    await seen('Annonsmall CMS', 5000),
    'the term added from the transcript is listed in the glossary'
  )
  assert(await seen('1 variant', 5000), 'the glossary term shows its variant count')
  // Open the term so the artifact shows the editor, not just the collapsed row.
  await page.getByText('Annonsmall CMS', { exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.getByText('Ordlista', { exact: true }).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  assert(await seen('Hördes som', 3000), 'the glossary term opens into an editor')
  await shot('settings-glossary')
  const projectTermRow = page.getByRole('button', { name: /^Introdagen/ })
  assert(
    ((await projectTermRow.textContent()) ?? '').includes('Styrgrupp'),
    'the project term is marked with its project in the glossary list'
  )

  // --- Project overview: one summary across the project's two meetings
  {
    const home = page.getByRole('button', { name: 'Hem', exact: true })
    if (await home.count()) await home.first().click()
    else await page.getByText('referat', { exact: true }).first().click()
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: 'Styrgrupp', exact: true }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Projektöversikt' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Skapa översikt' }).click()
    const overview = await page
      .getByTestId('project-overview')
      .getByText('Sammanfattning')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    await shot('project-overview')
    assert(overview, 'a project overview is generated and shown')
    assert(
      (await page.getByText(/bygger på 2 möten/).count()) > 0,
      'the overview says how many meetings it read'
    )
    const prompt = await fetch('http://localhost:8000/__last-prompt').then((r) => r.text())
    assert(
      prompt.includes('### Veckomöte HR') && prompt.includes('### Uppföljning HR'),
      "the overview is built from both of the project's meeting summaries"
    )
  }

  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2))
  assert(consoleErrors.length === 0, 'no renderer console errors during the run')
}

let exitCode = 0
try {
  await main()
} catch (err) {
  console.error('E2E ERROR:', err?.stack || String(err))
  failures.push(`unhandled error: ${err?.message || err}`)
  if (page) await shot('error')
} finally {
  if (app) {
    try {
      await app.close()
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

if (failures.length > 0) {
  console.log(`\nE2E FAILED — ${failures.length} problem(s):`)
  for (const f of failures) console.log(`  - ${f}`)
  exitCode = 1
} else {
  console.log('\nE2E PASSED')
}
console.log('E2E_DONE')
process.exit(exitCode)
