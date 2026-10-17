import type { JSX } from 'react'
import { strings } from '../strings'

/** The <option>s of a microphone picker: the system default, then each input device. */
export function MicrophoneOptions({ devices }: { devices: MediaDeviceInfo[] }): JSX.Element {
  return (
    <>
      <option value="">{strings.settings.audio.systemDefault}</option>
      {devices.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || strings.settings.audio.unnamedMicrophone(i + 1)}
        </option>
      ))}
    </>
  )
}
