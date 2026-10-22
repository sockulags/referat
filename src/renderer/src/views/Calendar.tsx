import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  CalendarEvent,
  CalendarFetch,
  CalendarSelection,
  Project
} from '../../../shared/types'
import { EMPTY_SELECTION, groupByDay, isRecorded, localDay } from '../../../shared/calendar'
import { MONTHS_SHORT } from '../../../shared/dates'
import { useApp } from '../store'
import { strings } from '../strings'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ErrorDetail } from '../components/ErrorDetail'
import { IconAlert, IconCalendar, IconRetry } from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'

const WEEKDAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag']

/** "Idag", "Imorgon" or "torsdag 24 okt" for a local "YYYY-MM-DD". */
function dayLabel(day: string, now: Date): string {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (day === localDay(now.toISOString())) return strings.calendar.today
  if (day === localDay(tomorrow.toISOString())) return strings.calendar.tomorrow
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS_SHORT[m - 1]}`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

/**
 * The coming week's Outlook meetings, each with a tick for recording it by
 * itself, and recurring ones with a tick for the whole series.
 */
export function Calendar(): JSX.Element {
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()
  const toast = useApp((s) => s.toast)
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

  const save = async (change: Promise<CalendarSelection>): Promise<void> => {
    try {
      setSelection(await change)
    } catch {
      toast(t.saveFailed, 'error')
    }
  }

  const now = new Date()

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-lg">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-fg"
          >
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t.description}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<IconRetry size={16} />}
          disabled={fetched === null}
          onClick={() => void load()}
        >
          {t.refresh}
        </Button>
      </div>

      {fetched === null ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton h-5 w-24 rounded" />
          <div className="skeleton h-20 w-full rounded-xl" />
          <div className="skeleton h-20 w-full rounded-xl" />
        </div>
      ) : fetched.status === 'unavailable' ? (
        <Notice icon={<IconCalendar size={22} />} title={t.unavailableTitle}>
          {t.unavailableBody}
        </Notice>
      ) : fetched.status === 'error' ? (
        <Notice icon={<IconAlert size={22} />} title={t.errorTitle}>
          <ErrorDetail detail={fetched.message} className="mt-2" />
        </Notice>
      ) : fetched.events.length === 0 ? (
        <Notice icon={<IconCalendar size={22} />}>{t.empty}</Notice>
      ) : (
        <>
          <p className="mb-5 text-xs leading-relaxed text-fg-subtle">{t.runningHint}</p>
          <div className="flex flex-col gap-6">
            {groupByDay(fetched.events).map(({ day, events }) => (
              <section key={day} aria-label={dayLabel(day, now)}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {dayLabel(day, now)}
                </h2>
                <div className="flex flex-col gap-2">
                  {events.map((event) => (
                    <EventRow
                      key={event.key}
                      event={event}
                      selection={selection}
                      projects={projects}
                      past={Date.parse(event.end) <= now.getTime()}
                      onRecord={(on) => void save(window.api.setCalendarMeetingRecorded(event, on))}
                      onSeries={(on) =>
                        void save(window.api.setCalendarSeriesRecorded(event.seriesId, on))
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
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

function EventRow({
  event,
  selection,
  projects,
  past,
  onRecord,
  onSeries
}: {
  event: CalendarEvent
  selection: CalendarSelection
  projects: Project[]
  past: boolean
  onRecord: (on: boolean) => void
  onSeries: (on: boolean) => void
}): JSX.Element {
  const t = strings.calendar
  const recorded = isRecorded(event, selection)
  const seriesOn = event.recurring && selection.series.includes(event.seriesId)
  const project = projects.find((p) => p.id === selection.seriesProjects[event.seriesId])

  return (
    <Card className={past ? 'opacity-60' : undefined}>
      <div className="flex items-start gap-4 px-4 py-3">
        <div className="w-24 shrink-0 pt-0.5 text-sm tabular-nums text-fg-muted">
          {clock(event.start)}–{clock(event.end)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            {event.subject || strings.recording.untitled}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {event.teamsUrl && <Chip>{t.teams}</Chip>}
            {event.recurring && <Chip>{t.recurring}</Chip>}
            {event.location && !event.teamsUrl && (
              <span className="truncate text-xs text-fg-subtle">{event.location}</span>
            )}
          </div>
          {seriesOn && (
            <p className="mt-1.5 text-xs text-fg-subtle">
              {project ? t.seriesProject(project.name) : t.seriesNewProject}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <Tick checked={recorded} disabled={past} onChange={onRecord}>
            {t.record}
          </Tick>
          {event.recurring && (
            <Tick checked={seriesOn} onChange={onSeries} subtle>
              {t.wholeSeries}
            </Tick>
          )}
        </div>
      </div>
    </Card>
  )
}

function Chip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 text-[11px] font-medium text-fg-muted">
      {children}
    </span>
  )
}

function Tick({
  checked,
  disabled,
  subtle,
  onChange,
  children
}: {
  checked: boolean
  disabled?: boolean
  subtle?: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}): JSX.Element {
  return (
    <label
      className={
        subtle
          ? 'flex cursor-pointer items-center gap-2 text-xs text-fg-muted'
          : 'flex cursor-pointer items-center gap-2 text-sm font-medium text-fg'
      }
    >
      {children}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-default"
      />
    </label>
  )
}
