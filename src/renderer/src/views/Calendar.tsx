import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { CalendarFetch, CalendarSelection, Project } from '../../../shared/types'
import type { CalendarRow } from '../../../shared/calendar'
import { EMPTY_SELECTION, calendarRows } from '../../../shared/calendar'
import { clock, when } from '../calendarTime'
import { useApp } from '../store'
import { strings } from '../strings'
import { Card } from '../components/ui/Card'
import { Button, IconButton } from '../components/ui/Button'
import { cn } from '../components/ui/cn'
import { ErrorDetail } from '../components/ErrorDetail'
import {
  IconAlert,
  IconCalendar,
  IconCalendarEvent,
  IconPlus,
  IconRepeat,
  IconRetry
} from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'

interface RowActions {
  record: (row: CalendarRow, on: boolean) => void
  skip: (row: CalendarRow) => void
  undoSkip: (row: CalendarRow) => void
}

/**
 * The coming week's Outlook meetings in two lists, soonest first: what referat
 * will record, and the rest. A recurring series is one row, shown by its next
 * occurrence.
 */
export function Calendar(): JSX.Element {
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()
  const toast = useApp((s) => s.toast)
  const inBackground = useApp((s) => s.settings?.runInBackground ?? false)
  const [fetched, setFetched] = useState<CalendarFetch | null>(null)
  const [selection, setSelection] = useState<CalendarSelection>(EMPTY_SELECTION)
  const [projects, setProjects] = useState<Project[]>([])
  const t = strings.calendar

  const load = useCallback(async (): Promise<void> => {
    setFetched(null)
    const [result, saved, projectList] = await Promise.all([
      window.api.listCalendarEvents(),
      window.api.getCalendarSelection(),
      window.api.listProjects()
    ])
    setFetched(result)
    setSelection(saved)
    setProjects(projectList)
  }, [])

  useEffect(() => {
    void (async (): Promise<void> => {
      await load()
    })()
  }, [load])

  const save = async (change: () => Promise<CalendarSelection>): Promise<void> => {
    try {
      setSelection(await change())
    } catch {
      toast(t.saveFailed, 'error')
    }
  }

  const actions: RowActions = {
    record: (row, on) =>
      void save(() =>
        row.kind === 'series'
          ? window.api.setCalendarSeriesRecorded(row.event.seriesId, on)
          : window.api.setCalendarMeetingRecorded(row.event, on)
      ),
    skip: (row) => void save(() => window.api.setCalendarMeetingRecorded(row.event, false)),
    undoSkip: (row) =>
      void save(async () => {
        let latest = selection
        for (const key of row.skipped) {
          latest = await window.api.setCalendarMeetingRecorded({ ...row.event, key }, true)
        }
        return latest
      })
  }

  const now = new Date()

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-fg"
          >
            {t.title}
          </h1>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-fg-muted">{t.description}</p>
        </div>
        <IconButton
          label={t.refresh}
          size="sm"
          disabled={fetched === null}
          onClick={() => void load()}
        >
          <IconRetry size={17} />
        </IconButton>
      </div>

      {fetched === null ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton h-4 w-20 rounded" />
          <div className="skeleton h-28 w-full rounded-xl" />
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-36 w-full rounded-xl" />
        </div>
      ) : fetched.status === 'unavailable' ? (
        <Notice icon={<IconCalendar size={22} />} title={t.unavailableTitle}>
          {t.unavailableBody}
        </Notice>
      ) : fetched.status === 'error' ? (
        <Notice icon={<IconAlert size={22} />} title={t.errorTitle}>
          <ErrorDetail detail={fetched.message} className="mt-2" />
        </Notice>
      ) : (
        <Lists
          rows={calendarRows(fetched.events, selection, now.getTime())}
          seriesProjects={selection.seriesProjects}
          projects={projects}
          now={now}
          actions={actions}
          showHint={!inBackground}
        />
      )}
    </div>
  )
}

