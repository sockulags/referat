import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlossaryTerm, MeetingDetail, TranscriptSegment } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatRelativeDate, formatDuration, formatTimestamp } from '../format'
import { Markdown } from '../components/Markdown'
import { ProgressSteps } from '../components/ui/ProgressSteps'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import {
  IconCopy,
  IconCheck,
  IconDownload,
  IconSearch,
  IconAlert,
  IconRetry,
  IconClock,
  IconX
} from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'
import { cn } from '../components/ui/cn'

type Tab = 'protocol' | 'transcript'

export function Meeting(): JSX.Element {
  const meetingId = useApp((s) => s.meetingId)
  const toast = useApp((s) => s.toast)
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('protocol')

  const load = useCallback(async (): Promise<void> => {
    if (!meetingId) return
    try {
      const detail = await window.api.getMeeting(meetingId)
      setMeeting(detail)
    } catch {
      toast(strings.errors.loadMeeting, 'error')
    } finally {
      setLoading(false)
    }
  }, [meetingId, toast])

  useEffect(() => {
    void (async (): Promise<void> => {
      await load()
    })()
    const off = window.api.onPipelineProgress((e) => {
      if (e.meetingId !== meetingId) return
      setMeeting((prev) => (prev ? { ...prev, status: e.status } : prev))
      // When a step completes, refetch to pick up transcript/protocol/error.
      if (e.status === 'done' || e.status === 'error' || e.status === 'summarizing') void load()
    })
    return off
  }, [meetingId, load])

  const retryLoad = (): void => {
    setLoading(true)
    void load()
  }

  if (loading) return <MeetingSkeleton />
  if (!meeting) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="text-fg-muted">{strings.errors.loadMeeting}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={retryLoad}
          iconLeft={<IconRetry size={16} />}
        >
          {strings.common.retry}
        </Button>
      </div>
    )
  }

  const done = meeting.status === 'done'
  const isError = meeting.status === 'error'
  const inProgress = !done && !isError

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <MeetingHeader meeting={meeting} onRenamed={load} />

      {inProgress && <PipelinePanel meeting={meeting} />}
      {isError && <ErrorPanel meeting={meeting} onRetried={load} />}

      {done && (
        <>
          {meeting.warning && <WarningPanel warning={meeting.warning} />}

          <div className="mt-6 flex items-center gap-1 border-b border-border">
            <TabButton active={tab === 'protocol'} onClick={() => setTab('protocol')}>
              {strings.meeting.tabProtocol}
            </TabButton>
            <TabButton active={tab === 'transcript'} onClick={() => setTab('transcript')}>
              {strings.meeting.tabTranscript}
            </TabButton>
          </div>

          {tab === 'protocol' ? (
            <ProtocolTab meeting={meeting} />
          ) : (
            <TranscriptTab meeting={meeting} onChanged={load} />
          )}
        </>
      )}
    </div>
  )
}

function MeetingHeader({
  meeting,
  onRenamed
}: {
  meeting: MeetingDetail
  onRenamed: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(meeting.title)
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()

  const save = async (): Promise<void> => {
    const next = value.trim() || strings.recording.untitled
    setEditing(false)
    if (next !== meeting.title) {
      await window.api.renameMeeting(meeting.id, next)
      onRenamed()
    }
  }

  return (
    <div>
      {editing ? (
        <Input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') {
              setValue(meeting.title)
              setEditing(false)
            }
          }}
          className="text-2xl font-semibold h-12"
        />
      ) : (
        <button
          onClick={() => {
            setValue(meeting.title)
            setEditing(true)
          }}
          title={strings.meeting.renameHint}
          className="group flex items-center gap-2 text-left rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-fg"
          >
            {meeting.title || strings.recording.untitled}
          </h1>
        </button>
      )}
      <div className="mt-1.5 flex items-center gap-3 text-sm text-fg-muted">
        <span>{formatRelativeDate(meeting.createdAt)}</span>
        {meeting.durationSec > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <IconClock size={14} />
            {formatDuration(meeting.durationSec)}
          </span>
        )}
      </div>
    </div>
  )
}

