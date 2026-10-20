import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { parseViskaConfig, readViskaConfig, runViskaImport, viskaConfigPath } from './viskaImport'

describe('parseViskaConfig', () => {
  it('takes the dictation settings Viska and referat share', () => {
    expect(
      parseViskaConfig({
        hotkey: 'Mouse4',
        language: 'en',
        input_device: 'Mikrofonmatris (Realtek)',
        mic_avoid_bluetooth: false,
        live: 'auto',
        sounds: false,
        flow: true
      }).dictation
    ).toEqual({
      hotkey: 'mouse4',
      language: 'en',
      microphone: 'Mikrofonmatris (Realtek)',
      avoidBluetooth: false,
      live: null,
      sounds: false
    })
  })

  it('leaves out a device index, which only meant something to Viska', () => {
    expect(parseViskaConfig({ input_device: 3 }).dictation.microphone).toBeUndefined()
  })

  it('turns replacement rules and vocabulary into glossary terms', () => {
    expect(
      parseViskaConfig({
        replacements: { avansa: 'Avanza', 'kuber nettes': 'Kubernetes' },
        initial_prompt: 'Kubernetes, Referat ,  '
      }).terms
    ).toEqual([
      { canonical: 'Avanza', heard: 'avansa' },
      { canonical: 'Kubernetes', heard: 'kuber nettes' },
      { canonical: 'Referat', heard: 'Referat' }
    ])
  })

  it('takes nothing from something that is not a Viska config', () => {
    expect(parseViskaConfig(null)).toEqual({ dictation: {}, terms: [] })
    expect(parseViskaConfig({ hotkey: '', language: 'fi', replacements: [] })).toEqual({
      dictation: {},
      terms: []
    })
  })
})

describe('readViskaConfig', () => {
  it('reads the file, and gives up quietly when it is missing or broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'viska-'))
    const path = join(dir, 'config.json')
    expect(readViskaConfig(path)).toBe(null)
    writeFileSync(path, '{trasig')
    expect(readViskaConfig(path)).toBe(null)
    writeFileSync(path, JSON.stringify({ hotkey: 'f10' }))
    expect(readViskaConfig(path)?.dictation).toEqual({ hotkey: 'f10' })
  })

  it("finds Viska's config under APPDATA", () => {
    expect(viskaConfigPath({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })).toBe(
      join('C:\\Users\\a\\AppData\\Roaming', 'viska', 'config.json')
    )
    expect(viskaConfigPath({})).toBe(null)
  })
})

describe('runViskaImport', () => {
  const found = {
    dictation: { hotkey: 'f10' },
    terms: [
      { canonical: 'Avanza', heard: 'avansa' },
      { canonical: '', heard: 'trasig' }
    ]
  }

  it('moves settings and words over once, and records it', () => {
    const saved: unknown[] = []
    const added: string[] = []
    let record: unknown = null
    const result = runViskaImport({
      alreadyDone: () => false,
      read: () => found,
      saveDictation: (patch) => saved.push(patch),
      addTerm: (canonical, heard) => {
        if (!canonical) throw new Error('Termen saknar korrekt stavning')
        added.push(`${heard} -> ${canonical}`)
      },
      record: (r) => (record = r),
      now: () => new Date('2026-10-20T08:00:00Z')
    })
    expect(saved).toEqual([{ hotkey: 'f10' }])
    expect(added).toEqual(['avansa -> Avanza'])
    expect(result).toEqual({ at: '2026-10-20T08:00:00.000Z', terms: 1 })
    expect(record).toEqual(result)
  })

  it('does nothing the second time, or when there is no Viska', () => {
    const read = (): never => {
      throw new Error('should not read')
    }
    const noop = (): void => undefined
    expect(
      runViskaImport({
        alreadyDone: () => true,
        read,
        saveDictation: noop,
        addTerm: noop,
        record: noop
      })
    ).toBe(null)
    expect(
      runViskaImport({
        alreadyDone: () => false,
        read: () => null,
        saveDictation: noop,
        addTerm: noop,
        record: () => {
          throw new Error('should not record')
        }
      })
    ).toBe(null)
  })
})
