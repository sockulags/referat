import type { JSX, ReactNode } from 'react'

// A tiny, safe Markdown renderer. Builds React elements only — never
// dangerouslySetInnerHTML. Supports headings, bold, italic, inline code,
// unordered/ordered lists, blockquotes and paragraphs. Enough for our
// protocol format; unknown syntax degrades to plain text.

let keySeq = 0
function nextKey(): string {
  return `md-${keySeq++}`
}

/** Parse inline emphasis/code within a line into React nodes. */
function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Order matters: bold before italic. Inline code is literal.
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+?)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] !== undefined) {
      nodes.push(<strong key={nextKey()}>{parseInline(m[2])}</strong>)
    } else if (m[4] !== undefined) {
      nodes.push(<em key={nextKey()}>{parseInline(m[4])}</em>)
    } else if (m[5] !== undefined) {
      nodes.push(
        <code
          key={nextKey()}
          className="px-1.5 py-0.5 rounded-md bg-surface-2 text-[0.85em] font-mono"
        >
          {m[5]}
        </code>
      )
    }
    last = pattern.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'p'
  lines: string[]
}

function parseBlocks(source: string): Block[] {
  const rawLines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: 'p', lines: [para.join(' ')] })
      para = []
    }
  }

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushPara()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      const level = heading[1].length
      blocks.push({ type: `h${level}` as Block['type'], lines: [heading[2]] })
      continue
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara()
      const item = trimmed.replace(/^[-*+]\s+/, '')
      const prev = blocks[blocks.length - 1]
      if (prev && prev.type === 'ul') prev.lines.push(item)
      else blocks.push({ type: 'ul', lines: [item] })
      continue
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushPara()
      const item = trimmed.replace(/^\d+[.)]\s+/, '')
      const prev = blocks[blocks.length - 1]
      if (prev && prev.type === 'ol') prev.lines.push(item)
      else blocks.push({ type: 'ol', lines: [item] })
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara()
      const item = trimmed.replace(/^>\s?/, '')
      const prev = blocks[blocks.length - 1]
      if (prev && prev.type === 'quote') prev.lines.push(item)
      else blocks.push({ type: 'quote', lines: [item] })
      continue
    }
    para.push(trimmed)
  }
  flushPara()
  return blocks
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks = parseBlocks(source)
  return (
    <div className="referat-doc text-fg">
      {blocks.map((b) => {
        switch (b.type) {
          case 'h1':
            return (
              <h1
                key={nextKey()}
                className="text-2xl font-semibold mt-8 first:mt-0 mb-3 tracking-tight"
              >
                {parseInline(b.lines[0])}
              </h1>
            )
          case 'h2':
            return (
              <h2
                key={nextKey()}
                className="text-lg font-semibold mt-7 first:mt-0 mb-2.5 pb-1.5 border-b border-border tracking-tight"
              >
                {parseInline(b.lines[0])}
              </h2>
            )
          case 'h3':
            return (
              <h3 key={nextKey()} className="text-base font-semibold mt-5 first:mt-0 mb-2">
                {parseInline(b.lines[0])}
              </h3>
            )
          case 'ul':
            return (
              <ul key={nextKey()} className="my-3 pl-1 space-y-1.5">
                {b.lines.map((li) => (
                  <li key={nextKey()} className="flex gap-2.5 leading-relaxed">
                    <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{parseInline(li)}</span>
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={nextKey()} className="my-3 pl-1 space-y-1.5 counter-reset-list">
                {b.lines.map((li, idx) => (
                  <li key={nextKey()} className="flex gap-2.5 leading-relaxed">
                    <span className="shrink-0 text-accent font-semibold tabular-nums">
                      {idx + 1}.
                    </span>
                    <span>{parseInline(li)}</span>
                  </li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote
                key={nextKey()}
                className="my-4 pl-4 border-l-2 border-accent text-fg-muted italic"
              >
                {b.lines.map((q) => (
                  <p key={nextKey()} className="leading-relaxed">
                    {parseInline(q)}
                  </p>
                ))}
              </blockquote>
            )
          default:
            return (
              <p key={nextKey()} className="my-3 leading-[1.75]">
                {parseInline(b.lines[0])}
              </p>
            )
        }
      })}
    </div>
  )
}
