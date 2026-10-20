import { contextBridge, ipcRenderer } from 'electron'
import {
  OVERLAY_CHANNELS,
  type OverlayAction,
  type OverlayApi,
  type OverlayState
} from '../shared/dictationOverlay'

/** The status pill listens, and reports clicks on its two buttons. */
const overlay: OverlayApi = {
  onState(cb: (state: OverlayState) => void): void {
    ipcRenderer.on(OVERLAY_CHANNELS.state, (_event, state: OverlayState) => cb(state))
  },
  onLevel(cb: (value: number) => void): void {
    ipcRenderer.on(OVERLAY_CHANNELS.level, (_event, value: number) => cb(value))
  },
  act(action: OverlayAction): void {
    ipcRenderer.send(OVERLAY_CHANNELS.action, action)
  },
  pointer(over: boolean): void {
    ipcRenderer.send(OVERLAY_CHANNELS.pointer, over)
  }
}

contextBridge.exposeInMainWorld('overlay', overlay)
