// Glossary of misheard terms. Swedish speech recognition mangles technical
// vocabulary, product names and workplace-specific words — the glossary maps
// every heard variant back to one correct spelling. One JSON file at
// userData/glossary.json, shared by every meeting: technical vocabulary is
// stable across a team's meetings, so the list is worth building once.
//
// Matching is deliberately literal. A wrong correction in a protocol is worse
// than a missed one, so there is no fuzzy matching here — only the variants
// the user actually entered, matched case-insensitively and tolerant of the
// word splits the transcriber introduces ("kubber nätes").

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { GlossaryTerm, Transcript, TranscriptSegment } from '../shared/types'

function glossaryPath(): string {
  return join(app.getPath('userData'), 'glossary.json')
}

function isTerm(value: unknown): value is GlossaryTerm {
  const t = value as GlossaryTerm
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof t.id === 'string' &&
    typeof t.canonical === 'string' &&
    t.canonical.trim().length > 0 &&
    Array.isArray(t.variants) &&
    t.variants.every((v) => typeof v === 'string') &&
    typeof t.updatedAt === 'string'
  )
}

/** Defensive read: a missing, corrupt or hand-edited file yields no terms. */
function loadTerms(): GlossaryTerm[] {
  try {
    const path = glossaryPath()
    if (!existsSync(path)) return []
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTerm)
  } catch {
    return []
  }
}

function saveTerms(terms: GlossaryTerm[]): void {
  writeFileSync(glossaryPath(), JSON.stringify(terms, null, 2), 'utf-8')
}

/** Sorted for display: alphabetical by the correct spelling. */
export function listGlossaryTerms(): GlossaryTerm[] {
  return loadTerms().sort((a, b) => a.canonical.localeCompare(b.canonical, 'sv'))
}

/** Compare the way the matcher does, so duplicates are caught before saving. */
function sameText(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
}

/**
 * Add a variant to the term with this spelling, creating the term when it is
 * new. This is the call behind "add to glossary" in the transcript view, where
 * the user selects a misheard word and types what it should have been.
 *
 * A variant equal to the correct spelling is still worth storing: it makes the
 * matcher normalize casing ("kubernetes" -> "Kubernetes").
 */
export function addGlossaryEntry(canonical: string, variant: string): GlossaryTerm {
  const cleanCanonical = canonical.trim()
  const cleanVariant = variant.trim()
  if (!cleanCanonical) throw new Error('Termen saknar korrekt stavning')
  if (!cleanVariant) throw new Error('Varianten är tom')

  const terms = loadTerms()
  const existing = terms.find((t) => sameText(t.canonical, cleanCanonical))
  const now = new Date().toISOString()

  if (existing) {
    if (!existing.variants.some((v) => sameText(v, cleanVariant))) {
      existing.variants.push(cleanVariant)
    }
    existing.updatedAt = now
    saveTerms(terms)
    return existing
  }

  const created: GlossaryTerm = {
    id: randomUUID(),
    canonical: cleanCanonical,
    variants: [cleanVariant],
    updatedAt: now
  }
  terms.push(created)
  saveTerms(terms)
  return created
}

/** Replace a term wholesale — the Settings editor saves through this. */
export function updateGlossaryTerm(
  id: string,
  patch: { canonical?: string; variants?: string[] }
): GlossaryTerm | null {
  const terms = loadTerms()
  const term = terms.find((t) => t.id === id)
  if (!term) return null

  if (patch.canonical !== undefined) {
    const clean = patch.canonical.trim()
    if (!clean) throw new Error('Termen saknar korrekt stavning')
    term.canonical = clean
  }
  if (patch.variants !== undefined) {
    // Drop blanks and duplicates; the editor is a free-text list.
    const seen: string[] = []
    for (const raw of patch.variants) {
      const clean = raw.trim()
      if (!clean) continue
      if (seen.some((v) => sameText(v, clean))) continue
      seen.push(clean)
    }
    term.variants = seen
  }
  term.updatedAt = new Date().toISOString()
  saveTerms(terms)
  return term
}

export function deleteGlossaryTerm(id: string): void {
  const terms = loadTerms()
  const next = terms.filter((t) => t.id !== id)
  if (next.length !== terms.length) saveTerms(next)
}

// ---------- Matching ----------

/** Letters, digits and underscore across scripts — the boundary definition. */
const WORD_CHAR = /[\p{L}\p{N}_]/u

