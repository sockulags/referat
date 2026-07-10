// E2E walkthrough of the referat app: onboarding -> recording -> mock pipeline
// -> protocol. Assumes `npm run build` has produced out/ and that a mock
// OpenAI-compatible server is listening on :8000 (see e2e/runner.mjs).
//
// Deterministic and CI-friendly:
//  - fresh, isolated userData under RUNNER_TEMP/os.tmpdir via the
//    REFERAT_USER_DATA test hook, so runs never share first-run state;
//  - fake mic via Chromium flags so recording works headlessly;
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

  app = await electron.launch({
    executablePath: electronExe,
    args: [mainEntry, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
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
  await page.getByLabel('Öppna inställningar').click()
  await page.waitForTimeout(1000)
  await shot('settings')
  assert(await seen('Identifiera talare'), 'settings shows the speaker section')
  await page.getByLabel('Identifiera talare').click()
  await page.waitForTimeout(300)
  await page.getByLabel('Serveradress').fill('http://localhost:8000')
  // Only Transkribering, Sammanfattning and Talare have a Spara button; Talare is last.
  await page.getByRole('button', { name: 'Spara', exact: true }).last().click()
  await page.waitForTimeout(1000)
  await shot('settings-diarization')
  await page.getByLabel('Till startsidan').first().click()
  await page.waitForTimeout(1000)
  assert(await seen('Starta inspelning'), 'back home after enabling speaker identification')

  const title = page.getByPlaceholder(/titel/i)
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
  await page.waitForTimeout(12000)
  await shot('recording-12s')
  await page.getByText('Stoppa och spara').click()
  await page.waitForTimeout(1500)

  // --- Pipeline -> protocol (transcription ~3s + summary ~2s + buffer)
  await shot('pipeline')
  const done = await seen('Protokoll', 40000)
  assert(done, 'pipeline reaches done -> protocol tab appears')
  await page.waitForTimeout(1000)
  await shot('meeting-done')

  // Protocol content from the mock server is rendered.
  const protocolHeading = await seen('Sammanfattning', 10000)
  assert(protocolHeading, 'protocol tab renders the mock protocol ("Sammanfattning" heading)')
  const decision = await seen('Introduktionsdagen flyttas till den 15:e.', 5000)
  assert(decision, 'protocol tab renders a mock decision bullet')

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
  }

  // --- Back home: list shows the Klar chip
  const back = page.getByLabel('Till startsidan')
  if (await back.count()) await back.first().click()
  else await page.getByText('referat', { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await shot('home-list')
  assert(await seen('Klar', 8000), 'meeting list shows the "Klar" status chip')

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
