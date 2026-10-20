import { describe, expect, it } from 'vitest'
import { meetingMicrophoneId } from './microphoneChoice'

const devices = [
  {
    deviceId: 'default',
    kind: 'audioinput' as const,
    label: 'Standard - Headset (Jabra Evolve3 85)'
  },
  {
    deviceId: 'communications',
    kind: 'audioinput' as const,
    label: 'Kommunikation - Headset (Jabra Evolve3 85)'
  },
  { deviceId: 'a1', kind: 'audioinput' as const, label: 'Headset (Jabra Evolve3 85) (Bluetooth)' },
  { deviceId: 'b2', kind: 'audioinput' as const, label: 'Mikrofonmatris (Realtek(R) Audio)' },
  {
    deviceId: 'c3',
    kind: 'audioinput' as const,
    label: 'Microphone (Realtek USB2.0 Audio) (0db0:19a2)'
  },
  { deviceId: 'd4', kind: 'audiooutput' as const, label: 'Mikrofonmatris (Realtek(R) Audio)' }
]

describe('meetingMicrophoneId', () => {
  it('keeps a microphone the user chose for meetings', () => {
    expect(meetingMicrophoneId('a1', 'Mikrofonmatris (Realtek(R) Audio)', devices)).toBe('a1')
  })

  it("records with the dictation engine's choice instead of the system default", () => {
    expect(meetingMicrophoneId('', 'Mikrofonmatris (Realtek(R) Audio)', devices)).toBe('b2')
  })

  it('finds a USB microphone whose label has an id appended', () => {
    expect(meetingMicrophoneId('', 'Microphone (Realtek USB2.0 Audio)', devices)).toBe('c3')
  })

  it('never picks the default or communications aliases', () => {
    expect(meetingMicrophoneId('', 'Headset (Jabra Evolve3 85)', devices)).toBe('a1')
  })

  it('falls back to the system default without a choice or a match', () => {
    expect(meetingMicrophoneId('', null, devices)).toBe('')
    expect(meetingMicrophoneId('', 'Okänd mikrofon', devices)).toBe('')
  })
})
