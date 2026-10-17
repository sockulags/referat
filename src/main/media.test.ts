import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'referat-media-'))
const file = join(dir, 'audio.webm')
writeFileSync(file, Buffer.from('0123456789'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

vi.mock('electron', () => ({ protocol: {} }))
vi.mock('./storage', () => ({
  audioSegmentFile: (id: string, index: number) => {
    if (id === '../etc') throw new Error('Invalid meeting id')
    return id === 'm1' && index === 0 ? file : null
  }
}))

const { parseRange, serveMedia } = await import('./media')

describe('parseRange', () => {
  it('reads open, closed and suffix ranges', () => {
    expect(parseRange(null, 10)).toBeNull()
    expect(parseRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 })
    expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 })
    expect(parseRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 })
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
  })

  it('rejects ranges that cannot be satisfied', () => {
    expect(parseRange('bytes=10-', 10)).toBe('invalid')
    expect(parseRange('bytes=5-2', 10)).toBe('invalid')
    expect(parseRange('bytes=-', 10)).toBe('invalid')
    expect(parseRange('items=0-1', 10)).toBe('invalid')
  })
})

describe('serveMedia', () => {
  const get = (url: string, range?: string): Promise<Response> =>
    serveMedia(new Request(url, range ? { headers: { range } } : undefined))

  it('serves the whole segment', async () => {
    const res = await get('referat-media://meeting/m1/0')
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe('0123456789')
  })

  it('serves a byte range, which is what lets the player seek', async () => {
    const res = await get('referat-media://meeting/m1/0', 'bytes=3-5')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 3-5/10')
    expect(await res.text()).toBe('345')
  })

  it('answers 416 for a range past the end', async () => {
    const res = await get('referat-media://meeting/m1/0', 'bytes=50-')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })

  it('reaches nothing but a meeting segment', async () => {
    expect((await get('referat-media://meeting/m1/1')).status).toBe(404)
    expect((await get('referat-media://meeting/m1/x')).status).toBe(404)
    expect((await get('referat-media://other/m1/0')).status).toBe(404)
    expect((await get('referat-media://meeting/..%2Fetc/0')).status).toBe(404)
  })
})
