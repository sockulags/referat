// Projects group meetings, e.g. a steering group or a customer, and carry the
// settings that differ between those groups — for now the summary template a
// new recording starts with. One JSON file at userData/projects.json.
//
// A meeting points at its project through meta.json (projectId); its folder
// never moves. Meetings without a projectId are "Utan projekt", which is
// where every meeting recorded before projects existed lives.

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { Project } from '../shared/types'

function projectsPath(): string {
  return join(app.getPath('userData'), 'projects.json')
}

function isProject(value: unknown): value is Project {
  const p = value as Project
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    typeof p.createdAt === 'string'
  )
}

/** Defensive read: a missing, corrupt or hand-edited file yields no projects. */
function load(): Project[] {
  try {
    const path = projectsPath()
    if (!existsSync(path)) return []
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isProject)
      .map((p) => ({ ...p, defaultTemplateId: p.defaultTemplateId ?? '' }))
  } catch {
    return []
  }
}

function save(projects: Project[]): void {
  writeFileSync(projectsPath(), JSON.stringify(projects, null, 2), 'utf-8')
}

function cleanName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('Projektet behöver ett namn')
  return clean
}

/** Alphabetical, the way the project picker shows them. */
export function listProjects(): Project[] {
  return load().sort((a, b) => a.name.localeCompare(b.name, 'sv'))
}

export function getProject(id: string | undefined): Project | undefined {
  if (!id) return undefined
  return load().find((p) => p.id === id)
}

export function createProject(name: string): Project {
  const projects = load()
  const created: Project = {
    id: randomUUID(),
    name: cleanName(name),
    defaultTemplateId: '',
    createdAt: new Date().toISOString()
  }
  projects.push(created)
  save(projects)
  return created
}

export function updateProject(
  id: string,
  patch: { name?: string; defaultTemplateId?: string }
): Project | null {
  const projects = load()
  const project = projects.find((p) => p.id === id)
  if (!project) return null
  if (patch.name !== undefined) project.name = cleanName(patch.name)
  if (patch.defaultTemplateId !== undefined) project.defaultTemplateId = patch.defaultTemplateId
  save(projects)
  return project
}

/** Removes the project only. Its meetings are moved out by the caller. */
export function deleteProject(id: string): void {
  const projects = load()
  const next = projects.filter((p) => p.id !== id)
  if (next.length !== projects.length) save(next)
}