interface CompiledVariant {
  /** Sticky pattern, matched anchored at a candidate position. */
  pattern: RegExp
  canonical: string
  /** Normalized length, used to try the most specific variant first. */
  weight: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build one anchored pattern per variant. Word splits are the common failure
 * mode of the transcriber, so every space or hyphen in a variant matches any
 * run of spaces and hyphens: "kubber nätes" also catches "kubber-nätes".
 */
function compile(terms: GlossaryTerm[]): CompiledVariant[] {
  const compiled: CompiledVariant[] = []
  for (const term of terms) {
    const canonical = term.canonical.trim()
    if (!canonical) continue
    for (const variant of term.variants) {
      const normalized = normalize(variant)
      if (!normalized) continue
      const body = normalized.split(' ').map(escapeRegExp).join('[\\s-]+')
      compiled.push({
        pattern: new RegExp(body, 'iuy'),
        canonical,
        weight: normalized.length
      })
    }
  }
  // Longest first, so "azure devops" wins over "azure" at the same position.
  return compiled.sort((a, b) => b.weight - a.weight)
}

/**
 * Replace every known variant in one left-to-right pass. Single pass matters:
 * replacing sequentially would let one term match inside text another term
 * just inserted.
 */
function replaceAll(text: string, compiled: CompiledVariant[]): { text: string; hits: number } {
  if (!text || compiled.length === 0) return { text, hits: 0 }
  let out = ''
  let i = 0
  let hits = 0

  while (i < text.length) {
    // A variant may only start where a word starts.
    const atBoundary = i === 0 || !WORD_CHAR.test(text[i - 1])
    if (atBoundary && WORD_CHAR.test(text[i])) {
      let matched: { length: number; canonical: string } | null = null
      for (const variant of compiled) {
        variant.pattern.lastIndex = i
        const m = variant.pattern.exec(text)
        if (!m || m[0].length === 0) continue
        // And it may only end where a word ends — no matches inside a longer
        // word, so "asure" never fires inside "asurera".
        const after = i + m[0].length
        if (after < text.length && WORD_CHAR.test(text[after])) continue
        matched = { length: m[0].length, canonical: variant.canonical }
        break
      }
      if (matched) {
        out += matched.canonical
        i += matched.length
        hits++
        continue
      }
    }
    out += text[i]
    i++
  }

  return { text: out, hits }
}

export interface GlossaryResult {
  transcript: Transcript
  /** Total replacements made across the transcript. */
  hits: number
}

/**
 * Apply the glossary to a transcript, non-destructively.
 *
 * Every apply starts from the untouched provider text, so this is idempotent
 * and a removed term un-corrects the transcript on the next run. With an empty
 * glossary the transcript reverts to exactly what the provider returned.
 */
export function applyGlossary(transcript: Transcript, terms: GlossaryTerm[]): GlossaryResult {
  const compiled = compile(terms)
  let hits = 0

  const segments: TranscriptSegment[] = transcript.segments.map((seg) => {
    const source = seg.originalText ?? seg.text
    const result = replaceAll(source, compiled)
    hits += result.hits
    const next: TranscriptSegment = { ...seg, text: result.text }
    if (result.hits > 0) next.originalText = source
    else delete next.originalText
    return next
  })

  // transcript.text can be the provider's own full text rather than the
  // segments joined, so correct it in place instead of rebuilding it.
  const textSource = transcript.originalText ?? transcript.text
  const fullText = replaceAll(textSource, compiled)

  const next: Transcript = { ...transcript, segments, text: fullText.text }
  if (fullText.hits > 0) next.originalText = textSource
  else delete next.originalText
  if (hits > 0) next.glossaryHits = hits
  else delete next.glossaryHits

  return { transcript: next, hits }
}

/**
 * The terminology block handed to the summary model. Correcting the transcript
 * is not enough on its own: without being told, the model happily "corrects" an
 * unfamiliar product name back into a word it recognizes.
 */
export function glossaryPromptBlock(terms: GlossaryTerm[]): string {
  const usable = terms.filter((t) => t.canonical.trim())
  if (usable.length === 0) return ''
  const lines = usable.map((t) => `- ${t.canonical}`)
  return [
    'Ordlista med korrekt stavning av termer som förekommer i mötet.',
    'Använd exakt dessa stavningar i protokollet och ändra dem inte:',
    ...lines
  ].join('\n')
}
