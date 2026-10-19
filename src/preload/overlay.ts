import { contextBridge, ipcRenderer } from 'electron'
import { OVERLAY_CHANNELS, type OverlayApi, type OverlayState } from '../shared/dictationOverlay'

/** The status pill only listens: it has nothing to ask the main process. */
const overlay: OverlayApi = {
  onState(cb: (state: OverlayState) => void): void {
    ipcRenderer.on(OVERLAY_CHANNELS.state, (_event, state: OverlayState) => cb(state))
  },
  onLevel(cb: (value: number) => void): void {
    ipcRenderer.on(OVERLAY_CHANNELS.level, (_event, value: number) => cb(value))
  }
}

contextBridge.exposeInMainWorld('overlay', overlay)
