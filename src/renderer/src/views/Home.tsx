import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { MeetingMeta } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatRelativeDate, formatDuration } from '../format'
import { Button, IconButton } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusChip } from '../components/ui/StatusChip'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Field'
import { Tooltip } from '../components/ui/Tooltip'
import {
  IconMic,
  IconWave,
  IconPencil,
  IconTrash,
  IconRetry,
  IconChevronRight,
  IconClock
} from '../components/icons'
import { cn } from '../components/ui/cn'

export function Home(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const setPendingTitle = useApp((s) => s.setPendingTitle)
  const toast = useApp((s) => s.toast)

  const [title, setTitle] = useState('')
  const [meetings, setMeetings] = useState<MeetingMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<MeetingMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MeetingMeta | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.listMeetings()
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setMeetings(list)
    } catch {
      toast(strings.errors.loadMeetings, 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void (async (): Promise<void> => {
      await load()
    })()
    const off = window.api.onPipelineProgress((e) => {
      setMeetings((prev) =>
        prev.map((m) => (m.id === e.meetingId ? { ...m, status: e.status } : m))
      )
    })
    return off
  }, [load])

  const start = (): void => {
    setPendingTitle(title.trim())
    navigate('recording')
  }

  const doRename = async (id: string, newTitle: string): Promise<void> => {
    await window.api.renameMeeting(id, newTitle)
    setRenameTarget(null)
    await load()
  }

  const doDelete = async (id: string): Promise<void> => {
    await window.api.deleteMeeting(id)
    setDeleteTarget(null)
    await load()
    toast(strings.home.deleteMeeting)
  }

  const doRetry = async (id: string): Promise<void> => {
    await window.api.retryPipeline(id)
    setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'transcribing' } : m)))
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Hero title={title} setTitle={setTitle} onStart={start} />

      <section className="mt-12">
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
          {strings.home.previousMeetings}
        </h2>

        {loading ? (
          <MeetingSkeletons />
        ) : meetings.length === 0 ? (
          <EmptyState onStart={start} />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {meetings.map((m, i) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                index={i}
                onOpen={() => navigate('meeting', m.id)}
                onRename={() => setRenameTarget(m)}
                onDelete={() => setDeleteTarget(m)}
                onRetry={() => doRetry(m.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {renameTarget && (
        <RenameModal
          key={renameTarget.id}
          meeting={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={doRename}
        />
      )}
      <DeleteModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function Hero({
  title,
  setTitle,
  onStart
}: {
  title: string
  setTitle: (t: string) => void
  onStart: () => void
}): JSX.Element {
  return (
    <Card className="relative overflow-hidden px-8 py-10 text-center">
      {/* Subtle mic-wave motif */}
      <div className="pointer-events-none absolute inset-x-0 -bottom-6 flex justify-center opacity-[0.06] text-accent">
        <svg width="520" height="120" viewBox="0 0 520 120" fill="none" aria-hidden="true">
          {Array.from({ length: 40 }).map((_, i) => {
            const h = 20 + Math.abs(Math.sin(i * 0.6)) * 80
            return (
              <rect
                key={i}
                x={i * 13}
                y={(120 - h) / 2}
                width="5"
                height={h}
                rx="2.5"
                fill="currentColor"
              />
            )
          })}
        </svg>
      </div>

      <p className="text-sm font-medium text-accent mb-4">{strings.home.heroKicker}</p>

      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        iconLeft={<IconMic size={20} />}
        className="mx-auto h-14 px-8 text-base rounded-full shadow-float"
      >
        {strings.home.startRecording}
      </Button>

      <div className="mt-6 max-w-sm mx-auto">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={strings.home.titlePlaceholder}
          className="text-center"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onStart()
          }}
        />
      </div>
    </Card>
  )
}

function MeetingRow({
  meeting,
  index,
  onOpen,
  onRename,
  onDelete,
  onRetry
}: {
  meeting: MeetingMeta
  index: number
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onRetry: () => void
}): JSX.Element {
  const isError = meeting.status === 'error'
  return (
    <Card
      interactive
      className="group animate-rise-in"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="flex items-center gap-3 pl-4 pr-3 py-3">
        <button
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-4 text-left"
          aria-label={`${strings.home.openMeeting}: ${meeting.title}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-fg">
                {meeting.title || strings.recording.untitled}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-fg-muted">
              <span>{formatRelativeDate(meeting.createdAt)}</span>
              {meeting.durationSec > 0 && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <IconClock size={13} />
                  {formatDuration(meeting.durationSec)}
                </span>
              )}
            </div>
          </div>
          <StatusChip status={meeting.status} />
        </button>

        <div className="flex items-center gap-0.5">
          {isError && (
            <Tooltip label={strings.common.retry}>
              <IconButton label={strings.common.retry} size="sm" onClick={onRetry}>
                <IconRetry size={17} />
              </IconButton>
            </Tooltip>
          )}
          <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Tooltip label={strings.common.rename}>
              <IconButton label={strings.home.renameMeeting} size="sm" onClick={onRename}>
                <IconPencil size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip label={strings.common.delete}>
              <IconButton
                label={strings.home.deleteMeeting}
                size="sm"
                onClick={onDelete}
                className="hover:text-danger"
              >
                <IconTrash size={16} />
              </IconButton>
            </Tooltip>
          </div>
          <IconChevronRight
            size={18}
            className="text-fg-subtle mr-1 group-hover:translate-x-0.5 transition-transform"
          />
        </div>
      </div>
    </Card>
  )
}

function EmptyState({ onStart }: { onStart: () => void }): JSX.Element {
  return (
    <Card className="flex flex-col items-center text-center px-6 py-14 animate-fade-in">
      <div className="text-accent mb-5">
        <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <circle cx="48" cy="48" r="46" className="stroke-border" strokeWidth="1.5" />
          <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="opacity-90">
            <path d="M30 48v0M39 40v16M48 32v32M57 40v16M66 48v0" />
          </g>
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-fg">{strings.home.emptyTitle}</h3>
      <p className="mt-2 max-w-sm text-sm text-fg-muted leading-relaxed">
        {strings.home.emptyBody}
      </p>
      <Button
        variant="primary"
        className="mt-6"
        onClick={onStart}
        iconLeft={<IconWave size={18} />}
      >
        {strings.home.emptyCta}
      </Button>
    </Card>
  )
}

function MeetingSkeletons(): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-[68px] rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-24 mt-2" />
            </div>
            <div className="skeleton h-6 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function RenameModal({
  meeting,
  onClose,
  onSave
}: {
  meeting: MeetingMeta
  onClose: () => void
  onSave: (id: string, title: string) => void
}): JSX.Element {
  // Mounted fresh per meeting (keyed by id), so initial state is safe here.
  const [value, setValue] = useState(meeting.title)
  const submit = (): void => onSave(meeting.id, value.trim() || strings.recording.untitled)

  return (
    <Modal
      open
      onClose={onClose}
      title={strings.home.renameMeeting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button variant="primary" onClick={submit}>
            {strings.common.save}
          </Button>
        </>
      }
    >
      <Input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
    </Modal>
  )
}

function DeleteModal({
  target,
  onClose,
  onConfirm
}: {
  target: MeetingMeta | null
  onClose: () => void
  onConfirm: (id: string) => void
}): JSX.Element {
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={strings.home.deleteMeeting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button variant="danger" onClick={() => target && onConfirm(target.id)}>
            {strings.common.delete}
          </Button>
        </>
      }
    >
      <p className={cn('text-sm text-fg-muted leading-relaxed')}>
        Mötet <strong className="text-fg">{target?.title || strings.recording.untitled}</strong> och
        dess ljud, transkript och protokoll tas bort permanent. Det går inte att ångra.
      </p>
    </Modal>
  )
}