function PipelinePanel({ meeting }: { meeting: MeetingDetail }): JSX.Element {
  // The diarizing step is only relevant when speaker identification is enabled.
  const [showDiarizing, setShowDiarizing] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getSettings()
      .then((s) => {
        if (!cancelled) setShowDiarizing(s.diarization.enabled)
      })
      .catch(() => {
        /* fall back to the base steps */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card className="mt-6 px-6 py-8 animate-fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 text-accent mb-1">
          <Spinner size={18} className="text-accent" />
          <h2 className="text-base font-semibold text-fg">{strings.meeting.pipelineTitle}</h2>
        </div>
        <p className="text-sm text-fg-muted max-w-sm mx-auto">{strings.meeting.pipelineBody}</p>
      </div>
      <ProgressSteps status={meeting.status} showDiarizing={showDiarizing} />
    </Card>
  )
}

function WarningPanel({
  warning
}: {
  warning: NonNullable<MeetingDetail['warning']>
}): JSX.Element {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <Card className="mt-6 px-6 py-5 animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
          <IconAlert size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-fg">{strings.meeting.warningTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted leading-relaxed">{warning.message}</p>

          {warning.detail && (
            <>
              <button
                onClick={() => setShowDetail((s) => !s)}
                className="mt-2 text-xs font-medium text-fg-subtle hover:text-fg-muted transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {showDetail ? strings.common.hideDetails : strings.common.showDetails}
              </button>
              {showDetail && (
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs text-fg-muted font-mono">
                  {warning.detail}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

function ErrorPanel({
  meeting,
  onRetried
}: {
  meeting: MeetingDetail
  onRetried: () => void
}): JSX.Element {
  const [showDetail, setShowDetail] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const retry = async (): Promise<void> => {
    setRetrying(true)
    try {
      await window.api.retryPipeline(meeting.id)
      onRetried()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Card className="mt-6 px-6 py-7 animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
          <IconAlert size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-fg">{strings.meeting.errorTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted leading-relaxed">
            {meeting.error?.message ?? strings.errors.genericTitle}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={retry}
              loading={retrying}
              iconLeft={retrying ? undefined : <IconRetry size={16} />}
            >
              {strings.common.retry}
            </Button>
            {meeting.error?.detail && (
              <Button variant="ghost" size="sm" onClick={() => setShowDetail((s) => !s)}>
                {showDetail ? strings.common.hideDetails : strings.common.showDetails}
              </Button>
            )}
          </div>

          {showDetail && meeting.error?.detail && (
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs text-fg-muted font-mono">
              {meeting.error.detail}
            </pre>
          )}
        </div>
      </div>
    </Card>
  )
}

function ProtocolTab({ meeting }: { meeting: MeetingDetail }): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await window.api.copyProtocol(meeting.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const save = async (format: 'md' | 'docx'): Promise<void> => {
    const res = await window.api.exportProtocol(meeting.id, format)
    if (res.savedTo) toast(strings.meeting.exported)
  }

  if (!meeting.protocol) {
    return (
      <p className="py-12 text-center text-sm text-fg-muted">{strings.meeting.protocolEmpty}</p>
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 py-4">
        <Button
          variant={copied ? 'primary' : 'secondary'}
          size="sm"
          onClick={copy}
          iconLeft={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
        >
          {copied ? strings.meeting.copied : strings.meeting.copy}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => save('md')}
          iconLeft={<IconDownload size={16} />}
        >
          {strings.meeting.saveMarkdown}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => save('docx')}
          iconLeft={<IconDownload size={16} />}
        >
          {strings.meeting.saveWord}
        </Button>
      </div>

      <Card className="px-8 py-9 sm:px-10">
        <article className="mx-auto max-w-[70ch] text-[15px]">
          <Markdown source={meeting.protocol} />
        </article>
      </Card>
    </div>
  )
}

/** A selection inside the transcript, with where to float the action button. */
interface TranscriptSelection {
  text: string
  top: number
  left: number
}

/**
 * Watch for text selected inside `ref`. This is what makes the glossary worth
 * keeping up to date: the misheard word is right there in the transcript, so
 * adding it should cost one selection and one click.
 */
function useTranscriptSelection(
  ref: React.RefObject<HTMLDivElement | null>
): [TranscriptSelection | null, () => void] {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null)
  const clear = useCallback(() => setSelection(null), [])

  useEffect(() => {
    const read = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null)
      const text = sel.toString().trim()
      // Anything longer than a phrase is a copy gesture, not a term.
      if (!text || text.length > 80) return setSelection(null)
      const range = sel.getRangeAt(0)
      if (!ref.current?.contains(range.commonAncestorContainer)) return setSelection(null)
      const rect = range.getBoundingClientRect()
      setSelection({ text, top: rect.top, left: rect.left + rect.width / 2 })
    }
    // pointerup/keyup rather than selectionchange: the selection is only
    // interesting once the user has finished making it.
    document.addEventListener('pointerup', read)
    document.addEventListener('keyup', read)
    return () => {
      document.removeEventListener('pointerup', read)
      document.removeEventListener('keyup', read)
    }
  }, [ref])

  // A scroll moves the text out from under the button; drop it rather than
  // chase the position.
  useEffect(() => {
    if (!selection) return
    const drop = (): void => setSelection(null)
    window.addEventListener('scroll', drop, true)
    return () => window.removeEventListener('scroll', drop, true)
  }, [selection])

  return [selection, clear]
}

function TranscriptTab({
  meeting,
  onChanged
}: {
  meeting: MeetingDetail
  onChanged: () => Promise<void>
}): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [query, setQuery] = useState('')
  const [renamed, setRenamed] = useState(false)
  const [glossaryChanged, setGlossaryChanged] = useState(false)
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [selection, clearSelection] = useTranscriptSelection(listRef)
  const segments = useMemo(() => meeting.transcript?.segments ?? [], [meeting.transcript])
  const speakers = meeting.transcript?.speakers
  const suggestions = meeting.transcript?.speakerSuggestions

  const loadTerms = useCallback(async (): Promise<void> => {
    setTerms(await window.api.listGlossaryTerms())
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return segments
    return segments.filter((s) => s.text.toLowerCase().includes(q))
  }, [segments, query])

  const renameSpeaker = async (speakerId: string, name: string): Promise<void> => {
    await window.api.renameSpeaker(meeting.id, speakerId, name)
    setRenamed(true)
    await onChanged()
  }

  const dismissSuggestion = async (speakerId: string): Promise<void> => {
    await window.api.dismissSpeakerSuggestion(meeting.id, speakerId)
    await onChanged()
  }

  const resummarize = async (): Promise<void> => {
    // The pipeline-progress events flip the meeting to 'summarizing' and back.
    await window.api.resummarize(meeting.id)
  }

  const saveTerm = async (canonical: string, variant: string): Promise<void> => {
    await window.api.addGlossaryEntry(canonical, variant)
    // Correcting the transcript is local string work, so it happens right away
    // — the user sees the fix land instead of waiting for a new protocol.
    const hits = await window.api.applyGlossary(meeting.id)
    setPending(null)
    await Promise.all([loadTerms(), onChanged()])
    if (hits && hits > 0) setGlossaryChanged(true)
    else toast(strings.meeting.glossaryNoChange)
  }

  if (segments.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-fg-muted">{strings.meeting.transcriptEmpty}</p>
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="py-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={strings.meeting.searchTranscript}
          iconLeft={<IconSearch size={17} />}
        />
      </div>

      {renamed && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-2.5 animate-fade-in">
          <p className="text-sm text-fg-muted">{strings.meeting.speakersChangedHint}</p>
          <Button variant="secondary" size="sm" onClick={() => void resummarize()}>
            {strings.meeting.updateProtocol}
          </Button>
        </div>
      )}

      {glossaryChanged && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-2.5 animate-fade-in">
          <p className="text-sm text-fg-muted">{strings.meeting.glossaryChangedHint}</p>
          <Button variant="secondary" size="sm" onClick={() => void resummarize()}>
            {strings.meeting.updateProtocol}
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">{strings.meeting.noMatches}</p>
      ) : (
        <div ref={listRef}>
          <Card className="divide-y divide-border">
            {filtered.map((seg, i) => {
              const name = seg.speaker ? (speakers?.[seg.speaker] ?? seg.speaker) : undefined
              // A suggestion is only shown while the speaker still has its
              // default name — a confirmed rename always wins.
              const suggestedName =
                seg.speaker && name && isDefaultSpeakerName(name)
                  ? suggestions?.[seg.speaker]
                  : undefined
              return (
                <SegmentRow
                  key={`${seg.startSec}-${i}`}
                  segment={seg}
                  query={query}
                  terms={terms}
                  speakerName={name}
                  suggestedName={suggestedName}
                  onRenameSpeaker={renameSpeaker}
                  onDismissSuggestion={dismissSuggestion}
                />
              )
            })}
          </Card>
        </div>
      )}

      {selection && (
        <button
          onClick={() => {
            setPending(selection.text)
            clearSelection()
          }}
          style={{ top: selection.top - 8, left: selection.left }}
          className="fixed z-40 -translate-x-1/2 -translate-y-full rounded-lg bg-fg px-3 py-1.5 text-xs font-medium text-surface shadow-float animate-pop-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {strings.meeting.addToGlossary}
        </button>
      )}

      {/* Keyed on the selected word so each word opens a freshly reset form. */}
      <GlossaryModal
        key={pending ?? 'closed'}
        heard={pending}
        terms={terms}
        onClose={() => setPending(null)}
        onSave={saveTerm}
      />
    </div>
  )
}

/** Prompts for the correct spelling of a word the transcriber got wrong. */
function GlossaryModal({
  heard,
  terms,
  onClose,
  onSave
}: {
  /** The selected text, or null when the dialog is closed. */
  heard: string | null
  terms: GlossaryTerm[]
  onClose: () => void
  onSave: (canonical: string, variant: string) => Promise<void>
}): JSX.Element {
  const [variant, setVariant] = useState(heard ?? '')
  const [canonical, setCanonical] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (!canonical.trim() || !variant.trim() || saving) return
    setSaving(true)
    try {
      await onSave(canonical, variant)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={heard !== null}
      onClose={onClose}
      title={strings.meeting.glossaryTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={!canonical.trim() || saving}>
            {strings.meeting.glossarySave}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm leading-relaxed text-fg-muted">{strings.meeting.glossaryIntro}</p>
        <Input
          label={strings.meeting.glossaryHeard}
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
        />
        <Input
          label={strings.meeting.glossaryCorrect}
          hint={strings.meeting.glossaryCorrectHint}
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
          placeholder="t.ex. Kubernetes"
        />
        {terms.length > 0 && (
          <Select
            label={strings.meeting.glossaryPickExisting}
            value=""
            onChange={(e) => setCanonical(e.target.value)}
          >
            <option value="">{strings.meeting.glossaryPickNew}</option>
            {terms.map((t) => (
              <option key={t.id} value={t.canonical}>
                {t.canonical}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Modal>
  )
}

/**
 * Matches the default display names assigned by diarization ('Talare 1',
 * 'Talare 2', … — see src/main/diarize.ts). Voice-recognition suggestions are
 * only rendered for speakers that still carry such a default name.
 */
function isDefaultSpeakerName(name: string): boolean {
  return /^Talare \d+$/.test(name)
}

function SegmentRow({
  segment,
  query,
  terms,
  speakerName,
  suggestedName,
  onRenameSpeaker,
  onDismissSuggestion
}: {
  segment: TranscriptSegment
  query: string
  /** Glossary terms, used to mark the words this segment had corrected. */
  terms?: GlossaryTerm[]
  /** Display name for the segment's speaker, when diarization ran. */
  speakerName?: string
  /** Name suggested by voice recognition, when the speaker is still unnamed. */
  suggestedName?: string
  onRenameSpeaker?: (speakerId: string, name: string) => Promise<void>
  onDismissSuggestion?: (speakerId: string) => Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const save = async (): Promise<void> => {
    const next = value.trim()
    setEditing(false)
    if (next && next !== speakerName && segment.speaker && onRenameSpeaker) {
      await onRenameSpeaker(segment.speaker, next)
    }
  }

  return (
    <div className="flex gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-xs font-medium tabular-nums text-fg-subtle w-12">
        {formatTimestamp(segment.startSec)}
      </span>
      <div className="flex-1 min-w-0">
        {segment.speaker && speakerName && (
          <div className="mb-0.5">
            {editing ? (
              <input
                value={value}
                autoFocus
                placeholder={strings.meeting.speakerNamePlaceholder}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                  if (e.key === 'Escape') {
                    setValue(speakerName)
                    setEditing(false)
                  }
                }}
                className="h-6 w-44 rounded-md border border-border-strong bg-surface px-1.5 text-xs font-medium text-fg placeholder:text-fg-subtle focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
              />
            ) : suggestedName ? (
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => {
                    // Same inline rename input, prefilled with the suggestion;
                    // Enter/blur confirms it as the speaker's name.
                    setValue(suggestedName)
                    setEditing(true)
                  }}
                  title={strings.meeting.speakerSuggestionHint}
                  className="text-xs font-medium text-accent underline decoration-dashed decoration-1 underline-offset-2 hover:text-accent-hover transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {`${suggestedName}?`}
                </button>
                <button
                  onClick={() => {
                    if (segment.speaker) void onDismissSuggestion?.(segment.speaker)
                  }}
                  title={strings.meeting.speakerSuggestionDismiss}
                  aria-label={strings.meeting.speakerSuggestionDismiss}
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-fg-subtle hover:text-fg-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <IconX size={12} />
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  setValue(speakerName)
                  setEditing(true)
                }}
                title={strings.meeting.speakerRenameHint}
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {speakerName}
              </button>
            )}
          </div>
        )}
        <p className="text-[15px] leading-relaxed text-fg">
          {query.trim()
            ? highlight(segment.text, query)
            : segment.originalText
              ? markCorrections(segment.text, terms ?? [])
              : segment.text}
        </p>
      </div>
    </div>
  )
}

/**
 * Mark the glossary's spellings in a segment the glossary rewrote, so a
 * correction is visible rather than silent. Only runs when the segment
 * actually changed, and search highlighting takes precedence.
 */
function markCorrections(text: string, terms: GlossaryTerm[]): JSX.Element[] | string {
  const names = terms.map((t) => t.canonical).filter(Boolean)
  if (names.length === 0) return text
  // Longest first so "Azure DevOps" is marked as one term, not two.
  const pattern = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`, 'gu')

  const parts: JSX.Element[] = []
  let idx = 0
  let key = 0
  let m = re.exec(text)
  if (!m) return text
  while (m) {
    if (m.index > idx) parts.push(<span key={key++}>{text.slice(idx, m.index)}</span>)
    parts.push(
      <span
        key={key++}
        title={strings.meeting.glossaryCorrectedTitle}
        className="underline decoration-dotted decoration-1 underline-offset-2 decoration-fg-subtle"
      >
        {m[0]}
      </span>
    )
    idx = m.index + m[0].length
    m = re.exec(text)
  }
  if (idx < text.length) parts.push(<span key={key++}>{text.slice(idx)}</span>)
  return parts
}

/** Highlight query matches without dangerouslySetInnerHTML. */
function highlight(text: string, query: string): JSX.Element[] | string {
  const q = query.trim()
  if (!q) return text
  const parts: JSX.Element[] = []
  const lower = text.toLowerCase()
  const lowerQ = q.toLowerCase()
  let idx = 0
  let key = 0
  let found = lower.indexOf(lowerQ, idx)
  if (found === -1) return text
  while (found !== -1) {
    if (found > idx) parts.push(<span key={key++}>{text.slice(idx, found)}</span>)
    parts.push(
      <mark key={key++} className="rounded bg-accent-soft text-accent-soft-fg px-0.5">
        {text.slice(found, found + q.length)}
      </mark>
    )
    idx = found + q.length
    found = lower.indexOf(lowerQ, idx)
  }
  if (idx < text.length) parts.push(<span key={key++}>{text.slice(idx)}</span>)
  return parts
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-t-md',
        active ? 'text-fg' : 'text-fg-muted hover:text-fg'
      )}
    >
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
    </button>
  )
}

function MeetingSkeleton(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-4 w-40 mt-3" />
      <div className="skeleton h-64 w-full mt-8 rounded-xl" />
    </div>
  )
}
