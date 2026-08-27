// Export a meeting's protocol to Markdown or Word (.docx), plus clipboard copy.

import { dialog, clipboard, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import type { MeetingSummary } from '../shared/types'
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

/** The summary to act on: the one asked for, else the meeting's first. */
function pickSummary(id: string, summaryId?: string): MeetingSummary | undefined {
  const meeting = getMeeting(id)
  if (!meeting) return undefined
  return summaryId ? meeting.summaries.find((s) => s.id === summaryId) : meeting.summaries[0]
}

export async function exportProtocol(
  id: string,
  format: 'md' | 'docx',
  summaryId?: string
): Promise<{ savedTo: string | null }> {
  const meeting = getMeeting(id)
  const summary = pickSummary(id, summaryId)
  if (!meeting || !summary) {
    return { savedTo: null }
  }

  // Name the file after the template too once there is more than one summary,
  // so exporting all of them does not produce a folder of near-identical names.
  const suffix = meeting.summaries.length > 1 ? ` - ${summary.templateName}` : ''
  const safeTitle = sanitizeFilename(`${meeting.title}${suffix}`)
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
    await writeFile(result.filePath, summary.markdown, 'utf-8')
  } else {
    const dateLine = new Date(meeting.createdAt).toLocaleDateString('sv-SE')
    const buffer = await buildDocx(meeting.title, dateLine, summary.markdown)
    await writeFile(result.filePath, buffer)
  }

  return { savedTo: result.filePath }
}

export function copyProtocol(id: string, summaryId?: string): void {
  clipboard.writeText(pickSummary(id, summaryId)?.markdown ?? '')
}
