import type { JSX } from 'react'
import { useState } from 'react'
import type { AppSettings, SpeechModel } from '../../../../shared/types'
import { useApp } from '../../store'
import { strings } from '../../strings'
import { ComponentInstallCard } from '../../components/LocalAiComponents'
import { useLocalAiComponents } from '../../components/useLocalAiComponents'
import { cn } from '../../components/ui/cn'
import { Section } from './Section'

const MODELS: SpeechModel[] = ['auto', 'small', 'medium', 'large']

/**
 * Speech recognition on this computer: one component that both meetings and
 * dictation use, and the KB-Whisper model it runs.
 */
export function SpeechSection({ settings }: { settings: AppSettings }): JSX.Element {
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const components = useLocalAiComponents()
  const sp = strings.settings.speech
  const [model, setModel] = useState<SpeechModel>(settings.speechModel)

  const choose = async (next: SpeechModel): Promise<void> => {
    if (next === model) return
    setModel(next)
    patchSettings({ speechModel: next })
    try {
      await window.api.saveGeneralSettings({ speechModel: next })
      toast(strings.common.saved)
    } catch (error) {
      toast(error instanceof Error ? error.message : sp.modelFailed, 'error')
    }
  }

  return (
    <Section title={sp.title} description={sp.description}>
      <div className="flex flex-col gap-3">
        <ComponentInstallCard
          component="dictation-cpu"
          title={sp.cpuTitle}
          description={sp.cpuDescription}
          detail={sp.cpuSize}
          manager={components}
        />
        <ComponentInstallCard
          component="dictation-gpu"
          title={sp.gpuTitle}
          description={sp.gpuDescription}
          detail={sp.gpuSize}
          manager={components}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-fg">{sp.model}</legend>
        {MODELS.map((option) => (
          <label
            key={option}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3',
              model === option ? 'border-accent bg-accent-soft' : 'border-border'
            )}
          >
            <input
              type="radio"
              name="speech-model"
              className="mt-1 accent-[var(--accent)]"
              checked={model === option}
              onChange={() => void choose(option)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">{sp.models[option].label}</span>
              <span className="text-xs leading-relaxed text-fg-muted">
                {sp.models[option].hint}
              </span>
            </span>
          </label>
        ))}
        <p className="text-xs leading-relaxed text-fg-muted">{sp.modelHint}</p>
      </fieldset>
    </Section>
  )
}
