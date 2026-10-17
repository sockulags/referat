import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ActionItem, MeetingDetail } from '../../../shared/types'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatTimestamp } from '../format'
import { Button, IconButton } from './ui/Button'
import { Card } from './ui/Card'
import { IconPlus, IconTrash } from './icons'

/** How long typing may pause before the list is saved. */
const SAVE_DELAY_MS = 400

const inputClass =
  'h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle ' +
  'focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring'

/**
 * The meeting's action items, editable. referat hands them off and does not
 * track them, so there is no status; changes save on their own. A meeting
 * recorded before the pipeline took them out offers to do it here.
 *
 * Mount it keyed on the meeting and on whether items exist, so a reload of
 * the meeting while the user types does not reset what they typed.
 */
export function ActionItems({
  meeting,
  onChanged,
  onPlayFrom
}: {
  meeting: MeetingDetail
  onChanged: () => Promise<void>
  onPlayFrom?: (sec: number) => void
}): JSX.Element | null {
  const toast = useApp((s) => s.toast)
  const [extracting, setExtracting] = useState(false)
  const [draft, setDraft] = useState<ActionItem[] | undefined>(meeting.actionItems)
  const [focusId, setFocusId] = useState<string | null>(null)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; items: ActionItem[] } | null>(null)
  const meetingId = meeting.id

  const flush = useRef((): void => {})
  useEffect(() => {
    flush.current = (): void => {
      const job = pending.current
      if (!job) return
      clearTimeout(job.timer)
      pending.current = null
      window.api.updateActionItems(meetingId, job.items).catch(() => {
        toast(strings.meeting.actionItemsSaveFailed, 'error')
      })
    }
  }, [meetingId, toast])
  // Leaving the meeting must not drop the last few keystrokes.
  useEffect(() => () => flush.current(), [])

  const processing = meeting.status !== 'done' && meeting.status !== 'error'
  if (!draft && (processing || !meeting.transcript)) return null

  const change = (next: ActionItem[]): void => {
    setDraft(next)
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { items: next, timer: setTimeout(() => flush.current(), SAVE_DELAY_MS) }
  }
  const update = (id: string, patch: Partial<ActionItem>): void =>
    change((draft ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const remove = (id: string): void => change((draft ?? []).filter((item) => item.id !== id))
  const add = (): void => {
    const item: ActionItem = { id: crypto.randomUUID(), text: '', owner: '', due: '' }
    setFocusId(item.id)
    change([...(draft ?? []), item])
  }

  const extract = async (): Promise<void> => {
    setExtracting(true)
    try {
      await window.api.extractActionItems(meeting.id)
      await onChanged()
    } catch {
      toast(strings.meeting.actionItemsFailed, 'error')
    } finally {
      setExtracting(false)
    }
  }

  // Everyone the transcript names, as suggestions for the owner field.
  const people = [...new Set(Object.values(meeting.transcript?.speakers ?? {}))].filter(Boolean)
  const peopleListId = `action-item-people-${meeting.id}`

  return (
    <section aria-labelledby="action-items-title" className="mt-6">
      <h2 id="action-items-title" className="pb-3 text-base font-semibold text-fg">
        {strings.meeting.actionItemsTitle}
      </h2>
      <Card className="px-6 py-5">
        {!draft ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">{strings.meeting.actionItemsMissing}</p>
            <Button variant="secondary" size="sm" onClick={extract} loading={extracting}>
              {strings.meeting.actionItemsExtract}
            </Button>
          </div>
        ) : (
          <>
            {draft.length === 0 ? (
              <p className="text-sm text-fg-muted">{strings.meeting.actionItemsNone}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {draft.map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    peopleListId={peopleListId}
                    autoFocus={item.id === focusId}
                    onChange={(patch) => update(item.id, patch)}
                    onRemove={() => remove(item.id)}
                    onPlayFrom={onPlayFrom}
                  />
                ))}
              </ul>
            )}
            <datalist id={peopleListId}>
              {people.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 -ml-2 text-accent"
              onClick={add}
              iconLeft={<IconPlus size={16} />}
            >
              {strings.meeting.actionItemAdd}
            </Button>
          </>
        )}
      </Card>
    </section>
  )
}

function ActionItemRow({
  item,
  peopleListId,
  autoFocus,
  onChange,
  onRemove,
  onPlayFrom
}: {
  item: ActionItem
  peopleListId: string
  autoFocus: boolean
  onChange: (patch: Partial<ActionItem>) => void
  onRemove: () => void
  onPlayFrom?: (sec: number) => void
}): JSX.Element {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <input
          value={item.text}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={strings.meeting.actionItemTextPlaceholder}
          aria-label={strings.meeting.actionItemText}
          className={`${inputClass} min-w-0 flex-1 text-[15px]`}
        />
        <IconButton
          size="sm"
          label={strings.meeting.actionItemDelete}
          onClick={onRemove}
          className="hover:text-danger"
        >
          <IconTrash size={16} />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <input
          value={item.owner}
          list={peopleListId}
          onChange={(e) => onChange({ owner: e.target.value })}
          placeholder={strings.meeting.actionItemOwner}
          aria-label={strings.meeting.actionItemOwner}
          className={`${inputClass} w-44`}
        />
        <input
          type="date"
          value={item.due}
          onChange={(e) => onChange({ due: e.target.value })}
          aria-label={strings.meeting.actionItemDueLabel}
          className={`${inputClass} w-40`}
        />
        {item.atSec !== undefined &&
          (onPlayFrom ? (
            <button
              type="button"
              onClick={() => onPlayFrom(item.atSec ?? 0)}
              aria-label={strings.meeting.playFrom(formatTimestamp(item.atSec))}
              className="tabular-nums text-accent underline-offset-2 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {strings.meeting.actionItemAt(formatTimestamp(item.atSec))}
            </button>
          ) : (
            <span className="tabular-nums">
              {strings.meeting.actionItemAt(formatTimestamp(item.atSec))}
            </span>
          ))}
      </div>
    </li>
  )
}
