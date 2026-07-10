import { describe, it, expect } from 'vitest'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { Markdown } from './Markdown'

// The Markdown renderer builds React elements only and never uses
// dangerouslySetInnerHTML. We verify that by walking the returned element tree
// (plain objects under the automatic JSX runtime) — no DOM needed.

interface Tree {
  types: string[]
  text: string[]
  hasDangerousHtml: boolean
}

function collect(node: ReactNode, t: Tree): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    t.text.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, t)
    return
  }
  if (isValidElement(node)) {
    if (typeof node.type === 'string') t.types.push(node.type)
    const props = node.props as { children?: ReactNode; dangerouslySetInnerHTML?: unknown }
    if (props.dangerouslySetInnerHTML !== undefined) t.hasDangerousHtml = true
    collect(props.children, t)
  }
}

function analyze(source: string): Tree {
  const t: Tree = { types: [], text: [], hasDangerousHtml: false }
  collect(Markdown({ source }), t)
  return t
}

describe('Markdown structure', () => {
  it('renders headings as h1/h2/h3', () => {
    const t = analyze('# Ett\n## Två\n### Tre')
    expect(t.types).toContain('h1')
    expect(t.types).toContain('h2')
    expect(t.types).toContain('h3')
    expect(t.text).toContain('Ett')
  })

  it('renders inline emphasis and code', () => {
    const t = analyze('En **fet** och *kursiv* och `kod`.')
    expect(t.types).toContain('strong')
    expect(t.types).toContain('em')
    expect(t.types).toContain('code')
    expect(t.text).toContain('fet')
    expect(t.text).toContain('kursiv')
    expect(t.text).toContain('kod')
  })

  it('renders unordered and ordered lists as ul/ol with li items', () => {
    const ul = analyze('- a\n- b')
    expect(ul.types).toContain('ul')
    expect(ul.types.filter((x) => x === 'li').length).toBe(2)

    const ol = analyze('1. första\n2. andra')
    expect(ol.types).toContain('ol')
    expect(ol.types.filter((x) => x === 'li').length).toBe(2)
  })

  it('renders blockquotes', () => {
    const t = analyze('> ett citat')
    expect(t.types).toContain('blockquote')
    expect(t.text).toContain('ett citat')
  })

  it('treats inline code content literally (no nested emphasis)', () => {
    const t = analyze('`**inte fet**`')
    expect(t.types).toContain('code')
    expect(t.types).not.toContain('strong')
    expect(t.text).toContain('**inte fet**')
  })
})

describe('Markdown safety', () => {
  it('never uses dangerouslySetInnerHTML', () => {
    const t = analyze('## Rubrik\n\nEn **normal** paragraf med en lista:\n\n- punkt')
    expect(t.hasDangerousHtml).toBe(false)
  })

  it('does not turn raw HTML into real elements — it stays inert text', () => {
    const t = analyze("Hej <script>alert('x')</script> och <img src=x onerror=alert(1)>")
    expect(t.hasDangerousHtml).toBe(false)
    expect(t.types).not.toContain('script')
    expect(t.types).not.toContain('img')
    // The tags survive only as literal text, which React escapes on render.
    expect(t.text.join(' ')).toContain('<script>')
    expect(t.text.join(' ')).toContain('<img src=x onerror=alert(1)>')
  })
})
