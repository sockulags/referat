import type { JSX, ReactNode } from 'react'

// A tiny, safe Markdown renderer. Builds React elements only — never
// dangerouslySetInnerHTML. Supports headings, bold, italic, inline code,
// unordered/ordered lists, blockquotes and paragraphs. Enough for our
// protocol format; unknown syntax degrades to plain text.
//
// Keys are positions: the parsed blocks are rebuilt from the source on every
// render and never reorder, so a position names the same element each time.

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
      nodes.push(<strong key={nodes.length}>{parseInline(m[2])}</strong>)
    } else if (m[4] !== undefined) {
      nodes.push(<em key={nodes.length}>{parseInline(m[4])}</em>)
    } else if (m[5] !== undefined) {
      nodes.push(
        <code
          key={nodes.length}
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

/** Line-prefixed blocks: consecutive lines with the same marker form one block. */
const PREFIXED: { type: Block['type']; marker: RegExp }[] = [
  { type: 'ul', marker: /^[-*+]\s+/ },
  { type: 'ol', marker: /^\d+[.)]\s+/ },
  { type: 'quote', marker: /^>\s?/ }
]

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
    const prefixed = PREFIXED.find(({ marker }) => marker.test(trimmed))
    if (prefixed) {
      flushPara()
      const item = trimmed.replace(prefixed.marker, '')
      const prev = blocks[blocks.length - 1]
      if (prev && prev.type === prefixed.type) prev.lines.push(item)
      else blocks.push({ type: prefixed.type, lines: [item] })
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
    <div className="text-fg">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
            return (
              <h1 key={i} className="text-2xl font-semibold mt-8 first:mt-0 mb-3 tracking-tight">
                {parseInline(b.lines[0])}
              </h1>
            )
          case 'h2':
            return (
              <h2
                key={i}
                className="text-lg font-semibold mt-7 first:mt-0 mb-2.5 pb-1.5 border-b border-border tracking-tight"
              >
                {parseInline(b.lines[0])}
              </h2>
            )
          case 'h3':
            return (
              <h3 key={i} className="text-base font-semibold mt-5 first:mt-0 mb-2">
                {parseInline(b.lines[0])}
              </h3>
            )
          case 'ul':
            return (
              <ul key={i} className="my-3 pl-1 space-y-1.5">
                {b.lines.map((li, j) => (
                  <li key={j} className="flex gap-2.5 leading-relaxed">
                    <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{parseInline(li)}</span>
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="my-3 pl-1 space-y-1.5">
                {b.lines.map((li, idx) => (
                  <li key={idx} className="flex gap-2.5 leading-relaxed">
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
                key={i}
                className="my-4 pl-4 border-l-2 border-accent text-fg-muted italic"
              >
                {b.lines.map((q, j) => (
                  <p key={j} className="leading-relaxed">
                    {parseInline(q)}
                  </p>
                ))}
              </blockquote>
            )
          default:
            return (
              <p key={i} className="my-3 leading-[1.75]">
                {parseInline(b.lines[0])}
              </p>
            )
        }
      })}
    </div>
  )
}
