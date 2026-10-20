import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { AppSettings, DictationMicrophone, DictationSettings } from '../../../../shared/types'
import { useApp } from '../../store'
import { strings } from '../../strings'
import { Select, Textarea } from '../../components/ui/Field'
import { Toggle } from '../../components/ui/Toggle'
import { useLocalAiComponents } from '../../components/useLocalAiComponents'
import { cn } from '../../components/ui/cn'
import { SaveRow, Section } from './Section'
import { DICTATION_SECTION_ID } from './sectionIds'
import { HotkeyField } from './HotkeyField'
import { OpenSpeechTab } from './OpenSpeechTab'

/** Dictation: hold a key anywhere in Windows, speak, and the text is typed at the cursor. */
export function DictationSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const d = strings.settings.dictation
  const [draft, setDraft] = useState<DictationSettings>(settings.dictation)
  const [microphones, setMicrophones] = useState<DictationMicrophone[]>([])
  const [saving, setSaving] = useState(false)
  const components = useLocalAiComponents()

  const installed = components.statuses.some(
    (status) =>
      (status.component === 'dictation-cpu' || status.component === 'dictation-gpu') &&
      (status.state === 'installed' || status.state === 'running')
  )

  // The engine lists the microphones, so the list exists once it runs.
  useEffect(() => {
    if (!settings.dictation.enabled) return
    let active = true
    void window.api
      .listDictationMicrophones()
      .then((list) => active && setMicrophones(list))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [settings.dictation.enabled])

  const update = (patch: Partial<DictationSettings>): void =>
    setDraft((current) => ({ ...current, ...patch }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveDictationSettings(draft)
      patchSettings({
        dictation: draft,
        ...(draft.enabled ? { runInBackground: true } : {})
      })
      toast(strings.common.saved)
    } catch (error) {
      toast(error instanceof Error ? error.message : d.startFailed, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section id={DICTATION_SECTION_ID} title={d.title} description={d.description}>
      {settings.viskaImport && (
        <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-soft-fg">
          {d.fromViska(settings.viskaImport.terms)}
        </p>
      )}
      {!installed && <OpenSpeechTab label={d.openSpeech} />}
      <Toggle
        checked={draft.enabled}
        onChange={(enabled) => update({ enabled })}
        disabled={!installed && !draft.enabled}
        label={d.enable}
        description={installed ? d.enableHint : d.installFirst}
      />
      {draft.enabled && (
        <>
          <HotkeyField value={draft.hotkey} onChange={(hotkey) => update({ hotkey })} />
          <MicrophoneChoice
            value={draft.microphone}
            microphones={microphones}
            onChange={(microphone) => update({ microphone })}
          />
          {draft.microphone === '' && (
            <Toggle
              checked={draft.avoidBluetooth}
              onChange={(avoidBluetooth) => update({ avoidBluetooth })}
              label={d.avoidBluetooth}
              description={d.avoidBluetoothHint}
            />
          )}
          <Select
            label={d.language}
            value={draft.language}
            onChange={(e) => update({ language: e.target.value as DictationSettings['language'] })}
          >
            <option value="sv">{d.swedish}</option>
            <option value="en">{d.english}</option>
          </Select>
          <Toggle
            checked={draft.live !== false}
            onChange={(live) => update({ live })}
            label={d.live}
            description={d.liveHint}
          />
          <Toggle
            checked={draft.sounds}
            onChange={(sounds) => update({ sounds })}
            label={d.sounds}
          />
          <Toggle
            checked={draft.rewrite}
            onChange={(rewrite) => update({ rewrite })}
            label={d.rewrite}
            description={d.rewriteHint}
          />
          {draft.rewrite && (
            <Textarea
              label={d.rewriteInstruction}
              hint={d.rewriteInstructionHint}
              rows={2}
              value={draft.rewriteInstruction}
              onChange={(e) => update({ rewriteInstruction: e.target.value })}
            />
          )}
        </>
      )}
      <SaveRow onSave={() => void save()} saving={saving} />
    </Section>
  )
}

function MicrophoneChoice({
  value,
  microphones,
  onChange
}: {
  value: string
  microphones: DictationMicrophone[]
  onChange: (name: string) => void
}): JSX.Element {
  const d = strings.settings.dictation
  const options = [
    { name: '', label: d.micAutomatic, hint: d.micAutomaticHint, bluetooth: false },
    ...microphones.map((mic) => ({
      name: mic.name,
      label: mic.name,
      hint: mic.bluetooth ? d.micBluetoothHint : mic.default ? d.micDefault : '',
      bluetooth: mic.bluetooth
    }))
  ]
  // A saved choice the engine does not see right now (unplugged) stays visible.
  if (value && !microphones.some((mic) => mic.name === value)) {
    options.push({ name: value, label: value, hint: d.micMissing, bluetooth: false })
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg">{d.microphone}</legend>
      {options.map((option) => (
        <label
          key={option.name || 'auto'}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3',
            value === option.name ? 'border-accent bg-accent-soft' : 'border-border'
          )}
        >
          <input
            type="radio"
            name="dictation-microphone"
            className="mt-1 accent-[var(--accent)]"
            checked={value === option.name}
            onChange={() => onChange(option.name)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {option.label}
              {option.bluetooth && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
                  {d.bluetooth}
                </span>
              )}
            </span>
            {option.hint && (
              <span className="text-xs leading-relaxed text-fg-muted">{option.hint}</span>
            )}
          </span>
        </label>
      ))}
      {microphones.length === 0 && <p className="text-xs text-fg-subtle">{d.micListLater}</p>}
    </fieldset>
  )
}
