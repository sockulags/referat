import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionTestResult } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { transcriptionDefaults, summaryDefaults } from '../presets'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea } from '../components/ui/Field'
import { Toggle } from '../components/ui/Toggle'
import { LevelMeter } from '../components/LevelMeter'
import {
  Wordmark,
  IconLaptop,
  IconServer,
  IconCloud,
  IconCheck,
  IconAlert,
  IconMic,
  IconExternal
} from '../components/icons'
import { Spinner } from '../components/ui/Spinner'
import { cn } from '../components/ui/cn'
import { ErrorDetail } from '../components/ErrorDetail'
import { MicrophoneOptions } from '../components/MicrophoneOptions'
import { failedTest } from '../connectionTest'
import { meterLevel, rmsOf } from '../audio/recorder'
import { ComponentInstallCard } from '../components/LocalAiComponents'
import { useLocalAiComponents } from '../components/useLocalAiComponents'

type Choice = 'local' | 'server' | 'cloud'
const STEPS = 5

// Guide for setting up a local AI server. http/https only — safe for openExternal.
const LOCAL_AI_DOCS_URL = 'https://github.com/sockulags/referat#lokal-ai'

function LocalAiHelpLink(): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void window.api.openExternal(LOCAL_AI_DOCS_URL)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
    >
      <IconExternal size={15} />
      {strings.onboarding.provider.localGuide}
    </button>
  )
}

