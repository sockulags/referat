// The dictation status pill. The main process decides what to show (see
// shared/dictationOverlay.ts); this only draws it.

import './overlay.css'
import type { OverlayAction, OverlayState } from '../../../shared/dictationOverlay'

const BAR_COUNT = 9
/** RMS that fills the meter: ordinary speech sits around 0.02–0.1. */
const FULL_LEVEL = 0.08

const pill = document.getElementById('pill')!
const icon = document.getElementById('icon')!
const meter = document.getElementById('meter')!
const text = document.getElementById('text')!
const clock = document.getElementById('clock')!
const actions = document.getElementById('actions')!

const bars = Array.from({ length: BAR_COUNT }, () => {
  const bar = document.createElement('span')
  bar.className = 'bar'
  meter.appendChild(bar)
  return bar
})
const history: number[] = Array(BAR_COUNT).fill(0)

let clockTimer: ReturnType<typeof setInterval> | null = null

function render(state: OverlayState): void {
  pill.hidden = false
  pill.dataset.tone = state.tone
  icon.dataset.icon = state.icon
  text.textContent = state.text
  text.hidden = state.text === ''
  meter.hidden = !state.meter
  actions.hidden = !state.actions
  if (state.meter) history.fill(0)
  if (state.timer) {
    startClock()
  } else if (!state.meter && state.tone !== 'recording') {
    stopClock()
  }
}

function startClock(): void {
  stopClock()
  const started = Date.now()
  const tick = (): void => {
    const seconds = Math.floor((Date.now() - started) / 1000)
    clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  tick()
  clock.hidden = false
  clockTimer = setInterval(tick, 250)
}

function stopClock(): void {
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = null
  clock.hidden = true
}

function showLevel(value: number): void {
  history.shift()
  history.push(Math.min(1, value / FULL_LEVEL))
  bars.forEach((bar, index) => {
    bar.style.height = `${Math.round(4 + history[index] * 18)}px`
  })
}

for (const button of actions.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    actions.hidden = true
    window.overlay.act(button.dataset.action as OverlayAction)
  })
}

// The window lets clicks through unless the pointer is on the pill; the
// main process watches the pointer and needs to know where the pill is.
new ResizeObserver(() => {
  const box = pill.getBoundingClientRect()
  window.overlay.rect({ x: box.x, y: box.y, width: box.width, height: box.height })
}).observe(pill)

window.overlay.onState(render)
window.overlay.onLevel(showLevel)
