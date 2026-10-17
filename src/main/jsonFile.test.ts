import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readJsonArray, writeJsonAtomic } from './jsonFile'

const dir = mkdtempSync(join(tmpdir(), 'referat-json-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const isNumber = (value: unknown): value is number => typeof value === 'number'

describe('writeJsonAtomic', () => {
  it('replaces the file and leaves no temp file behind', () => {
    const file = join(dir, 'list.json')
    writeJsonAtomic(file, [1])
    writeJsonAtomic(file, [1, 2])
    expect(readFileSync(file, 'utf-8')).toBe('[\n  1,\n  2\n]')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('writes compact JSON on request', () => {
    const file = join(dir, 'compact.json')
    writeJsonAtomic(file, { a: [1, 2] }, true)
    expect(readFileSync(file, 'utf-8')).toBe('{"a":[1,2]}')
  })
})

describe('readJsonArray', () => {
  it('is empty for a missing file', () => {
    expect(readJsonArray(join(dir, 'missing.json'), isNumber)).toEqual([])
  })

  it('keeps only the items that pass the guard', () => {
    const file = join(dir, 'mixed.json')
    writeFileSync(file, JSON.stringify([1, 'two', 3, null]))
    expect(readJsonArray(file, isNumber)).toEqual([1, 3])
  })

  it('is empty for a corrupt file or one that is not an array', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const corrupt = join(dir, 'corrupt.json')
    writeFileSync(corrupt, '[1, 2')
    expect(readJsonArray(corrupt, isNumber)).toEqual([])
    const object = join(dir, 'object.json')
    writeFileSync(object, '{"a": 1}')
    expect(readJsonArray(object, isNumber)).toEqual([])
  })
})
