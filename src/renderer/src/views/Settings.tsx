import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  GlossaryTerm,
  LocalAiComponent,
  LocalAiComponentStatus,
  SpeakerProfile,
  SummaryPreset,
  SummaryTemplate,
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
        <GlossarySection />
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
  const components = useLocalAiComponents()

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
      {preset === 'built-in' ? (
        <ComponentInstallCard
          component="transcription-cpu"
          title={strings.settings.transcription.builtInTitle}
          description={strings.settings.transcription.builtInDescription}
          detail={strings.settings.transcription.builtInSize}
          manager={components}
        />
      ) : (
        <>
          <Input
            label={strings.settings.transcription.baseUrl}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://…/v1"
          />
          <Input
            label={strings.settings.transcription.model}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <ApiKeyField hasApiKey={t.hasApiKey} value={apiKey} onChange={setApiKey} />
        </>
      )}
      <div>
        <Input
          label={strings.settings.transcription.language}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="sv"
          hint={strings.settings.transcription.languageHint}
        />
      </div>
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
  const [backend, setBackend] = useState(s.backend)
  const [flavor, setFlavor] = useState(s.apiFlavor)
  const [baseUrl, setBaseUrl] = useState(s.baseUrl)
  const [model, setModel] = useState(s.model)
  const [apiKey, setApiKey] = useState('')
  const [templates, setTemplates] = useState(s.templates)
  const [editingId, setEditingId] = useState(s.defaultTemplateId)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const onPreset = (p: SummaryPreset): void => {
    setPreset(p)
    const d = summaryDefaults(p)
    setBackend(d.backend)
    setBaseUrl(d.baseUrl)
    setModel(d.model)
    setFlavor(d.apiFlavor)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveSummarySettings({
        preset,
        backend,
        apiFlavor: flavor,
        baseUrl,
        model,
        templates,
        defaultTemplateId: s.defaultTemplateId,
        apiKey: apiKey || undefined
      })
      patchSettings({
        summary: {
          ...s,
          preset,
          backend,
          apiFlavor: flavor,
          baseUrl,
          model,
          templates,
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
      {backend === 'codex-cli' ? (
        <div
          role="note"
          className="rounded-xl border border-border-strong bg-surface-2 px-4 py-3.5"
        >
          <p className="text-sm font-medium text-fg">{strings.settings.summary.codexTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            {strings.settings.summary.codexDescription}
          </p>
        </div>
      ) : (
        <>
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
        </>
      )}

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
          <TemplateEditor
            templates={templates}
            setTemplates={setTemplates}
            editingId={editingId}
            setEditingId={setEditingId}
          />
        )}
      </div>

      <SaveRow onSave={save} saving={saving} />
      <div className="pt-4 border-t border-border">
        <ConnectionTest
          label={backend === 'codex-cli' ? strings.settings.summary.testCodex : undefined}
          run={async () => {
            await save()
            return window.api.testSummaryConnection()
          }}
        />
      </div>
    </Section>
  )
}

/**
 * Edit the prompt templates. One list, shared by every meeting — the same
 * "Uppföljningsmejl" should mean the same thing everywhere. Built-in templates
 * can be rewritten but not removed, so a picker is never empty.
 */
function TemplateEditor({
  templates,
  setTemplates,
  editingId,
  setEditingId
}: {
  templates: SummaryTemplate[]
  setTemplates: (t: SummaryTemplate[]) => void
  editingId: string
  setEditingId: (id: string) => void
}): JSX.Element {
  const editing = templates.find((t) => t.id === editingId) ?? templates[0]

  const patch = (change: Partial<SummaryTemplate>): void => {
    setTemplates(templates.map((t) => (t.id === editing.id ? { ...t, ...change } : t)))
  }

  const add = (): void => {
    const created: SummaryTemplate = {
      id: `egen-${Date.now().toString(36)}`,
      name: strings.settings.summary.templateNewName,
      promptTemplate: '{{ordlista}}\n\n{{fokus}}\n\nTranskription:\n{{transcript}}',
      builtIn: false
    }
    setTemplates([...templates, created])
    setEditingId(created.id)
  }

  const remove = (): void => {
    if (editing.builtIn) return
    const next = templates.filter((t) => t.id !== editing.id)
    setTemplates(next)
    setEditingId(next[0].id)
  }

  return (
    <div className="mt-3 flex flex-col gap-4 animate-fade-in">
      <p className="text-sm text-fg-muted">{strings.settings.summary.templatesHint}</p>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={strings.settings.summary.templatePick}
          value={editing.id}
          onChange={(e) => setEditingId(e.target.value)}
          className="min-w-48"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={add}>
          {strings.settings.summary.templateAdd}
        </Button>
        {!editing.builtIn && (
          <Button variant="ghost" size="sm" onClick={remove}>
            {strings.settings.summary.templateDelete}
          </Button>
        )}
      </div>

      <Input
        label={strings.settings.summary.templateName}
        hint={editing.builtIn ? strings.settings.summary.templateBuiltIn : undefined}
        value={editing.name}
        onChange={(e) => patch({ name: e.target.value })}
      />

      <Textarea
        label={strings.settings.summary.promptTemplate}
        hint={strings.settings.summary.promptHint}
        value={editing.promptTemplate}
        onChange={(e) => patch({ promptTemplate: e.target.value })}
        rows={10}
        className="font-mono text-[13px]"
      />
    </div>
  )
}

// ---------- Diarization ----------

function DiarizationSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const d = settings.diarization
  const [enabled, setEnabled] = useState(d.enabled)
  const [backend, setBackend] = useState(d.backend)
  const [baseUrl, setBaseUrl] = useState(d.baseUrl)
  const [recognitionEnabled, setRecognitionEnabled] = useState(d.recognitionEnabled)
  const [saving, setSaving] = useState(false)
  const components = useLocalAiComponents()

  const [userName, setUserName] = useState(settings.userName)

  // The name applies with or without diarization, so it saves on its own
  // rather than waiting for this section's Save button.
  const saveUserName = async (): Promise<void> => {
    const trimmed = userName.trim()
    if (trimmed === settings.userName) return
    patchSettings({ userName: trimmed })
    await window.api.saveGeneralSettings({ userName: trimmed })
    toast(strings.common.saved)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveDiarizationSettings({
        enabled,
        backend,
        baseUrl,
        recognitionEnabled
      })
      patchSettings({
        diarization: {
          enabled,
          backend,
          baseUrl,
          recognitionEnabled
        }
      })
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
      <Input
        label={strings.settings.diarization.userName}
        hint={strings.settings.diarization.userNameHint}
        placeholder={strings.settings.diarization.userNamePlaceholder}
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        onBlur={() => void saveUserName()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void saveUserName()
        }}
      />
      <Toggle
        id="diarization-enable"
        checked={enabled}
        onChange={setEnabled}
        label={strings.settings.diarization.enable}
        description={strings.settings.diarization.enableHint}
      />
      {enabled && (
        <Select
          label={strings.settings.diarization.backend}
          value={backend}
          onChange={(e) => setBackend(e.target.value as typeof backend)}
        >
          <option value="built-in">{strings.settings.diarization.builtIn}</option>
          <option value="server">{strings.settings.diarization.server}</option>
        </Select>
      )}
      {enabled && (
        <Toggle
          id="diarization-recognition"
          checked={recognitionEnabled}
          onChange={setRecognitionEnabled}
          label={strings.settings.diarization.recognition.enable}
          description={strings.settings.diarization.recognition.enableHint}
        />
      )}
      {enabled && backend === 'built-in' ? (
        <div className="rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">
              {strings.settings.diarization.setupTitle}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              {strings.settings.diarization.setupDescription}
            </p>
          </div>
          <ComponentInstallCard
            component="diarization-cpu"
            title={strings.settings.diarization.cpuTitle}
            description={strings.settings.diarization.cpuDescription}
            manager={components}
          />
          <ComponentInstallCard
            component="diarization-gpu"
            title={strings.settings.diarization.gpuTitle}
            description={strings.settings.diarization.gpuDescription}
            manager={components}
          />
        </div>
      ) : enabled && backend === 'server' ? (
        <Input
          label={strings.settings.diarization.baseUrl}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://…"
          hint={strings.settings.diarization.baseUrlHint}
        />
      ) : null}
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

interface LocalAiManager {
  statuses: LocalAiComponentStatus[]
  install(component: LocalAiComponent): Promise<void>
  remove(component: LocalAiComponent): Promise<void>
}

function useLocalAiComponents(): LocalAiManager {
  const [statuses, setStatuses] = useState<LocalAiComponentStatus[]>([])

  useEffect(() => {
    let active = true
    void window.api.listLocalAiComponents().then((items) => active && setStatuses(items))
    const unsubscribe = window.api.onLocalAiComponentProgress((next) => {
      setStatuses((current) => [
        ...current.filter((item) => item.component !== next.component),
        next
      ])
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return {
    statuses,
    install: async (component) => {
      const status = await window.api.installLocalAiComponent(component)
      setStatuses((current) => [...current.filter((item) => item.component !== component), status])
    },
    remove: async (component) => {
      await window.api.removeLocalAiComponent(component)
      setStatuses((current) => [
        ...current.filter((item) => item.component !== component),
        { component, state: 'not-installed' }
      ])
    }
  }
}

function ComponentInstallCard({
  component,
  title,
  description,
  detail,
  manager,
  disabled = false
}: {
  component: LocalAiComponent
  title: string
  description: string
  detail?: string
  manager: LocalAiManager
  disabled?: boolean
}): JSX.Element {
  const status = manager.statuses.find((item) => item.component === component)
  const busy = status?.state === 'downloading' || status?.state === 'installing'
  const installed = status?.state === 'installed' || status?.state === 'running'

  return (
    <div className="rounded-xl border border-border-strong bg-surface px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{description}</p>
          {detail && <p className="mt-1 text-xs text-fg-subtle">{detail}</p>}
          {status?.message && <p className="mt-1 text-xs text-accent">{status.message}</p>}
          {status?.detail && <p className="mt-1 text-xs text-danger">{status.detail}</p>}
        </div>
        {installed ? (
          <Button variant="ghost" size="sm" onClick={() => void manager.remove(component)}>
            {strings.common.delete}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            disabled={disabled || busy}
            onClick={() => void manager.install(component)}
          >
            Installera
          </Button>
        )}
      </div>
      {busy && status?.progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round(status.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
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

// ---------- Glossary ----------

/**
 * The glossary is filled from the transcript view, where the misheard word is
 * in front of you. This section is for going back over it: fixing a spelling,
 * adding a variant you remember, removing a term that over-corrects.
 */
function GlossarySection(): JSX.Element {
  const g = strings.settings.glossary
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setTerms(await window.api.listGlossaryTerms())
    } catch {
      setTerms([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api
      .listGlossaryTerms()
      .then((t) => {
        if (!cancelled) setTerms(t)
      })
      .catch(() => {
        if (!cancelled) setTerms([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const remove = async (id: string): Promise<void> => {
    await window.api.deleteGlossaryTerm(id)
    setConfirmId(null)
    setOpenId(null)
    await refresh()
  }

  return (
    <Section title={g.title} description={g.description}>
      {terms.length === 0 ? (
        <p className="text-sm text-fg-muted leading-relaxed">{g.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {terms.map((term) => (
            <li key={term.id} className="py-2">
              {openId === term.id ? (
                <GlossaryTermEditor
                  term={term}
                  onDone={async () => {
                    setOpenId(null)
                    await refresh()
                  }}
                  onDelete={() => setConfirmId(term.id)}
                />
              ) : (
                <button
                  onClick={() => setOpenId(term.id)}
                  className="flex w-full items-center justify-between gap-3 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-fg">
                    {term.canonical}
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                    {g.variantCount(term.variants.length)}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title={g.deleteConfirmTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              {strings.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void (confirmId && remove(confirmId))}>
              {g.deleteConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted leading-relaxed">{g.deleteConfirmBody}</p>
      </Modal>
    </Section>
  )
}

function GlossaryTermEditor({
  term,
  onDone,
  onDelete
}: {
  term: GlossaryTerm
  onDone: () => Promise<void>
  onDelete: () => void
}): JSX.Element {
  const g = strings.settings.glossary
  const [canonical, setCanonical] = useState(term.canonical)
  // One variant per line is the shape people already expect from a word list.
  const [variants, setVariants] = useState(term.variants.join('\n'))
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (!canonical.trim() || saving) return
    setSaving(true)
    try {
      await window.api.updateGlossaryTerm(term.id, {
        canonical,
        variants: variants.split('\n')
      })
      await onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 py-1 animate-fade-in">
      <Input label={g.canonical} value={canonical} onChange={(e) => setCanonical(e.target.value)} />
      <Textarea
        label={g.variants}
        hint={g.variantsHint}
        value={variants}
        onChange={(e) => setVariants(e.target.value)}
        rows={Math.min(8, Math.max(3, term.variants.length + 1))}
      />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onDelete}>
          {g.delete}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void onDone()}>
            {strings.common.cancel}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!canonical.trim() || saving}>
            {strings.common.save}
          </Button>
        </div>
      </div>
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
