import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { MeetingMeta, Project, SummaryTemplate } from '../../../shared/types'
import { resolveStartTemplateId } from '../../../shared/projects'
import { useApp, type ProjectFilter } from '../store'
import { strings } from '../strings'
import { formatRelativeDate, formatDuration } from '../format'
import { Button, IconButton } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { StatusChip } from '../components/ui/StatusChip'
import { Modal } from '../components/ui/Modal'
import { Input, Select } from '../components/ui/Field'
import { Tooltip } from '../components/ui/Tooltip'
import { useAutofocusHeading } from '../components/useAutofocusHeading'
import {
  IconMic,
  IconWave,
  IconPencil,
  IconTrash,
  IconRetry,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconPlus,
  IconSettings
} from '../components/icons'
import { cn } from '../components/ui/cn'

export function Home(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const setPendingTitle = useApp((s) => s.setPendingTitle)
  const toast = useApp((s) => s.toast)

  const settings = useApp((s) => s.settings)
  const setPendingTemplateId = useApp((s) => s.setPendingTemplateId)
  const pendingTemplateId = useApp((s) => s.pendingTemplateId)
  const setPendingStart = useApp((s) => s.setPendingStart)
  const projectFilter = useApp((s) => s.projectFilter)
  const setProjectFilter = useApp((s) => s.setProjectFilter)

  const [title, setTitle] = useState('')
  const [meetings, setMeetings] = useState<MeetingMeta[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [creatingProject, setCreatingProject] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [moveTarget, setMoveTarget] = useState<MeetingMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<MeetingMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MeetingMeta | null>(null)
  const headingRef = useAutofocusHeading<HTMLHeadingElement>()

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, projectList] = await Promise.all([
        window.api.listMeetings(),
        window.api.listProjects()
      ])
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setMeetings(list)
      setProjects(projectList)
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

  // A remembered filter can point at a project deleted since; show everything then.
  const project = projects.find((p) => p.id === projectFilter)
  const filter: ProjectFilter =
    projectFilter === 'all' || projectFilter === 'none' || project ? projectFilter : 'all'
  const visible = meetings.filter((m) =>
    filter === 'all' ? true : filter === 'none' ? !m.projectId : m.projectId === filter
  )
  const projectName = (id: string | undefined): string | undefined =>
    projects.find((p) => p.id === id)?.name

  const templates = settings?.summary.templates ?? []
  const templateId = resolveStartTemplateId(templates, {
    picked: pendingTemplateId,
    project,
    lastUsed: settings?.summary.defaultTemplateId
  })

  const start = (): void => {
    setPendingTitle(title.trim())
    setPendingStart({ templateId, projectId: project?.id ?? '' })
    navigate('recording')
  }

  const doCreateProject = async (name: string): Promise<void> => {
    const created = await window.api.createProject(name)
    setCreatingProject(false)
    await load()
    setProjectFilter(created.id)
    toast(strings.projects.created)
  }

  const doSaveProject = async (
    id: string,
    patch: { name: string; defaultTemplateId: string }
  ): Promise<void> => {
    await window.api.updateProject(id, patch)
    setEditingProject(null)
    await load()
    toast(strings.common.saved)
  }

  const doDeleteProject = async (id: string): Promise<void> => {
    await window.api.deleteProject(id)
    setEditingProject(null)
    setProjectFilter('all')
    await load()
    toast(strings.projects.deleted)
  }

  const doMove = async (id: string, projectId: string | null): Promise<void> => {
    await window.api.setMeetingProject(id, projectId)
    setMoveTarget(null)
    await load()
    toast(strings.projects.moved)
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
      <ProjectBar
        projects={projects}
        filter={filter}
        onFilter={setProjectFilter}
        onNew={() => setCreatingProject(true)}
        onSettings={project ? () => setEditingProject(project) : undefined}
      />

      <Hero
        title={title}
        setTitle={setTitle}
        templates={templates}
        templateId={templateId}
        setTemplateId={setPendingTemplateId}
        projectName={project?.name}
        onStart={start}
      />

      <section className="mt-12">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3"
        >
          {strings.home.previousMeetings}
        </h2>

        {loading ? (
          <MeetingSkeletons />
        ) : meetings.length === 0 ? (
          <EmptyState onStart={start} />
        ) : visible.length === 0 ? (
          <Card className="px-6 py-8 text-center text-sm text-fg-muted leading-relaxed animate-fade-in">
            {filter === 'none' ? strings.projects.emptyNone : strings.projects.emptyProject}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((m, i) => (
              <li key={m.id}>
                <MeetingRow
                  meeting={m}
                  index={i}
                  projectName={filter === 'all' ? projectName(m.projectId) : undefined}
                  onOpen={() => navigate('meeting', m.id)}
                  onRename={() => setRenameTarget(m)}
                  onMove={() => setMoveTarget(m)}
                  onDelete={() => setDeleteTarget(m)}
                  onRetry={() => doRetry(m.id)}
                />
              </li>
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
      {creatingProject && (
        <CreateProjectModal onClose={() => setCreatingProject(false)} onCreate={doCreateProject} />
      )}
      {editingProject && (
        <ProjectSettingsModal
          key={editingProject.id}
          project={editingProject}
          templates={templates}
          meetingCount={meetings.filter((m) => m.projectId === editingProject.id).length}
          onClose={() => setEditingProject(null)}
          onSave={doSaveProject}
          onDelete={doDeleteProject}
        />
      )}
      {moveTarget && (
        <MoveModal
          key={moveTarget.id}
          meeting={moveTarget}
          projects={projects}
          onClose={() => setMoveTarget(null)}
          onMove={doMove}
        />
      )}
    </div>
  )
}

/** Filter chips: every meeting, those outside any project, or one project. */
function ProjectBar({
  projects,
  filter,
  onFilter,
  onNew,
  onSettings
}: {
  projects: Project[]
  filter: ProjectFilter
  onFilter: (f: ProjectFilter) => void
  onNew: () => void
  onSettings?: () => void
}): JSX.Element {
  const chip = (value: ProjectFilter, label: string): JSX.Element => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => onFilter(value)}
      className={cn(
        'h-8 max-w-56 truncate rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        filter === value
          ? 'border-accent bg-accent-soft text-accent-soft-fg font-medium'
          : 'border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-2'
      )}
    >
      {label}
    </button>
  )
  return (
    <nav
      aria-label={strings.projects.filterLabel}
      className="mb-6 flex flex-wrap items-center gap-2"
    >
      {chip('all', strings.projects.all)}
      {chip('none', strings.projects.none)}
      {projects.map((p) => chip(p.id, p.name))}
      <Button variant="ghost" size="sm" onClick={onNew} iconLeft={<IconPlus size={16} />}>
        {strings.projects.newProject}
      </Button>
      {onSettings && (
        <Tooltip label={strings.projects.settings}>
          <IconButton label={strings.projects.settings} size="sm" onClick={onSettings}>
            <IconSettings size={17} />
          </IconButton>
        </Tooltip>
      )}
    </nav>
  )
}

function Hero({
  title,
  setTitle,
  templates,
  templateId,
  setTemplateId,
  projectName,
  onStart
}: {
  title: string
  setTitle: (t: string) => void
  templates: SummaryTemplate[]
  templateId: string
  setTemplateId: (id: string) => void
  projectName?: string
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

      <p className="text-sm font-medium text-accent mb-4">
        {projectName ? strings.projects.recordingInto(projectName) : strings.home.heroKicker}
      </p>

      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        iconLeft={<IconMic size={20} />}
        className="mx-auto h-14 px-8 text-base rounded-full shadow-float"
      >
        {strings.home.startRecording}
      </Button>

      <div className="mt-6 max-w-sm mx-auto flex flex-col gap-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={strings.home.titlePlaceholder}
          className="text-center"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onStart()
          }}
        />
        {templates.length > 1 && (
          <Select
            label={strings.home.summaryTemplate}
            hint={strings.home.summaryTemplateHint}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Card>
  )
}

function MeetingRow({
  meeting,
  index,
  projectName,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onRetry
}: {
  meeting: MeetingMeta
  index: number
  /** Shown when the list mixes projects. */
  projectName?: string
  onOpen: () => void
  onRename: () => void
  onMove: () => void
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
              {projectName && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <IconFolder size={13} className="shrink-0" />
                  <span className="truncate">{projectName}</span>
                </span>
              )}
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
            <Tooltip label={strings.home.moveMeeting}>
              <IconButton label={strings.home.moveMeeting} size="sm" onClick={onMove}>
                <IconFolder size={16} />
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

function CreateProjectModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}): JSX.Element {
  const [name, setName] = useState('')
  const submit = (): void => {
    if (name.trim()) void onCreate(name)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={strings.projects.newProject}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {strings.projects.create}
          </Button>
        </>
      }
    >
      <Input
        label={strings.projects.nameLabel}
        value={name}
        autoFocus
        placeholder={strings.projects.namePlaceholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
    </Modal>
  )
}

function ProjectSettingsModal({
  project,
  templates,
  meetingCount,
  onClose,
  onSave,
  onDelete
}: {
  project: Project
  templates: SummaryTemplate[]
  meetingCount: number
  onClose: () => void
  onSave: (id: string, patch: { name: string; defaultTemplateId: string }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}): JSX.Element {
  // Mounted fresh per project (keyed by id), so initial state is safe here.
  const [name, setName] = useState(project.name)
  const [defaultTemplateId, setDefaultTemplateId] = useState(
    templates.some((t) => t.id === project.defaultTemplateId) ? project.defaultTemplateId : ''
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (confirmDelete) {
    return (
      <Modal
        open
        onClose={() => setConfirmDelete(false)}
        title={strings.projects.deleteTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {strings.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void onDelete(project.id)}>
              {strings.projects.deleteConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted leading-relaxed">
          {strings.projects.deleteBody(project.name, meetingCount)}
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={strings.projects.settings}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto hover:text-danger"
            onClick={() => setConfirmDelete(true)}
            iconLeft={<IconTrash size={16} />}
          >
            {strings.projects.deleteProject}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => void onSave(project.id, { name, defaultTemplateId })}
          >
            {strings.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label={strings.projects.nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label={strings.projects.defaultTemplate}
          hint={strings.projects.defaultTemplateHint}
          value={defaultTemplateId}
          onChange={(e) => setDefaultTemplateId(e.target.value)}
        >
          <option value="">{strings.projects.defaultTemplateNone}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  )
}

function MoveModal({
  meeting,
  projects,
  onClose,
  onMove
}: {
  meeting: MeetingMeta
  projects: Project[]
  onClose: () => void
  onMove: (id: string, projectId: string | null) => Promise<void>
}): JSX.Element {
  const [target, setTarget] = useState(meeting.projectId ?? '')
  return (
    <Modal
      open
      onClose={onClose}
      title={strings.projects.moveTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={target === (meeting.projectId ?? '')}
            onClick={() => void onMove(meeting.id, target || null)}
          >
            {strings.projects.move}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-muted">
        <strong className="text-fg">{meeting.title || strings.recording.untitled}</strong>
      </p>
      <Select
        label={strings.projects.moveLabel}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">{strings.projects.none}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Modal>
  )
}
