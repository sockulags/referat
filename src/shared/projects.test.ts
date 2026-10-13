import { describe, expect, it } from 'vitest'
import type { Project, SummaryTemplate } from './types'
import { resolveStartTemplateId } from './projects'

const templates: SummaryTemplate[] = [
  { id: 'protokoll', name: 'Protokoll', promptTemplate: '', builtIn: true },
  { id: 'beslutslogg', name: 'Beslutslogg', promptTemplate: '', builtIn: true },
  { id: 'mejl', name: 'Uppföljningsmejl', promptTemplate: '', builtIn: true }
]

function project(defaultTemplateId: string): Project {
  return { id: 'p', name: 'Styrgrupp', defaultTemplateId, createdAt: '' }
}

describe('resolveStartTemplateId', () => {
  it('uses what the user picked for this recording first', () => {
    expect(
      resolveStartTemplateId(templates, {
        picked: 'mejl',
        project: project('beslutslogg'),
        lastUsed: 'protokoll'
      })
    ).toBe('mejl')
  })

  it("falls back to the project's default, then the last used template", () => {
    expect(
      resolveStartTemplateId(templates, { project: project('beslutslogg'), lastUsed: 'mejl' })
    ).toBe('beslutslogg')
    expect(resolveStartTemplateId(templates, { project: project(''), lastUsed: 'mejl' })).toBe(
      'mejl'
    )
    expect(resolveStartTemplateId(templates, { lastUsed: 'mejl' })).toBe('mejl')
  })

  it('skips templates that no longer exist', () => {
    expect(
      resolveStartTemplateId(templates, {
        picked: 'raderad',
        project: project('ocksa-raderad'),
        lastUsed: 'beslutslogg'
      })
    ).toBe('beslutslogg')
    expect(resolveStartTemplateId(templates, { lastUsed: 'borta' })).toBe('protokoll')
    expect(resolveStartTemplateId([], {})).toBe('')
  })
})
