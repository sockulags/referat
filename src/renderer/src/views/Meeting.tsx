import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MeetingDetail, TranscriptSegment } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatRelativeDate, formatDuration, formatTimestamp } from '../format'
import { Markdown } from '../components/Markdown'
import { ProgressSteps } from '../components/ui/ProgressSteps'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Field'
import { Spinner } from '../components/ui/Spinner'
import {
  IconCopy,
  IconCheck,
  IconDownload,
  IconSearch,
  IconAlert,
  IconRetry,
  IconClock
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

function TranscriptTab({
  meeting,
  onChanged
}: {
  meeting: MeetingDetail
  onChanged: () => Promise<void>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [renamed, setRenamed] = useState(false)
  const segments = useMemo(() => meeting.transcript?.segments ?? [], [meeting.transcript])
  const speakers = meeting.transcript?.speakers

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

  const resummarize = async (): Promise<void> => {
    // The pipeline-progress events flip the meeting to 'summarizing' and back.
    await window.api.resummarize(meeting.id)
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

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">{strings.meeting.noMatches}</p>
      ) : (
        <Card className="divide-y divide-border">
          {filtered.map((seg, i) => (
            <SegmentRow
              key={`${seg.startSec}-${i}`}
              segment={seg}
              query={query}
              speakerName={seg.speaker ? (speakers?.[seg.speaker] ?? seg.speaker) : undefined}
              onRenameSpeaker={renameSpeaker}
            />
          ))}
        </Card>
      )}
    </div>
  )
}

function SegmentRow({
  segment,
  query,
  speakerName,
  onRenameSpeaker
}: {
  segment: TranscriptSegment
  query: string
  /** Display name for the segment's speaker, when diarization ran. */
  speakerName?: string
  onRenameSpeaker?: (speakerId: string, name: string) => Promise<void>
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
        <p className="text-[15px] leading-relaxed text-fg">{highlight(segment.text, query)}</p>
      </div>
    </div>
  )
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
