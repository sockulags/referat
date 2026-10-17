import { describe, it, expect, beforeEach, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import {
  addProjectSummary,
  buildProjectInput,
  deleteProjectSummaries,
  deleteProjectSummary,
  listProjectSummaries,
  MAX_INPUT_CHARS,
  PROJECT_OVERVIEW_PROMPT,
  type MeetingInput
} from './projectSummary'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-project-summaries-'))
  return { app: { getPath: (): string => dir } }
})

function meeting(title: string, createdAt: string, markdown: string | undefined): MeetingInput {
  return { meta: { title, createdAt }, markdown }
}

describe('buildProjectInput', () => {
  it('lays meetings out oldest first, one heading each, skipping those without a summary', () => {
    const input = buildProjectInput([
      meeting('Tredje', '2026-10-12T09:00:00.000Z', '## Beslut\n- C'),
      meeting('Första', '2026-09-28T09:00:00.000Z', '## Beslut\n- A'),
      meeting('Pågår', '2026-10-13T09:00:00.000Z', undefined),
      meeting('Tom', '2026-10-01T09:00:00.000Z', '   ')
    ])
    expect(input.text).toBe(
      '### Första (2026-09-28)\n\n## Beslut\n- A\n\n### Tredje (2026-10-12)\n\n## Beslut\n- C'
    )
    expect(input).toMatchObject({ included: 2, leftOut: 0 })
  })

  it('leaves the oldest meetings out when they do not all fit', () => {
    const big = 'x'.repeat(MAX_INPUT_CHARS / 2)
    const input = buildProjectInput([
      meeting('Äldst', '2026-01-01T00:00:00.000Z', big),
      meeting('Mitten', '2026-02-01T00:00:00.000Z', big),
      meeting('Nyast', '2026-03-01T00:00:00.000Z', big)
    ])
    expect(input.included).toBe(1)
    expect(input.leftOut).toBe(2)
    expect(input.text.startsWith('### Nyast')).toBe(true)
  })

  it('always keeps the newest meeting, even one that is too long on its own', () => {
    const input = buildProjectInput([
      meeting('Jätte', '2026-03-01T00:00:00.000Z', 'x'.repeat(MAX_INPUT_CHARS + 10))
    ])
    expect(input.included).toBe(1)
  })

  it('is empty when no meeting has a summary', () => {
    expect(buildProjectInput([meeting('Pågår', '2026-01-01T00:00:00.000Z', undefined)])).toEqual({
      text: '',
      included: 0,
      leftOut: 0
    })
  })
})

describe('project summary store', () => {
  beforeEach(() => {
    rmSync(join(app.getPath('userData'), 'project-summaries'), { recursive: true, force: true })
  })

  it('keeps overviews per project, oldest first', () => {
    const a = addProjectSummary('p1', { focus: '', markdown: 'A', meetingCount: 2 })
    const b = addProjectSummary('p1', { focus: 'budgeten', markdown: 'B', meetingCount: 3 })
    addProjectSummary('p2', { focus: '', markdown: 'Annat', meetingCount: 1 })
    expect(listProjectSummaries('p1').map((s) => s.id)).toEqual([a.id, b.id])
    expect(listProjectSummaries('p1')[1]).toMatchObject({ focus: 'budgeten', meetingCount: 3 })
  })

  it('deletes one overview, or all of a deleted project', () => {
    const a = addProjectSummary('p1', { focus: '', markdown: 'A', meetingCount: 1 })
    const b = addProjectSummary('p1', { focus: '', markdown: 'B', meetingCount: 1 })
    deleteProjectSummary('p1', a.id)
    expect(listProjectSummaries('p1').map((s) => s.id)).toEqual([b.id])
    deleteProjectSummaries('p1')
    expect(listProjectSummaries('p1')).toEqual([])
  })

  it('never lets a project id point outside its folder', () => {
    addProjectSummary('../../etc', { focus: '', markdown: 'A', meetingCount: 1 })
    expect(listProjectSummaries('etc')).toHaveLength(1)
  })
})

describe('PROJECT_OVERVIEW_PROMPT', () => {
  it('takes the project background, glossary, focus and the meetings', () => {
    for (const placeholder of ['{{projekt}}', '{{ordlista}}', '{{fokus}}', '{{transcript}}']) {
      expect(PROJECT_OVERVIEW_PROMPT).toContain(placeholder)
    }
  })
})
