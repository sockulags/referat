// Which summary template a new recording starts with. Shared so the home
// view preselects exactly what main would fall back to.

import type { Project, SummaryTemplate } from './types'

/**
 * In order: what the user picked for this recording, the project's default,
 * then the template last used outside any project. Ids that no longer exist
 * (a deleted template) are skipped rather than trusted.
 */
export function resolveStartTemplateId(
  templates: SummaryTemplate[],
  opts: { picked?: string; project?: Project; lastUsed?: string }
): string {
  const exists = (id: string | undefined): id is string =>
    !!id && templates.some((t) => t.id === id)
  if (exists(opts.picked)) return opts.picked
  if (exists(opts.project?.defaultTemplateId)) return opts.project.defaultTemplateId
  if (exists(opts.lastUsed)) return opts.lastUsed
  return templates[0]?.id ?? ''
}
