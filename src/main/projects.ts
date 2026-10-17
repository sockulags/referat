// Projects group meetings, e.g. a steering group or a customer, and carry the
// settings that differ between those groups: the summary template a new
// recording starts with, and a description the summary model gets as
// background. One JSON file at userData/projects.json.
//
// A meeting points at its project through meta.json (projectId); its folder
// never moves. Meetings without a projectId are "Utan projekt", which is
// where every meeting recorded before projects existed lives.

import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Project, ProjectPatch } from '../shared/types'
import { readJsonArray, writeJsonAtomic } from './jsonFile'

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

/** Projects saved before templates and descriptions existed get empty ones. */
function load(): Project[] {
  return readJsonArray(projectsPath(), isProject).map((p) => ({
    ...p,
    defaultTemplateId: p.defaultTemplateId ?? '',
    description: p.description ?? ''
  }))
}

function save(projects: Project[]): void {
  writeJsonAtomic(projectsPath(), projects)
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
    description: '',
    createdAt: new Date().toISOString()
  }
  projects.push(created)
  save(projects)
  return created
}

export function updateProject(id: string, patch: ProjectPatch): Project | null {
  const projects = load()
  const project = projects.find((p) => p.id === id)
  if (!project) return null
  if (patch.name !== undefined) project.name = cleanName(patch.name)
  if (patch.defaultTemplateId !== undefined) project.defaultTemplateId = patch.defaultTemplateId
  if (patch.description !== undefined) project.description = patch.description.trim()
  save(projects)
  return project
}

/** Removes the project only. Its meetings are moved out by the caller. */
export function deleteProject(id: string): void {
  const projects = load()
  const next = projects.filter((p) => p.id !== id)
  if (next.length !== projects.length) save(next)
}

/**
 * The {{projekt}} block for the summary prompt. Empty without a description:
 * a bare project name tells the model nothing it can use.
 */
export function projectPromptBlock(project: Project | undefined): string {
  const description = project?.description.trim()
  if (!project || !description) return ''
  return [
    `Bakgrund om projektet "${project.name}", skriven av användaren. Använd den för att`,
    'förstå sammanhang, namn och roller — men skriv bara det som faktiskt sades på mötet.',
    '',
    description
  ].join('\n')
}