export function Onboarding(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const patchSettings = useApp((s) => s.patchSettings)
  const settings = useApp((s) => s.settings)

  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState<Choice>('local')
  const [serverAddress, setServerAddress] = useState('')
  const [apiKey, setApiKey] = useState('')
  // Lifted so the advance button can read "Fortsätt ändå" when a test failed.
  const [testFailed, setTestFailed] = useState(false)

  const finish = async (): Promise<void> => {
    await window.api.saveGeneralSettings({ onboardingCompleted: true })
    patchSettings({ onboardingCompleted: true })
    navigate('home')
  }

  // Persist provider choice as concrete settings before the test step.
  const saveProvider = async (): Promise<void> => {
    // Onboarding only picks a provider; the templates stay as they are.
    const templates = settings?.summary.templates ?? []
    const defaultTemplateId = settings?.summary.defaultTemplateId ?? ''
    const transcriptionPreset =
      choice === 'local' ? 'built-in' : choice === 'server' ? 'custom' : 'openai'
    const summaryPreset = choice === 'local' ? 'local' : choice === 'server' ? 'custom' : 'openai'
    // An own server serves both steps at one address and picks its own models.
    const server = { baseUrl: serverAddress, model: '' }
    const transcription = choice === 'server' ? server : transcriptionDefaults(transcriptionPreset)
    const summary = choice === 'server' ? server : summaryDefaults(summaryPreset)
    const key = choice === 'local' ? undefined : apiKey || undefined
    await window.api.saveTranscriptionSettings({
      preset: transcriptionPreset,
      baseUrl: transcription.baseUrl,
      model: transcription.model,
      language: 'sv',
      apiKey: key
    })
    await window.api.saveSummarySettings({
      preset: summaryPreset,
      backend: 'http',
      apiFlavor: 'openai-compatible',
      baseUrl: summary.baseUrl,
      model: summary.model,
      templates,
      defaultTemplateId,
      apiKey: key
    })
  }

  const next = async (): Promise<void> => {
    if (step === 1) await saveProvider()
    if (step < STEPS - 1) setStep((s) => s + 1)
    else await finish()
  }

  return (
    <div className="min-h-full flex items-center justify-center p-5">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-accent">
            <Wordmark size={22} />
            <span className="text-lg font-semibold lowercase text-fg">{strings.app.name}</span>
          </div>
          <button
            onClick={finish}
            className="text-sm text-fg-subtle hover:text-fg-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
          >
            {strings.common.skip}
          </button>
        </div>

        <div className="bg-surface border border-border rounded-2xl shadow-float overflow-hidden">
          <div className="px-7 py-8 min-h-[420px] flex flex-col">
            <div className="flex-1">
              {step === 0 && <WelcomeStep />}
              {step === 1 && (
                <ProviderStep
                  choice={choice}
                  setChoice={setChoice}
                  serverAddress={serverAddress}
                  setServerAddress={setServerAddress}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                />
              )}
              {step === 2 && <TestStep onResult={setTestFailed} />}
              {step === 3 && <MicStep />}
              {step === 4 && <DictationStep />}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <Dots step={step} />
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                    {strings.common.back}
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={next}
                  disabled={step === 1 && choice === 'server' && !serverAddress.trim()}
                >
                  {step === 0
                    ? strings.onboarding.welcome.cta
                    : step === STEPS - 1
                      ? strings.onboarding.finish
                      : step === 2 && testFailed
                        ? strings.onboarding.test.continueAnyway
                        : strings.common.next}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Dots({ step }: { step: number }): JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${strings.onboarding.step} ${step + 1} ${strings.onboarding.of} ${STEPS}`}
    >
      {Array.from({ length: STEPS }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-200',
            i === step ? 'w-5 bg-accent' : 'w-1.5 bg-border-strong'
          )}
        />
      ))}
    </div>
  )
}

function StepHeader({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{body}</p>
    </div>
  )
}

function WelcomeStep(): JSX.Element {
  return (
    <div className="animate-fade-in text-center pt-6">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Wordmark size={34} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">
        {strings.onboarding.welcome.title}
      </h1>
      <p className="mt-3 text-[15px] text-fg-muted leading-relaxed max-w-sm mx-auto">
        {strings.onboarding.welcome.body}
      </p>
    </div>
  )
}

function ProviderStep({
  choice,
  setChoice,
  serverAddress,
  setServerAddress,
  apiKey,
  setApiKey
}: {
  choice: Choice
  setChoice: (c: Choice) => void
  serverAddress: string
  setServerAddress: (s: string) => void
  apiKey: string
  setApiKey: (s: string) => void
}): JSX.Element {
  const cards: { key: Choice; icon: JSX.Element; title: string; body: string }[] = [
    {
      key: 'local',
      icon: <IconLaptop size={22} />,
      title: strings.onboarding.provider.local.title,
      body: strings.onboarding.provider.local.body
    },
    {
      key: 'server',
      icon: <IconServer size={22} />,
      title: strings.onboarding.provider.server.title,
      body: strings.onboarding.provider.server.body
    },
    {
      key: 'cloud',
      icon: <IconCloud size={22} />,
      title: strings.onboarding.provider.cloud.title,
      body: strings.onboarding.provider.cloud.body
    }
  ]

  return (
    <div className="animate-fade-in">
      <StepHeader
        title={strings.onboarding.provider.title}
        body={strings.onboarding.provider.body}
      />
      <div className="flex flex-col gap-2.5">
        {cards.map((c) => {
          const active = choice === c.key
          return (
            <button
              key={c.key}
              onClick={() => setChoice(c.key)}
              className={cn(
                'flex items-start gap-3.5 text-left p-4 rounded-xl border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active
                  ? 'border-accent bg-accent-soft shadow-card'
                  : 'border-border-strong hover:bg-surface-2'
              )}
            >
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted'
                )}
              >
                {c.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-fg">{c.title}</span>
                <span className="block text-sm text-fg-muted mt-0.5 leading-relaxed">{c.body}</span>
              </span>
              <span
                className={cn(
                  'mt-1 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors',
                  active ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong'
                )}
              >
                {active && <IconCheck size={13} />}
              </span>
            </button>
          )
        })}
      </div>

      {choice === 'local' && (
        <div className="mt-3 animate-fade-in flex flex-col items-start gap-3">
          <OnboardingTranscriptionInstall />
          <LocalAiHelpLink />
        </div>
      )}
      {choice === 'server' && (
        <div className="mt-4 flex flex-col gap-3 animate-fade-in">
          <Input
            label={strings.onboarding.provider.serverAddress}
            value={serverAddress}
            onChange={(e) => setServerAddress(e.target.value)}
            placeholder={strings.onboarding.provider.serverAddressPlaceholder}
            hint={strings.onboarding.provider.serverAddressHint}
          />
          <Input
            label={`${strings.onboarding.provider.apiKey} (${strings.common.optional})`}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            hint={strings.onboarding.provider.apiKeyHint}
            autoComplete="off"
          />
        </div>
      )}
      {choice === 'cloud' && (
        <div className="mt-4 animate-fade-in">
          <Input
            label={strings.onboarding.provider.apiKey}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            hint={strings.onboarding.provider.apiKeyHint}
            autoComplete="off"
          />
        </div>
      )}
    </div>
  )
}

function OnboardingTranscriptionInstall(): JSX.Element {
  const manager = useLocalAiComponents()
  return (
    <div className="w-full">
      <ComponentInstallCard
        component="dictation-cpu"
        title={strings.settings.speech.cpuTitle}
        description={strings.settings.speech.cpuSize}
        detail={strings.onboarding.provider.localGpuHint}
        manager={manager}
        removable={false}
      />
    </div>
  )
}

function TestStep({ onResult }: { onResult: (failed: boolean) => void }): JSX.Element {
  const [testing, setTesting] = useState(false)
  const [done, setDone] = useState(false)
  const [tr, setTr] = useState<ConnectionTestResult | null>(null)
  const [sr, setSr] = useState<ConnectionTestResult | null>(null)

  const runTests = async (): Promise<void> => {
    setTesting(true)
    setDone(false)
    const [t, s] = await Promise.all([
      window.api.testTranscriptionConnection().catch(failedTest),
      window.api.testSummaryConnection().catch(failedTest)
    ])
    setTr(t)
    setSr(s)
    setTesting(false)
    setDone(true)
    onResult(!(t.ok && s.ok))
  }

  const allOk = done && tr?.ok && sr?.ok

  return (
    <div className="animate-fade-in">
      <StepHeader title={strings.onboarding.test.title} body={strings.onboarding.test.body} />

      {!done && !testing && (
        <Button variant="secondary" onClick={runTests}>
          {strings.onboarding.test.run}
        </Button>
      )}

      {testing && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size={18} />
          {strings.onboarding.test.testing}
        </div>
      )}

      {done && (
        <div className="flex flex-col gap-3">
          <TestRow label={strings.onboarding.test.transcription} result={tr} />
          <TestRow label={strings.onboarding.test.summary} result={sr} />
          <div
            className={cn(
              'mt-2 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium',
              allOk ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
            )}
          >
            {allOk ? <IconCheck size={18} /> : <IconAlert size={18} />}
            {allOk ? strings.onboarding.test.allGood : strings.onboarding.test.someFailed}
          </div>
          {!allOk && (
            <div className="flex flex-col items-start gap-2.5">
              <button
                onClick={runTests}
                className="text-sm text-accent hover:text-accent-hover font-medium self-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
              >
                {strings.onboarding.test.run}
              </button>
              <LocalAiHelpLink />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TestRow({
  label,
  result
}: {
  label: string
  result: ConnectionTestResult | null
}): JSX.Element {
  if (!result) return <></>
  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
          )}
        >
          {result.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
        </span>
        <div className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-fg">{label}</span>
          <span className="block text-xs text-fg-muted">{result.message}</span>
        </div>
      </div>
      {!result.ok && result.detail && <ErrorDetail detail={result.detail} className="mt-2 ml-9" />}
    </div>
  )
}

/**
 * Optional and last: someone who only records meetings just finishes. Turning
 * dictation on starts the engine right away, so it can be tried in the box
 * below — the engine types into whatever has focus, including referat.
 */
function DictationStep(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const patchSettings = useApp((s) => s.patchSettings)
  const manager = useLocalAiComponents()
  const [error, setError] = useState('')
  const d = strings.onboarding.dictation
  const enabled = settings?.dictation.enabled ?? false
  const installed = manager.statuses.some(
    (status) =>
      (status.component === 'dictation-cpu' || status.component === 'dictation-gpu') &&
      (status.state === 'installed' || status.state === 'running')
  )

  const turn = async (on: boolean): Promise<void> => {
    if (!settings) return
    const next = { ...settings.dictation, enabled: on }
    setError('')
    try {
      await window.api.saveDictationSettings(next)
      patchSettings({ dictation: next, ...(on ? { runInBackground: true } : {}) })
    } catch (e) {
      setError(e instanceof Error ? e.message : strings.settings.dictation.startFailed)
    }
  }

  return (
    <div className="animate-fade-in">
      <StepHeader title={d.title} body={d.body} />
      <div className="flex flex-col gap-4">
        <ComponentInstallCard
          component="dictation-cpu"
          title={strings.settings.speech.cpuTitle}
          description={strings.settings.speech.cpuDescription}
          detail={strings.settings.speech.cpuSize}
          manager={manager}
        />
        <Toggle
          checked={enabled}
          onChange={(on) => void turn(on)}
          disabled={!installed && !enabled}
          label={d.enable((settings?.dictation.hotkey ?? 'f9').toUpperCase())}
          description={installed ? d.enableHint : d.installFirst}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        {enabled && (
          <Textarea
            label={d.tryLabel}
            placeholder={d.tryPlaceholder((settings?.dictation.hotkey ?? 'f9').toUpperCase())}
            hint={d.tryHint}
            rows={3}
          />
        )}
      </div>
    </div>
  )
}

function MicStep(): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)

  const stop = (): void => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close()
    streamRef.current = null
    ctxRef.current = null
  }

  const startMeter = async (id: string): Promise<void> => {
    stop()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: id ? { exact: id } : undefined }
      })
      streamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      setActive(true)

      const loop = (): void => {
        analyser.getFloatTimeDomainData(buf)
        setLevel(meterLevel(rmsOf(buf)))
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()

      // Populate labels now that we have permission.
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
    } catch {
      setActive(false)
    }
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      await startMeter('')
    })()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDevice = (id: string): void => {
    setDeviceId(id)
    patchSettings({ microphoneId: id })
    void window.api.saveGeneralSettings({ microphoneId: id })
    void startMeter(id)
  }

  return (
    <div className="animate-fade-in">
      <StepHeader title={strings.onboarding.mic.title} body={strings.onboarding.mic.body} />

      <Select
        label={strings.onboarding.mic.device}
        value={deviceId}
        onChange={(e) => onDevice(e.target.value)}
      >
        <MicrophoneOptions devices={devices} />
      </Select>

      <div className="mt-5">
        <LevelMeter
          level={active ? level : 0}
          label={strings.recording.micLabel}
          icon={<IconMic size={16} />}
          tone="rec"
        />
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
        {level > 0.08 ? (
          <>
            <IconCheck size={16} className="text-success" />
            <span className="text-success font-medium">{strings.onboarding.mic.looksGood}</span>
          </>
        ) : (
          strings.onboarding.mic.speakNow
        )}
      </p>
    </div>
  )
}
