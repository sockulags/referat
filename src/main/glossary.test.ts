import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'
import { app } from 'electron'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type { GlossaryTerm, Transcript } from '../shared/types'
import {
  addGlossaryEntry,
  applyGlossary,
  deleteGlossaryTerm,
  glossaryPromptBlock,
  listGlossaryTerms,
  updateGlossaryTerm
} from './glossary'

// The store resolves its file via app.getPath('userData'); point that at a
// temp dir so tests never touch a real glossary.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'referat-glossary-'))
  return { app: { getPath: (): string => dir } }
})

const glossaryFile = join(app.getPath('userData'), 'glossary.json')

function term(canonical: string, variants: string[]): GlossaryTerm {
  return { id: canonical, canonical, variants, updatedAt: '2026-01-01T00:00:00.000Z' }
}

function transcriptOf(...texts: string[]): Transcript {
  return {
    language: 'sv',
    segments: texts.map((text, i) => ({ startSec: i, endSec: i + 1, text })),
    text: texts.join(' ')
  }
}

describe('applyGlossary', () => {
  it('replaces a misheard variant with the correct spelling', () => {
    const { transcript, hits } = applyGlossary(transcriptOf('vi kör allt i kubbernätes numera'), [
      term('Kubernetes', ['kubbernätes'])
    ])
    expect(transcript.segments[0].text).toBe('vi kör allt i Kubernetes numera')
    expect(hits).toBe(1)
  })

  it('matches case-insensitively and normalizes casing to the canonical form', () => {
    const { transcript } = applyGlossary(transcriptOf('Kubbernätes och KUBBERNÄTES'), [
      term('Kubernetes', ['kubbernätes'])
    ])
    expect(transcript.segments[0].text).toBe('Kubernetes och Kubernetes')
  })

  it('catches the word splits the transcriber introduces', () => {
    const { transcript } = applyGlossary(
      transcriptOf('kubber nätes', 'kubber-nätes', 'kubber  nätes'),
      [term('Kubernetes', ['kubber nätes'])]
    )
    expect(transcript.segments.map((s) => s.text)).toEqual([
      'Kubernetes',
      'Kubernetes',
      'Kubernetes'
    ])
  })

  it('never matches inside a longer word', () => {
    const { transcript, hits } = applyGlossary(transcriptOf('vi asurerar och asure'), [
      term('Azure', ['asure'])
    ])
    expect(transcript.segments[0].text).toBe('vi asurerar och Azure')
    expect(hits).toBe(1)
  })

  it('treats Swedish letters as word characters at the boundary', () => {
    // 'å' must count as part of the preceding word, or 'påasure' would match.
    const { hits } = applyGlossary(transcriptOf('påasure'), [term('Azure', ['asure'])])
    expect(hits).toBe(0)
  })

  it('prefers the longest matching variant at the same position', () => {
    const { transcript } = applyGlossary(transcriptOf('vi använder asure devops dagligen'), [
      term('Azure', ['asure']),
      term('Azure DevOps', ['asure devops'])
    ])
    expect(transcript.segments[0].text).toBe('vi använder Azure DevOps dagligen')
  })

  it('does not re-match text it just inserted', () => {
    // Replacing 'ci' -> 'CI/CD' must not let the 'cd' variant fire inside the
    // result; a sequential pass would produce 'CI/CD/CD'.
    const { transcript } = applyGlossary(transcriptOf('vår ci pipeline'), [
      term('CI/CD', ['ci']),
      term('Continuous Delivery', ['cd'])
    ])
    expect(transcript.segments[0].text).toBe('vår CI/CD pipeline')
  })

  it('keeps the provider text on rewritten segments only', () => {
    const { transcript } = applyGlossary(transcriptOf('kubbernätes', 'inget att rätta'), [
      term('Kubernetes', ['kubbernätes'])
    ])
    expect(transcript.segments[0].originalText).toBe('kubbernätes')
    expect(transcript.segments[1].originalText).toBeUndefined()
  })

  it('corrects the full text as well as the segments', () => {
    const { transcript } = applyGlossary(transcriptOf('kubbernätes rullar'), [
      term('Kubernetes', ['kubbernätes'])
    ])
    expect(transcript.text).toBe('Kubernetes rullar')
    expect(transcript.originalText).toBe('kubbernätes rullar')
    expect(transcript.glossaryHits).toBe(1)
  })

  it('is idempotent — re-applying starts from the provider text', () => {
    const terms = [term('Kubernetes', ['kubbernätes'])]
    const once = applyGlossary(transcriptOf('kubbernätes'), terms)
    const twice = applyGlossary(once.transcript, terms)
    expect(twice.transcript.segments[0].text).toBe('Kubernetes')
    expect(twice.transcript.segments[0].originalText).toBe('kubbernätes')
    expect(twice.hits).toBe(1)
  })

  it('reverts a correction when the term is removed from the glossary', () => {
    const corrected = applyGlossary(transcriptOf('kubbernätes rullar'), [
      term('Kubernetes', ['kubbernätes'])
    ]).transcript
    const reverted = applyGlossary(corrected, []).transcript
    expect(reverted.segments[0].text).toBe('kubbernätes rullar')
    expect(reverted.segments[0].originalText).toBeUndefined()
    expect(reverted.text).toBe('kubbernätes rullar')
    expect(reverted.originalText).toBeUndefined()
    expect(reverted.glossaryHits).toBeUndefined()
  })

  it('changes a correction when the canonical spelling is edited', () => {
    const corrected = applyGlossary(transcriptOf('kubbernätes'), [
      term('Kubernetes', ['kubbernätes'])
    ]).transcript
    const recorrected = applyGlossary(corrected, [term('K8s', ['kubbernätes'])]).transcript
    expect(recorrected.segments[0].text).toBe('K8s')
  })

  it('leaves speaker attribution untouched', () => {
    const transcript: Transcript = {
      language: 'sv',
      segments: [{ startSec: 0, endSec: 1, text: 'kubbernätes', speaker: 'S1' }],
      text: 'kubbernätes',
      speakers: { S1: 'Anna' }
    }
    const { transcript: next } = applyGlossary(transcript, [term('Kubernetes', ['kubbernätes'])])
    expect(next.segments[0].speaker).toBe('S1')
    expect(next.speakers).toEqual({ S1: 'Anna' })
  })

  it('handles an empty glossary and empty text without changes', () => {
    const { transcript, hits } = applyGlossary(transcriptOf('', 'oförändrat'), [])
    expect(hits).toBe(0)
    expect(transcript.segments.map((s) => s.text)).toEqual(['', 'oförändrat'])
  })

  it('ignores blank variants instead of matching everything', () => {
    const { transcript, hits } = applyGlossary(transcriptOf('helt vanlig text'), [
      term('Kubernetes', ['', '   '])
    ])
    expect(hits).toBe(0)
    expect(transcript.segments[0].text).toBe('helt vanlig text')
  })
})

