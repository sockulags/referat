import { describe, expect, it } from 'vitest'
import { isLiveTranscriptionOn, isLoopbackUrl, liveTranscriptionDefault } from './live'

describe('isLoopbackUrl', () => {
  it('accepts addresses on this computer', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8310/v1')).toBe(true)
    expect(isLoopbackUrl('http://127.4.5.6/v1')).toBe(true)
    expect(isLoopbackUrl('http://localhost:8000/v1')).toBe(true)
    expect(isLoopbackUrl('http://LOCALHOST:8000')).toBe(true)
    expect(isLoopbackUrl('http://whisper.localhost/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8000/v1')).toBe(true)
  })

  it('rejects other hosts and garbage', () => {
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackUrl('http://192.168.1.10:8000/v1')).toBe(false)
    expect(isLoopbackUrl('http://localhost.example.com/v1')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.1.example.com/v1')).toBe(false)
    expect(isLoopbackUrl('')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })
})

describe('liveTranscriptionDefault', () => {
  it('is on for the built-in component and local servers', () => {
    expect(liveTranscriptionDefault('built-in', 'http://127.0.0.1:8310/v1')).toBe(true)
    expect(liveTranscriptionDefault('local', 'http://localhost:8000/v1')).toBe(true)
    expect(liveTranscriptionDefault('custom', 'http://127.0.0.1:9000/v1')).toBe(true)
  })

  it('is off when audio would leave the computer', () => {
    expect(liveTranscriptionDefault('openai', 'https://api.openai.com/v1')).toBe(false)
    expect(liveTranscriptionDefault('azure', 'https://x.openai.azure.com/openai/v1')).toBe(false)
    expect(liveTranscriptionDefault('custom', 'https://whisper.intranet.example/v1')).toBe(false)
    expect(liveTranscriptionDefault('local', 'http://10.0.0.5:8000/v1')).toBe(false)
  })
})

describe('isLiveTranscriptionOn', () => {
  it('lets an explicit choice win over the default', () => {
    expect(isLiveTranscriptionOn(true, 'openai', 'https://api.openai.com/v1')).toBe(true)
    expect(isLiveTranscriptionOn(false, 'built-in', 'http://127.0.0.1:8310/v1')).toBe(false)
  })

  it('falls back to the default when the user never chose', () => {
    expect(isLiveTranscriptionOn(null, 'built-in', 'http://127.0.0.1:8310/v1')).toBe(true)
    expect(isLiveTranscriptionOn(undefined, 'openai', 'https://api.openai.com/v1')).toBe(false)
  })
})
