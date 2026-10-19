import type { OverlayApi } from '../shared/dictationOverlay'

declare global {
  interface Window {
    overlay: OverlayApi
  }
}
