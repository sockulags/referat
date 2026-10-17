// Export a meeting's protocol to Markdown or Word (.docx), plus clipboard copy,
// and its action items as a list or a CSV file for other tools.

import { dialog, clipboard, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import type { ActionItem, MeetingDetail, MeetingSummary } from '../shared/types'
import { formatDueDate } from '../shared/dates'
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
function pickSummary(
  meeting: MeetingDetail | null,
  summaryId?: string
): MeetingSummary | undefined {
  if (!meeting) return undefined
  return summaryId ? meeting.summaries.find((s) => s.id === summaryId) : meeting.summaries[0]
}

export async function exportProtocol(
  id: string,
  format: 'md' | 'docx',
  summaryId?: string
): Promise<{ savedTo: string | null }> {
  const meeting = getMeeting(id)
  const summary = pickSummary(meeting, summaryId)
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

/** "- Skicka kravlistan — Anna (senast 17 okt)", one line per item with text. */
export function actionItemsAsList(items: ActionItem[], now: Date = new Date()): string {
  return items
    .filter((item) => item.text.trim())
    .map((item) => {
      const due = formatDueDate(item.due, now)
      const owner = item.owner.trim() ? ` — ${item.owner.trim()}` : ''
      return `- ${item.text.trim()}${owner}${due ? ` (senast ${due})` : ''}`
    })
    .join('\n')
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function timestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The action items as CSV for Jira's importer or a spreadsheet. Semicolons,
 * because Swedish Excel reads a comma as a decimal separator, and a byte
 * order mark, so Excel opens å, ä and ö as UTF-8. Dates stay YYYY-MM-DD,
 * which every import tool reads.
 */
export function actionItemsAsCsv(items: ActionItem[], meeting: MeetingDetail): string {
  const meetingDate = meeting.createdAt.slice(0, 10)
  const rows = [
    ['Uppgift', 'Ansvarig', 'Senast', 'Möte', 'Mötesdatum', 'Sades vid'],
    ...items
      .filter((item) => item.text.trim())
      .map((item) => [
        item.text.trim(),
        item.owner.trim(),
        item.due,
        meeting.title,
        meetingDate,
        item.atSec !== undefined ? timestamp(item.atSec) : ''
      ])
  ]
  return '\uFEFF' + rows.map((row) => row.map(csvField).join(';')).join('\r\n') + '\r\n'
}

/**
 * Hand the meeting's action items to another tool: as a list on the
 * clipboard, or as a CSV file the user picks a place for.
 */
export async function exportActionItems(
  id: string,
  format: 'list' | 'csv'
): Promise<{ savedTo: string | null }> {
  const meeting = getMeeting(id)
  const items = meeting?.actionItems ?? []
  if (!meeting || !items.some((item) => item.text.trim())) return { savedTo: null }
  if (format === 'list') {
    clipboard.writeText(actionItemsAsList(items))
    return { savedTo: null }
  }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const options = {
    defaultPath: `${sanitizeFilename(`${meeting.title} - actionpunkter`)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { savedTo: null }
  await writeFile(result.filePath, actionItemsAsCsv(items, meeting), 'utf-8')
  return { savedTo: result.filePath }
}

export function copyProtocol(id: string, summaryId?: string): void {
  clipboard.writeText(pickSummary(getMeeting(id), summaryId)?.markdown ?? '')
}
