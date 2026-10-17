import type { JSX, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Project, SearchFilter, SearchHit, SearchResult } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatRelativeDate, formatTimestamp } from '../format'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Field'
import { Spinner } from '../components/ui/Spinner'
import { IconSearch } from '../components/icons'
import { useAutofocusHeading } from '../components/useAutofocusHeading'

/** How long typing may pause before searching. */
const SEARCH_DELAY_MS = 250

const TIME_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: 'all', label: strings.search.allTime, days: null },
  { value: '30', label: strings.search.last30, days: 30 },
  { value: '90', label: strings.search.last90, days: 90 },
  { value: '365', label: strings.search.last365, days: 365 }
]

/** The query's words marked in a piece of text, case-insensitively. */
function highlight(text: string, query: string): ReactNode {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return text
  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'))
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent-soft-fg">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export function Search(): JSX.Element {
  const openMeetingAt = useApp((s) => s.openMeetingAt)
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('all')
  const [time, setTime] = useState('all')
  const [projects, setProjects] = useState<Project[]>([])
  const [results, setResults] = useState<{ query: string; items: SearchResult[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    let cancelled = false
    void window.api.listProjects().then((list) => {
      if (!cancelled) setProjects(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Search a moment after typing stops; only the newest search may answer.
  const run = useRef<ReturnType<typeof setTimeout> | null>(null)
  const search = (next: { query: string; projectId: string; time: string }): void => {
    if (run.current) clearTimeout(run.current)
    const request = ++latest.current
    if (!next.query.trim()) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    run.current = setTimeout(() => {
      const filter: SearchFilter = {
        projectId: next.projectId,
        sinceDays: TIME_OPTIONS.find((o) => o.value === next.time)?.days ?? null
      }
      window.api
        .searchMeetings(next.query, filter)
        .then((items) => {
          if (request === latest.current) setResults({ query: next.query, items })
        })
        .catch(() => {
          if (request === latest.current) setResults({ query: next.query, items: [] })
        })
        .finally(() => {
          if (request === latest.current) setSearching(false)
        })
    }, SEARCH_DELAY_MS)
  }

  const openHit = (result: SearchResult, hit: SearchHit): void => {
    if (hit.kind === 'transcript') {
      openMeetingAt(result.meetingId, { tab: 'transcript', atSec: hit.startSec })
    } else {
      openMeetingAt(result.meetingId, { tab: 'protocol' })
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-fg outline-none"
      >
        {strings.search.title}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">{strings.search.intro}</p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-[2_1_280px]">
          <Input
            label={strings.search.label}
            type="search"
            value={query}
            placeholder={strings.search.placeholder}
            iconLeft={<IconSearch size={16} />}
            onChange={(e) => {
              setQuery(e.target.value)
              search({ query: e.target.value, projectId, time })
            }}
          />
        </div>
        <div className="flex-[1_1_160px]">
          <Select
            label={strings.search.project}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              search({ query, projectId: e.target.value, time })
            }}
          >
            <option value="all">{strings.search.allProjects}</option>
            <option value="none">{strings.search.noProject}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-[1_1_160px]">
          <Select
            label={strings.search.time}
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              search({ query, projectId, time: e.target.value })
            }}
          >
            {TIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div aria-live="polite" className="mt-6">
        {searching && !results ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : results ? (
          results.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-muted">{strings.search.none}</p>
          ) : (
            <>
              <p className="pb-3 text-sm text-fg-muted">
                {strings.search.count(results.items.length)}
              </p>
              <ul className="flex flex-col gap-3">
                {results.items.map((result) => (
                  <li key={result.meetingId}>
                    <Card className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => openMeetingAt(result.meetingId, { tab: 'protocol' })}
                        className="text-left text-[15px] font-semibold text-fg hover:text-accent rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {result.title}
                      </button>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {formatRelativeDate(result.createdAt)}
                      </p>
                      <ul className="mt-3 flex flex-col gap-1">
                        {result.hits.map((hit, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => openHit(result, hit)}
                              className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              <span className="w-24 shrink-0 text-xs text-fg-subtle pt-0.5 tabular-nums">
                                {hit.kind === 'transcript'
                                  ? formatTimestamp(hit.startSec)
                                  : strings.search.inProtocol(hit.templateName)}
                              </span>
                              <span className="min-w-0 flex-1 leading-relaxed text-fg">
                                {hit.kind === 'transcript' && hit.speaker && (
                                  <span className="font-medium text-fg-muted">{hit.speaker}: </span>
                                )}
                                {highlight(hit.text, results.query)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {result.total > result.hits.length && (
                        <p className="mt-1 px-2 text-xs text-fg-subtle">
                          {strings.search.more(result.total - result.hits.length)}
                        </p>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
