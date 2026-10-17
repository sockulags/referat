import type { JSX } from 'react'

/** The <option>s of a microphone picker: the system default, then each input device. */
export function MicrophoneOptions({ devices }: { devices: MediaDeviceInfo[] }): JSX.Element {
  return (
    <>
      <option value="">Systemstandard</option>
      {devices.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || `Mikrofon ${i + 1}`}
        </option>
      ))}
    </>
  )
}
