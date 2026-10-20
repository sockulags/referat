// Meetings and dictation on the same microphone.
//
// The dictation engine picks the microphone with Bluetooth in mind: the
// computer's own rather than a headset that would drop into call mode, and
// the headset while a call already has it in call mode. With the meeting
// microphone left on the system default, a meeting records with the same
// one. The engine names devices the way Windows does; Chromium uses the
// same names, sometimes with a USB id appended, so a name that starts the
// label is a match. The "default" and "communications" entries are aliases,
// never the device itself.

/** The deviceId to record a meeting with: the setting, or the dictation engine's choice. */
export function meetingMicrophoneId(
  setting: string,
  dictationChoice: string | null,
  devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]
): string {
  if (setting || !dictationChoice) return setting
  const name = dictationChoice.trim().toLowerCase()
  const match = devices.find(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications' &&
      device.label.trim().toLowerCase().startsWith(name)
  )
  return match?.deviceId ?? ''
}
