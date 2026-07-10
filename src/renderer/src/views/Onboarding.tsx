import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionTestResult } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { transcriptionDefaults, summaryDefaults } from '../presets'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { LevelMeter } from '../components/LevelMeter'
import {
  Wordmark,
  IconLaptop,
  IconServer,
  IconCloud,
  IconCheck,
  IconAlert,
  IconMic
} from '../components/icons'
import { Spinner } from '../components/ui/Spinner'
import { cn } from '../components/ui/cn'

type Choice = 'local' | 'server' | 'cloud'
const STEPS = 4

export function Onboarding(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const patchSettings = useApp((s) => s.patchSettings)
  const settings = useApp((s) => s.settings)

  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState<Choice>('local')
  const [serverAddress, setServerAddress] = useState('')
  const [apiKey, setApiKey] = useState('')

  const finish = async (): Promise<void> => {
    await window.api.saveGeneralSettings({ onboardingCompleted: true })
    patchSettings({ onboardingCompleted: true })
    navigate('home')
  }

  // Persist provider choice as concrete settings before the test step.
  const saveProvider = async (): Promise<void> => {
    const template = settings?.summary.promptTemplate ?? ''
    if (choice === 'local') {
      const dt = transcriptionDefaults('local')
      const ds = summaryDefaults('local')
      await window.api.saveTranscriptionSettings({
        preset: 'local',
        baseUrl: dt.baseUrl,
        model: dt.model,
        language: 'sv'
      })
      await window.api.saveSummarySettings({
        preset: 'local',
        apiFlavor: 'openai-compatible',
        baseUrl: ds.baseUrl,
        model: ds.model,
        promptTemplate: template
      })
    } else if (choice === 'server') {
      await window.api.saveTranscriptionSettings({
        preset: 'custom',
        baseUrl: serverAddress,
        model: '',
        language: 'sv',
        apiKey: apiKey || undefined
      })
      await window.api.saveSummarySettings({
        preset: 'custom',
        apiFlavor: 'openai-compatible',
        baseUrl: serverAddress,
        model: '',
        promptTemplate: template,
        apiKey: apiKey || undefined
      })
    } else {
      const dt = transcriptionDefaults('openai')
      const ds = summaryDefaults('openai')
      await window.api.saveTranscriptionSettings({
        preset: 'openai',
        baseUrl: dt.baseUrl,
        model: dt.model,
        language: 'sv',
        apiKey: apiKey || undefined
      })
      await window.api.saveSummarySettings({
        preset: 'openai',
        apiFlavor: 'openai-compatible',
        baseUrl: ds.baseUrl,
        model: ds.model,
        promptTemplate: template,
        apiKey: apiKey || undefined
      })
    }
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
              {step === 2 && <TestStep />}
              {step === 3 && <MicStep />}
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
                      ? strings.onboarding.mic.finish
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

      {choice === 'server' && (
        <div className="mt-4 flex flex-col gap-3 animate-fade-in">
          <Input
            label={strings.onboarding.provider.serverAddress}
            value={serverAddress}
            onChange={(e) => setServerAddress(e.target.value)}
            placeholder="https://ai.företaget.se/v1"
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

function TestStep(): JSX.Element {
  const [testing, setTesting] = useState(false)
  const [done, setDone] = useState(false)
  const [tr, setTr] = useState<ConnectionTestResult | null>(null)
  const [sr, setSr] = useState<ConnectionTestResult | null>(null)

  const runTests = async (): Promise<void> => {
    setTesting(true)
    setDone(false)
    const [t, s] = await Promise.all([
      window.api.testTranscriptionConnection().catch((e) => ({
        ok: false,
        message: strings.errors.genericTitle,
        detail: String(e)
      })),
      window.api.testSummaryConnection().catch((e) => ({
        ok: false,
        message: strings.errors.genericTitle,
        detail: String(e)
      }))
    ])
    setTr(t)
    setSr(s)
    setTesting(false)
    setDone(true)
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
            <button
              onClick={runTests}
              className="text-sm text-accent hover:text-accent-hover font-medium self-start"
            >
              {strings.onboarding.test.run}
            </button>
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
  const [showDetail, setShowDetail] = useState(false)
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
      {!result.ok && result.detail && (
        <>
          <button
            onClick={() => setShowDetail((s) => !s)}
            className="mt-2 ml-9 text-xs text-fg-subtle hover:text-fg-muted transition-colors"
          >
            {showDetail ? strings.common.hideDetails : strings.common.showDetails}
          </button>
          {showDetail && (
            <pre className="mt-2 ml-9 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2.5 text-xs text-fg-muted font-mono">
              {result.detail}
            </pre>
          )}
        </>
      )}
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
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
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
        <option value="">Systemstandard</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Mikrofon ${i + 1}`}
          </option>
        ))}
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
