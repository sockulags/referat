import { describe, it, expect, beforeEach, vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { rmSync, writeFileSync } from 'node:fs'
import { createProject, deleteProject, getProject, listProjects, updateProject } from './projects'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-projects-'))
  return { app: { getPath: (): string => dir } }
})

const projectsFile = join(app.getPath('userData'), 'projects.json')

beforeEach(() => {
  rmSync(projectsFile, { force: true })
})

describe('projects', () => {
  it('starts empty and lists projects alphabetically', () => {
    expect(listProjects()).toEqual([])
    createProject('Styrgrupp')
    createProject('  Ärendesystem  ')
    createProject('Arbetsmiljö')
    expect(listProjects().map((p) => p.name)).toEqual(['Arbetsmiljö', 'Styrgrupp', 'Ärendesystem'])
  })

  it('creates a project without a default template', () => {
    const p = createProject('Styrgrupp')
    expect(p.defaultTemplateId).toBe('')
    expect(getProject(p.id)).toEqual(p)
  })

  it('rejects a blank name, on create and on rename', () => {
    expect(() => createProject('   ')).toThrow(/namn/)
    const p = createProject('Styrgrupp')
    expect(() => updateProject(p.id, { name: ' ' })).toThrow(/namn/)
    expect(getProject(p.id)?.name).toBe('Styrgrupp')
  })

  it('renames and sets the default template', () => {
    const p = createProject('Styrgrupp')
    updateProject(p.id, { name: 'Styrgruppen', defaultTemplateId: 'beslutslogg' })
    expect(getProject(p.id)).toMatchObject({
      name: 'Styrgruppen',
      defaultTemplateId: 'beslutslogg'
    })
    // Leaving a field out keeps it.
    updateProject(p.id, { name: 'Styrgrupp' })
    expect(getProject(p.id)?.defaultTemplateId).toBe('beslutslogg')
  })

  it('returns null when updating a project that is gone', () => {
    expect(updateProject('nope', { name: 'X' })).toBeNull()
  })

  it('deletes only the given project', () => {
    const a = createProject('A')
    const b = createProject('B')
    deleteProject(a.id)
    expect(listProjects().map((p) => p.id)).toEqual([b.id])
    expect(getProject(undefined)).toBeUndefined()
  })

  it('survives a corrupt or hand-edited file', () => {
    writeFileSync(projectsFile, '{ not json')
    expect(listProjects()).toEqual([])
    writeFileSync(
      projectsFile,
      JSON.stringify([
        { id: 'ok', name: 'Kvar', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'blank', name: '  ', createdAt: '2026-01-01T00:00:00.000Z' },
        'garbage'
      ])
    )
    // A project from a hand edit without defaultTemplateId gets the empty default.
    expect(listProjects()).toEqual([
      { id: 'ok', name: 'Kvar', createdAt: '2026-01-01T00:00:00.000Z', defaultTemplateId: '' }
    ])
  })
})
