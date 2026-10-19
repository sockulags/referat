import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { DictationEntry } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatRelativeDate } from '../format'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Field'
import { ConfirmModal } from '../components/ui/ConfirmModal'
import { IconCopy, IconMic, IconPencil, IconTrash } from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'

/** The last week's dictations: copy one again, or teach the glossary a misheard word. */
export function Dictations(): JSX.Element {
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()
  const toast = useApp((s) => s.toast)
  const [entries, setEntries] = useState<DictationEntry[] | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const t = strings.dictations

  useEffect(() => {
    let active = true
    void window.api.listDictations().then((list) => active && setEntries(list))
    const unsubscribe = window.api.onDictationAdded((entry) =>
      setEntries((current) => [entry, ...(current ?? [])])
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const remove = async (id: string): Promise<void> => {
    await window.api.deleteDictation(id)
    setEntries((current) => (current ?? []).filter((entry) => entry.id !== id))
  }

  const clear = async (): Promise<void> => {
    await window.api.clearDictations()
    setEntries([])
    setConfirmClear(false)
    toast(t.cleared)
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-fg"
          >
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t.description}</p>
        </div>
        {entries && entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
            {t.clear}
          </Button>
        )}
      </div>

      {entries === null ? (
        <div className="skeleton h-28 w-full rounded-xl" />
      ) : entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <IconMic size={22} />
          </span>
          <p className="text-sm text-fg-muted">{t.empty}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <DictationCard key={entry.id} entry={entry} onDelete={() => void remove(entry.id)} />
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t.clearConfirmTitle}
        confirmLabel={t.clearConfirm}
        onConfirm={() => void clear()}
      >
        {t.clearConfirmBody}
      </ConfirmModal>
    </div>
  )
}

function DictationCard({
  entry,
  onDelete
}: {
  entry: DictationEntry
  onDelete: () => void
}): JSX.Element {
  const toast = useApp((s) => s.toast)
  const t = strings.dictations
  const [correcting, setCorrecting] = useState(false)
  const [heard, setHeard] = useState('')
  const [correct, setCorrect] = useState('')

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(entry.text)
    toast(t.copied)
  }

  const addToGlossary = async (): Promise<void> => {
    if (!heard.trim() || !correct.trim()) return
    await window.api.addGlossaryEntry(correct.trim(), heard.trim())
    toast(t.addedToGlossary(correct.trim()))
    setCorrecting(false)
    setHeard('')
    setCorrect('')
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {entry.app && <span className="font-semibold text-fg">{entry.app} · </span>}
          {formatRelativeDate(entry.at)}
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            <IconCopy size={16} /> {t.copy}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCorrecting((v) => !v)}>
            <IconPencil size={16} /> {t.correct}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label={t.delete}>
            <IconTrash size={16} />
          </Button>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{entry.text}</p>
      {correcting && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
          <p className="text-sm text-fg-muted">{t.correctHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t.heard}
              value={heard}
              onChange={(e) => setHeard(e.target.value)}
              placeholder={t.heardPlaceholder}
            />
            <Input
              label={t.shouldBe}
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              placeholder={t.shouldBePlaceholder}
            />
          </div>
          <div>
            <Button
              variant="primary"
              size="sm"
              disabled={!heard.trim() || !correct.trim()}
              onClick={() => void addToGlossary()}
            >
              {t.addToGlossary}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
