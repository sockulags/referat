import { describe, expect, it } from 'vitest'
import type { CallApp } from '../shared/types'
import { CallTracker, classifyApp, micUsersFromReg } from './callDetection'

const ROOT =
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'

// Shaped like `reg query <ROOT> /s` on Windows 11.
const output = [
  ROOT,
  '    Value    REG_SZ    Allow',
  '    LastSetTime    REG_QWORD    0x1dcd34942ffa384',
  '',
  `${ROOT}\\MSTeams_8wekyb3d8bbwe`,
  '    Value    REG_SZ    Allow',
  '    LastUsedTimeStart    REG_QWORD    0x1dcf9034091db40',
  '    LastUsedTimeStop    REG_QWORD    0x0',
  '',
  `${ROOT}\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe`,
  '    LastUsedTimeStart    REG_QWORD    0x1dd16f5971dd062',
  '    LastUsedTimeStop    REG_QWORD    0x1dd16f74b8fb99b',
  '',
  `${ROOT}\\NonPackaged\\C:#Users#anna#AppData#Roaming#Zoom#bin#Zoom.exe`,
  '    LastUsedTimeStart    REG_QWORD    0x1dd16f5971dd062',
  '    LastUsedTimeStop    REG_QWORD    0x0',
  ''
].join('\r\n')

describe('micUsersFromReg', () => {
  it('lists the apps whose last microphone use has not stopped', () => {
    expect(micUsersFromReg(output)).toEqual([
      `${ROOT}\\MSTeams_8wekyb3d8bbwe`,
      `${ROOT}\\NonPackaged\\C:#Users#anna#AppData#Roaming#Zoom#bin#Zoom.exe`
    ])
  })

  it('is empty for empty or unexpected output', () => {
    expect(micUsersFromReg('')).toEqual([])
    expect(
      micUsersFromReg('ERROR: The system was unable to find the specified registry key')
    ).toEqual([])
  })
})

describe('classifyApp', () => {
  it('recognises Teams, Zoom and browsers, and nothing else', () => {
    expect(classifyApp(`${ROOT}\\MSTeams_8wekyb3d8bbwe`)).toBe('teams')
    expect(
      classifyApp(
        `${ROOT}\\NonPackaged\\C:#Users#a#AppData#Local#Microsoft#Teams#current#Teams.exe`
      )
    ).toBe('teams')
    expect(classifyApp(`${ROOT}\\NonPackaged\\C:#Zoom#bin#Zoom.exe`)).toBe('zoom')
    expect(
      classifyApp(`${ROOT}\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe`)
    ).toBe('browser')
    expect(classifyApp(`${ROOT}\\NonPackaged\\C:#Program Files#referat#referat.exe`)).toBeNull()
    expect(classifyApp(`${ROOT}\\NonPackaged\\C:#Games#cs2.exe`)).toBeNull()
  })
})

describe('CallTracker', () => {
  const set = (...apps: CallApp[]): Set<CallApp> => new Set(apps)

  it('reports a call once it has lasted two polls, and its end', () => {
    const tracker = new CallTracker()
    expect(tracker.update(set('teams'), false)).toEqual({ started: [], ended: [] })
    expect(tracker.update(set('teams'), false)).toEqual({ started: ['teams'], ended: [] })
    expect(tracker.update(set('teams'), false)).toEqual({ started: [], ended: [] })
    expect(tracker.update(set(), false)).toEqual({ started: [], ended: ['teams'] })
  })

  it('ignores a quick microphone test', () => {
    const tracker = new CallTracker()
    tracker.update(set('zoom'), false)
    expect(tracker.update(set(), false)).toEqual({ started: [], ended: [] })
  })

  it('never offers a call that started during a recording', () => {
    const tracker = new CallTracker()
    tracker.update(set('teams'), true)
    expect(tracker.update(set('teams'), true).started).toEqual([])
    expect(tracker.update(set('teams'), false).started).toEqual([])
  })
})
