import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  SpeakerProfile,
  SummaryPreset,
  TranscriptionPreset
} from '../../../shared/types'
import { useApp, applyTheme } from '../store'
import { strings } from '../strings'
import {
  SUMMARY_PRESETS,
  TRANSCRIPTION_PRESETS,
  presetLabel,
  summaryDefaults,
  transcriptionDefaults
} from '../presets'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea, Field } from '../components/ui/Field'
import { Toggle } from '../components/ui/Toggle'
import { Modal } from '../components/ui/Modal'
import { ConnectionTest } from '../components/ConnectionTest'
import { IconSun, IconMoon, IconMonitor, IconChevronDown } from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'
import { cn } from '../components/ui/cn'

export function Settings(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const [version, setVersion] = useState('')
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  if (!settings) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-40 w-full mt-6 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-fg mb-6"
      >
        {strings.settings.title}
      </h1>

      <div className="flex flex-col gap-4">
        <AudioSection settings={settings} />
        <TranscriptionSection settings={settings} />
        <SummarySection settings={settings} />
        <DiarizationSection settings={settings} />
        <AppearanceSection settings={settings} />
      </div>

      <Footer version={version} />
    </div>
  )
}

function Section({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): JSX.Element {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="text-sm text-fg-muted mt-0.5">{description}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  )
}

function SaveRow({ onSave, saving }: { onSave: () => void; saving: boolean }): JSX.Element {
  return (
    <div className="pt-1">
      <Button variant="primary" size="sm" onClick={onSave} loading={saving}>
        {strings.common.save}
      </Button>
    </div>
  )
}

// ---------- Audio ----------

function AudioSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]))
  }, [])

  const setMic = async (id: string): Promise<void> => {
    patchSettings({ microphoneId: id })
    await window.api.saveGeneralSettings({ microphoneId: id })
  }

  const setSystemAudio = async (on: boolean): Promise<void> => {
    patchSettings({ captureSystemAudio: on })
    await window.api.saveGeneralSettings({ captureSystemAudio: on })
    toast(strings.common.saved)
  }

  return (
    <Section title={strings.settings.audio.title} description={strings.settings.audio.description}>
      <Select
        label={strings.settings.audio.microphone}
        value={settings.microphoneId}
        onChange={(e) => void setMic(e.target.value)}
      >
        <option value="">Systemstandard</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Mikrofon ${i + 1}`}
          </option>
        ))}
      </Select>
      <Toggle
        checked={settings.captureSystemAudio}
        onChange={(v) => void setSystemAudio(v)}
        label={strings.settings.audio.systemAudio}
        description={strings.settings.audio.systemAudioHint}
      />
    </Section>
  )
}

// ---------- Transcription ----------

function TranscriptionSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const t = settings.transcription
  const [preset, setPreset] = useState<TranscriptionPreset>(t.preset)
  const [baseUrl, setBaseUrl] = useState(t.baseUrl)
  const [model, setModel] = useState(t.model)
  const [language, setLanguage] = useState(t.language)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const onPreset = (p: TranscriptionPreset): void => {
    setPreset(p)
    const d = transcriptionDefaults(p)
    setBaseUrl(d.baseUrl)
    setModel(d.model)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveTranscriptionSettings({
        preset,
        baseUrl,
        model,
        language,
        apiKey: apiKey || undefined
      })
      patchSettings({
        transcription: {
          ...t,
          preset,
          baseUrl,
          model,
          language,
          hasApiKey: t.hasApiKey || !!apiKey
        }
      })
      setApiKey('')
      toast(strings.common.saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={strings.settings.transcription.title}
      description={strings.settings.transcription.description}
    >
      <PresetSelect
        label={strings.settings.transcription.preset}
        value={preset}
        options={TRANSCRIPTION_PRESETS}
        onChange={(v) => onPreset(v as TranscriptionPreset)}
      />
      <Input
        label={strings.settings.transcription.baseUrl}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://…/v1"
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label={strings.settings.transcription.model}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <Input
          label={strings.settings.transcription.language}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="sv"
          hint={strings.settings.transcription.languageHint}
        />
      </div>
      <ApiKeyField hasApiKey={t.hasApiKey} value={apiKey} onChange={setApiKey} />
      <SaveRow onSave={save} saving={saving} />
      <div className="pt-4 border-t border-border">
        <ConnectionTest
          run={async () => {
            await save()
            return window.api.testTranscriptionConnection()
          }}
        />
      </div>
    </Section>
  )
}

// ---------- Summary ----------

function SummarySection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const s = settings.summary
  const [preset, setPreset] = useState<SummaryPreset>(s.preset)
  const [flavor, setFlavor] = useState(s.apiFlavor)
  const [baseUrl, setBaseUrl] = useState(s.baseUrl)
  const [model, setModel] = useState(s.model)
  const [apiKey, setApiKey] = useState('')
  const [template, setTemplate] = useState(s.promptTemplate)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const onPreset = (p: SummaryPreset): void => {
    setPreset(p)
    const d = summaryDefaults(p)
    setBaseUrl(d.baseUrl)
    setModel(d.model)
    setFlavor(d.apiFlavor)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveSummarySettings({
        preset,
        apiFlavor: flavor,
        baseUrl,
        model,
        promptTemplate: template,
        apiKey: apiKey || undefined
      })
      patchSettings({
        summary: {
          ...s,
          preset,
          apiFlavor: flavor,
          baseUrl,
          model,
          promptTemplate: template,
          hasApiKey: s.hasApiKey || !!apiKey
        }
      })
      setApiKey('')
      toast(strings.common.saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={strings.settings.summary.title}
      description={strings.settings.summary.description}
    >
      <PresetSelect
        label={strings.settings.transcription.preset}
        value={preset}
        options={SUMMARY_PRESETS}
        onChange={(v) => onPreset(v as SummaryPreset)}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label={strings.settings.transcription.baseUrl}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://…"
        />
        <Input
          label={strings.settings.transcription.model}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <Select
        label={strings.settings.summary.flavor}
        value={flavor}
        onChange={(e) => setFlavor(e.target.value as typeof flavor)}
      >
        <option value="openai-compatible">OpenAI-kompatibel</option>
        <option value="anthropic">Anthropic</option>
      </Select>
      <ApiKeyField hasApiKey={s.hasApiKey} value={apiKey} onChange={setApiKey} />

      <div className="border-t border-border pt-2">
        <button
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg transition-colors py-1"
        >
          <IconChevronDown
            size={16}
            className={cn('transition-transform', advancedOpen && 'rotate-180')}
          />
          {strings.settings.summary.advanced}
        </button>
        {advancedOpen && (
          <div className="mt-3 animate-fade-in">
            <Textarea
              label={strings.settings.summary.promptTemplate}
              hint={strings.settings.summary.promptHint}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={8}
              className="font-mono text-[13px]"
            />
          </div>
        )}
      </div>

      <SaveRow onSave={save} saving={saving} />
      <div className="pt-4 border-t border-border">
        <ConnectionTest
          run={async () => {
            await save()
            return window.api.testSummaryConnection()
          }}
        />
      </div>
    </Section>
  )
}

// ---------- Diarization ----------

function DiarizationSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const d = settings.diarization
  const [enabled, setEnabled] = useState(d.enabled)
  const [baseUrl, setBaseUrl] = useState(d.baseUrl)
  const [recognitionEnabled, setRecognitionEnabled] = useState(d.recognitionEnabled)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveDiarizationSettings({ enabled, baseUrl, recognitionEnabled })
      patchSettings({ diarization: { enabled, baseUrl, recognitionEnabled } })
      toast(strings.common.saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={strings.settings.diarization.title}
      description={strings.settings.diarization.description}
    >
      <Toggle
        id="diarization-enable"
        checked={enabled}
        onChange={setEnabled}
        label={strings.settings.diarization.enable}
        description={strings.settings.diarization.enableHint}
      />
      {enabled && (
        <Toggle
          id="diarization-recognition"
          checked={recognitionEnabled}
          onChange={setRecognitionEnabled}
          label={strings.settings.diarization.recognition.enable}
          description={strings.settings.diarization.recognition.enableHint}
        />
      )}
      <Input
        label={strings.settings.diarization.baseUrl}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="http://…"
        hint={strings.settings.diarization.baseUrlHint}
      />
      <SaveRow onSave={save} saving={saving} />
      <div className="pt-4 border-t border-border">
        <ConnectionTest
          run={async () => {
            await save()
            return window.api.testDiarizationConnection()
          }}
        />
      </div>
      {enabled && recognitionEnabled && <SpeakerProfilesBlock />}
    </Section>
  )
}

/** List of locally saved voice profiles, with per-profile and bulk removal. */
function SpeakerProfilesBlock(): JSX.Element {
  const r = strings.settings.diarization.recognition
  const [profiles, setProfiles] = useState<SpeakerProfile[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setProfiles(await window.api.listSpeakerProfiles())
    } catch {
      setProfiles([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api
      .listSpeakerProfiles()
      .then((p) => {
        if (!cancelled) setProfiles(p)
      })
      .catch(() => {
        if (!cancelled) setProfiles([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const forget = async (id: string): Promise<void> => {
    await window.api.deleteSpeakerProfile(id)
    await refresh()
  }

  const forgetAll = async (): Promise<void> => {
    await window.api.deleteAllSpeakerProfiles()
    setConfirmOpen(false)
    await refresh()
  }

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-sm font-semibold text-fg mb-2">{r.profilesTitle}</h3>
      {profiles.length === 0 ? (
        <p className="text-sm text-fg-muted">{r.profilesEmpty}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 truncate">
                  <span className="text-sm font-medium text-fg">{p.name}</span>
                  <span className="ml-2 text-xs text-fg-muted tabular-nums">
                    {p.sampleCount} {r.profileMeetings}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void forget(p.id)}>
                  {r.forget}
                </Button>
              </li>
            ))}
          </ul>
          <div className="pt-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
              {r.forgetAll}
            </Button>
          </div>
        </>
      )}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={r.forgetAllConfirmTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {strings.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void forgetAll()}>
              {r.forgetAllConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted leading-relaxed">{r.forgetAllConfirmBody}</p>
      </Modal>
    </div>
  )
}

// ---------- Appearance ----------

function AppearanceSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const options: { value: AppSettings['theme']; label: string; icon: JSX.Element }[] = [
    { value: 'system', label: strings.settings.appearance.system, icon: <IconMonitor size={18} /> },
    { value: 'light', label: strings.settings.appearance.light, icon: <IconSun size={18} /> },
    { value: 'dark', label: strings.settings.appearance.dark, icon: <IconMoon size={18} /> }
  ]

  const setTheme = async (theme: AppSettings['theme']): Promise<void> => {
    patchSettings({ theme })
    applyTheme(theme)
    await window.api.saveGeneralSettings({ theme })
  }

  return (
    <Section
      title={strings.settings.appearance.title}
      description={strings.settings.appearance.description}
    >
      <Field label={strings.settings.appearance.theme}>
        <div className="grid grid-cols-3 gap-2">
          {options.map((o) => {
            const active = settings.theme === o.value
            return (
              <button
                key={o.value}
                onClick={() => void setTheme(o.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 py-3 rounded-[10px] border text-sm font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'border-accent bg-accent-soft text-accent-soft-fg'
                    : 'border-border-strong text-fg-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                {o.icon}
                {o.label}
              </button>
            )
          })}
        </div>
      </Field>
    </Section>
  )
}

// ---------- Shared bits ----------

function PresetSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly (TranscriptionPreset | SummaryPreset)[]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((p) => (
        <option key={p} value={p}>
          {presetLabel(p)}
        </option>
      ))}
    </Select>
  )
}

function ApiKeyField({
  hasApiKey,
  value,
  onChange
}: {
  hasApiKey: boolean
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <Input
      label={strings.settings.apiKey}
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        hasApiKey ? strings.settings.apiKeySavedPlaceholder : strings.settings.apiKeyNewPlaceholder
      }
      hint={strings.settings.apiKeyHint}
      autoComplete="off"
    />
  )
}

function Footer({ version }: { version: string }): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  return (
    <div className="mt-8 flex items-center justify-between text-sm text-fg-muted">
      <button
        onClick={() => navigate('onboarding')}
        className="text-accent hover:text-accent-hover font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
      >
        {strings.settings.rerunOnboarding}
      </button>
      <span className="text-fg-subtle tabular-nums">
        {strings.app.name} {strings.settings.version} {version}
      </span>
    </div>
  )
}