function Lists({
  rows,
  seriesProjects,
  projects,
  now,
  actions,
  showHint
}: {
  rows: { recorded: CalendarRow[]; other: CalendarRow[] }
  seriesProjects: Record<string, string>
  projects: Project[]
  now: Date
  actions: RowActions
  showHint: boolean
}): JSX.Element {
  const t = strings.calendar
  if (rows.recorded.length === 0 && rows.other.length === 0) {
    return <Notice icon={<IconCalendar size={22} />}>{t.empty}</Notice>
  }
  const row = (r: CalendarRow): JSX.Element => (
    <Row
      key={`${r.kind}:${r.event.key}`}
      row={r}
      projectName={projects.find((p) => p.id === seriesProjects[r.event.seriesId])?.name}
      now={now}
      actions={actions}
    />
  )
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="cal-recorded">
        <h2 id="cal-recorded" className="mb-2.5 px-1 text-[13px] font-semibold text-fg">
          {t.recordedHeading}
        </h2>
        {rows.recorded.length > 0 ? (
          <Card className="divide-y divide-border overflow-hidden">{rows.recorded.map(row)}</Card>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-5 text-center text-sm text-fg-muted">
            {t.recordedEmpty}
          </p>
        )}
        {rows.recorded.length > 0 && showHint && (
          <p className="mt-2.5 px-1 text-xs leading-relaxed text-fg-subtle">{t.runningHint}</p>
        )}
      </section>

      <section aria-labelledby="cal-other">
        <h2 id="cal-other" className="mb-1 px-1 text-[13px] font-semibold text-fg">
          {t.otherHeading}
        </h2>
        {rows.other.length > 0 ? (
          <div className="divide-y divide-border">{rows.other.map(row)}</div>
        ) : (
          <p className="px-1 py-3 text-sm text-fg-muted">{t.otherEmpty}</p>
        )}
      </section>
    </div>
  )
}

function Row({
  row,
  projectName,
  now,
  actions
}: {
  row: CalendarRow
  projectName: string | undefined
  now: Date
  actions: RowActions
}): JSX.Element {
  const t = strings.calendar
  const { event, recorded, kind } = row
  const series = kind === 'series'
  const allSkipped = series && row.skipped.includes(event.key)
  const meta = [
    series ? t.next(when(event.start, now)) : `${when(event.start, now)}–${clock(event.end)}`,
    event.teamsUrl ? t.teams : event.location,
    series && recorded ? (projectName ? t.project(projectName) : t.newProject) : ''
  ].filter(Boolean)

  return (
    <div className={cn('flex items-center gap-3.5', recorded ? 'px-4 py-3.5' : 'px-1 py-3')}>
      <span
        role="img"
        aria-label={series ? t.recurring : t.single}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
          recorded ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-subtle'
        )}
      >
        {series ? <IconRepeat size={18} /> : <IconCalendarEvent size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">
          {event.subject || strings.recording.untitled}
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          {allSkipped ? t.allSkipped : meta.join(' · ')}
        </p>
        {recorded && row.skipped.length > 0 && (
          <p className="mt-0.5 text-xs text-fg-subtle">
            {t.skipped(row.skipped.length)} ·{' '}
            <button
              type="button"
              onClick={() => actions.undoSkip(row)}
              className="rounded font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t.undoSkip}
            </button>
          </p>
        )}
      </div>
      {recorded ? (
        <div className="flex shrink-0 items-center gap-1">
          {series && !allSkipped && (
            <Button variant="ghost" size="sm" onClick={() => actions.skip(row)}>
              {t.skipNext}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => actions.record(row, false)}>
            {t.stop}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<IconPlus size={15} />}
          onClick={() => actions.record(row, true)}
        >
          {series ? t.recordSeries : t.record}
        </Button>
      )}
    </div>
  )
}

function Notice({
  icon,
  title,
  children
}: {
  icon: ReactNode
  title?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      {title && <p className="text-[15px] font-semibold text-fg">{title}</p>}
      <div className="max-w-md text-sm leading-relaxed text-fg-muted">{children}</div>
    </Card>
  )
}