describe('glossaryPromptBlock', () => {
  it('lists the correct spellings for the summary model', () => {
    const block = glossaryPromptBlock([term('Kubernetes', ['kubbernätes']), term('Azure', [])])
    expect(block).toContain('- Kubernetes')
    expect(block).toContain('- Azure')
  })

  it('is empty when there is nothing to say', () => {
    expect(glossaryPromptBlock([])).toBe('')
  })
})

describe('glossary store', () => {
  beforeEach(() => {
    rmSync(glossaryFile, { force: true })
  })

  it('creates a term on the first variant and extends it on the next', () => {
    addGlossaryEntry('Kubernetes', 'kubbernätes')
    addGlossaryEntry('Kubernetes', 'koobernetes')
    const terms = listGlossaryTerms()
    expect(terms).toHaveLength(1)
    expect(terms[0].variants).toEqual(['kubbernätes', 'koobernetes'])
  })

  it('matches an existing term regardless of the casing typed', () => {
    addGlossaryEntry('Kubernetes', 'kubbernätes')
    addGlossaryEntry('kubernetes', 'koobernetes')
    expect(listGlossaryTerms()).toHaveLength(1)
  })

  it('does not store the same variant twice', () => {
    addGlossaryEntry('Kubernetes', 'kubbernätes')
    addGlossaryEntry('Kubernetes', 'KubberNätes')
    expect(listGlossaryTerms()[0].variants).toEqual(['kubbernätes'])
  })

  it('rejects an empty term or variant', () => {
    expect(() => addGlossaryEntry('  ', 'kubbernätes')).toThrow()
    expect(() => addGlossaryEntry('Kubernetes', '  ')).toThrow()
  })

  it('edits a term and drops blank and duplicate variants', () => {
    const created = addGlossaryEntry('Kubernetes', 'kubbernätes')
    updateGlossaryTerm(created.id, {
      canonical: 'K8s',
      variants: ['kubbernätes', '  ', 'KUBBERNÄTES', 'koobernetes']
    })
    const [stored] = listGlossaryTerms()
    expect(stored.canonical).toBe('K8s')
    expect(stored.variants).toEqual(['kubbernätes', 'koobernetes'])
  })

  it('deletes a term', () => {
    const created = addGlossaryEntry('Kubernetes', 'kubbernätes')
    deleteGlossaryTerm(created.id)
    expect(listGlossaryTerms()).toEqual([])
  })

  it('sorts alphabetically for display', () => {
    addGlossaryEntry('Övrigt', 'övrit')
    addGlossaryEntry('Azure', 'asure')
    addGlossaryEntry('Kubernetes', 'kubbernätes')
    expect(listGlossaryTerms().map((t) => t.canonical)).toEqual(['Azure', 'Kubernetes', 'Övrigt'])
  })
})
