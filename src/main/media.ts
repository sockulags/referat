// A meeting's recorded audio, served to the renderer for playback as
// referat-media://meeting/<id>/<segment>. Only the segment files of a valid
// meeting id can be reached, never an arbitrary path. Byte ranges are
// supported, which is what lets the <audio> element seek in the recorder's
// WebM files: they carry no duration and no seek index.

import { protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { audioSegmentFile } from './storage'

export const MEDIA_SCHEME = 'referat-media'

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

export function handleMediaRequests(): void {
  protocol.handle(MEDIA_SCHEME, serveMedia)
}

/**
 * The byte range a Range header asks for, null for the whole file, or
 * 'invalid' when it cannot be satisfied. One range only; that is all a media
 * element asks for.
 */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return 'invalid'
  let start: number
  let end: number
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}

export async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const [, id, index] = url.pathname.split('/')
  let file: string | null = null
  if (url.host === 'meeting' && id && /^\d+$/.test(index ?? '')) {
    try {
      file = audioSegmentFile(decodeURIComponent(id), Number(index))
    } catch {
      file = null
    }
  }
  if (!file) return new Response(null, { status: 404 })

  const size = statSync(file).size
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const { start, end } = range ?? { start: 0, end: Math.max(0, size - 1) }
  const headers: Record<string, string> = {
    'Content-Type': 'audio/webm',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size === 0 ? 0 : end - start + 1)
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const body =
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>)
  return new Response(body, { status: range ? 206 : 200, headers })
}
