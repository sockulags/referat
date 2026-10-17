// A summary across every meeting in a project: where things stand, what has
// been decided so far, what is still open. It reads each meeting's own
// summary rather than its transcript — a project's transcripts together
// would not fit a model's context, and the meeting summaries are already
// what the user has checked and corrected.
//
// Stored per project at userData/project-summaries/<projectId>.json, newest
// last, so earlier overviews stay readable next to a new one.

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { readJsonArray, writeJsonAtomic } from './jsonFile'
import { randomUUID } from 'crypto'
import type { MeetingMeta, ProjectSummary } from '../shared/types'

/** Roughly what fits a mid-sized context window with room for the answer. */
export const MAX_INPUT_CHARS = 100_000

export const PROJECT_OVERVIEW_PROMPT = `Du får sammanfattningar av flera möten i samma projekt, i tidsordning.
Skriv en översikt i Markdown för någon som vill veta läget i projektet, med exakt dessa rubriker:

## Läget just nu
2–4 meningar om var projektet står efter det senaste mötet.

## Beslut hittills
Punktlista med besluten i tidsordning, med mötets datum inom parentes, t.ex.
"- Introduktionsdagen flyttas till den 15:e (12 okt)". Har ett senare möte ändrat ett beslut,
skriv det gällande beslutet och nämn ändringen. Skriv "Inga beslut har fattats." om inga finns.

## Öppna actionpunkter
Punktlista med uppgifter som inte uppenbart har slutförts i ett senare möte. Ange ägare och
deadline där det framgår. Skriv "Inga öppna actionpunkter." om inga finns.

## Öppna frågor
Punktlista med frågor som fortfarande är olösta. Skriv "Inga öppna frågor." om inga finns.

Regler:
- Svara på samma språk som mötessammanfattningarna är skrivna på.
- Använd endast information som finns i mötessammanfattningarna. Hitta aldrig på namn, beslut eller siffror.
- Var koncis och saklig.

{{projekt}}

{{ordlista}}

{{fokus}}

Mötessammanfattningar:
{{transcript}}`

export interface MeetingInput {
  meta: Pick<MeetingMeta, 'title' | 'createdAt'>
  /** The meeting's summary; meetings without one are skipped. */
  markdown: string | undefined
}

/**
 * Lay the meetings out oldest first, one heading each. When they do not all
 * fit, the oldest are left out: the current state of a project lives in its
 * latest meetings.
 */
export function buildProjectInput(meetings: MeetingInput[]): {
  text: string
  included: number
  leftOut: number
} {
  const withSummary = meetings
    .filter((m) => m.markdown?.trim())
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt))
  const blocks = withSummary.map(
    (m) => `### ${m.meta.title} (${m.meta.createdAt.slice(0, 10)})\n\n${m.markdown!.trim()}`
  )
  const kept: string[] = []
  let size = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (kept.length > 0 && size + blocks[i].length > MAX_INPUT_CHARS) break
    kept.unshift(blocks[i])
    size += blocks[i].length + 2
  }
  return {
    text: kept.join('\n\n'),
    included: kept.length,
    leftOut: blocks.length - kept.length
  }
}

function dir(): string {
  return join(app.getPath('userData'), 'project-summaries')
}

function file(projectId: string): string {
  // Project ids are UUIDs we generated, but never let one walk out of the folder.
  return join(dir(), `${projectId.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
}

function isSummary(value: unknown): value is ProjectSummary {
  const s = value as ProjectSummary
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof s.id === 'string' &&
    typeof s.createdAt === 'string' &&
    typeof s.focus === 'string' &&
    typeof s.markdown === 'string' &&
    typeof s.meetingCount === 'number'
  )
}

export function listProjectSummaries(projectId: string): ProjectSummary[] {
  return readJsonArray(file(projectId), isSummary)
}

function save(projectId: string, summaries: ProjectSummary[]): void {
  mkdirSync(dir(), { recursive: true })
  writeJsonAtomic(file(projectId), summaries)
}

export function addProjectSummary(
  projectId: string,
  summary: Omit<ProjectSummary, 'id' | 'createdAt'>
): ProjectSummary {
  const created: ProjectSummary = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...summary
  }
  save(projectId, [...listProjectSummaries(projectId), created])
  return created
}

export function deleteProjectSummary(projectId: string, summaryId: string): void {
  const list = listProjectSummaries(projectId)
  const next = list.filter((s) => s.id !== summaryId)
  if (next.length !== list.length) save(projectId, next)
}

/** A deleted project's overviews go with it. */
export function deleteProjectSummaries(projectId: string): void {
  rmSync(file(projectId), { force: true })
}
