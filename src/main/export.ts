// Export a meeting's protocol to Markdown or Word (.docx), plus clipboard copy.

import { dialog, clipboard, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import { getMeeting } from './storage'

function sanitizeFilename(name: string): string {
  // Strip characters Windows disallows in filenames, collapse whitespace.
  const cleaned = name
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'protokoll'
}

/** Parse **bold** spans within a line into docx TextRuns. */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }))
    } else {
      runs.push(new TextRun(part))
    }
  }
  return runs.length > 0 ? runs : [new TextRun('')]
}

/** Minimal markdown -> docx paragraphs: ## headings, bullet lists, plain paragraphs. */
function markdownToParagraphs(markdown: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      continue
    }
    if (line.startsWith('### ')) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(line.slice(4)) })
      )
    } else if (line.startsWith('## ')) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(line.slice(3)) })
      )
    } else if (line.startsWith('# ')) {
      out.push(
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(line.slice(2)) })
      )
    } else if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '')
      out.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(text) }))
    } else {
      out.push(new Paragraph({ children: inlineRuns(line) }))
    }
  }
  return out
}

async function buildDocx(title: string, dateLine: string, markdown: string): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
          new Paragraph({ children: [new TextRun({ text: dateLine, italics: true })] }),
          new Paragraph({ children: [new TextRun('')] }),
          ...markdownToParagraphs(markdown)
        ]
      }
    ]
  })
  return Packer.toBuffer(doc)
}

export async function exportProtocol(
  id: string,
  format: 'md' | 'docx'
): Promise<{ savedTo: string | null }> {
  const meeting = getMeeting(id)
  if (!meeting || !meeting.protocol) {
    return { savedTo: null }
  }

  const safeTitle = sanitizeFilename(meeting.title)
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const options = {
    defaultPath: `${safeTitle}.${format}`,
    filters:
      format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'Word', extensions: ['docx'] }]
  }

  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return { savedTo: null }
  }

  if (format === 'md') {
    await writeFile(result.filePath, meeting.protocol, 'utf-8')
  } else {
    const dateLine = new Date(meeting.createdAt).toLocaleDateString('sv-SE')
    const buffer = await buildDocx(meeting.title, dateLine, meeting.protocol)
    await writeFile(result.filePath, buffer)
  }

  return { savedTo: result.filePath }
}

export function copyProtocol(id: string): void {
  const meeting = getMeeting(id)
  clipboard.writeText(meeting?.protocol ?? '')
}
