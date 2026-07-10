import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatDuration } from '../format'
import { MeetingRecorder, isMicPermissionError } from '../audio/recorder'
import { LevelMeter } from '../components/LevelMeter'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { IconMic, IconWave, IconPause, IconPlay, IconStop, IconAlert } from '../components/icons'
import { cn } from '../components/ui/cn'

type Phase = 'starting' | 'recording' | 'paused' | 'mic-denied' | 'finishing'

export function Recording(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const openMeeting = useApp((s) => s.openMeeting)
  const settings = useApp((s) => s.settings)
  const pendingTitle = useApp((s) => s.pendingTitle)

  const [phase, setPhase] = useState<Phase>('starting')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState({ mic: 0, system: 0 })
  const [systemMissing, setSystemMissing] = useState(false)
  const [hasSystem, setHasSystem] = useState(false)
  const [micDetail, setMicDetail] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  const recorderRef = useRef<MeetingRecorder | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  const elapsedMsRef = useRef(0)
  const phaseRef = useRef<Phase>('starting')

  // Mirror phase into a ref so the animation loop reads the latest value.
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Start capture on mount (guarded against StrictMode double-run).
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const recorder = new MeetingRecorder()
    recorderRef.current = recorder

    ;(async (): Promise<void> => {
      try {
        const handle = await window.api.startRecording(pendingTitle)
        meetingIdRef.current = handle.meetingId
        await recorder.start({
          microphoneId: settings?.microphoneId ?? '',
          captureSystemAudio: settings?.captureSystemAudio ?? false,
          onChunk: (chunk) => {
            if (meetingIdRef.current) void window.api.appendAudioChunk(meetingIdRef.current, chunk)
          },
          onSystemAudioUnavailable: () => setSystemMissing(true)
        })
        setHasSystem(recorder.hasSystemAudio)
        setPhase('recording')
      } catch (e) {
        if (isMicPermissionError(e)) {
          setMicDetail(e.detail)
          setPhase('mic-denied')
          if (meetingIdRef.current) void window.api.cancelRecording(meetingIdRef.current)
        } else {
          setMicDetail(String(e))
          setPhase('mic-denied')
        }
      }
    })()

    return () => {
      recorderRef.current?.cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Timer + level-meter animation loop.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = now - last
      last = now
      if (phaseRef.current === 'recording') {
        elapsedMsRef.current += dt
        setElapsed(Math.floor(elapsedMsRef.current / 1000))
        const rec = recorderRef.current
        if (rec) setLevels(rec.getLevels())
      } else {
        setLevels({ mic: 0, system: 0 })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const togglePause = (): void => {
    const rec = recorderRef.current
    if (!rec) return
    if (phase === 'recording') {
      rec.pause()
      setPhase('paused')
    } else if (phase === 'paused') {
      rec.resume()
      setPhase('recording')
    }
  }

  const stop = async (): Promise<void> => {
    if (phase === 'finishing' || phase === 'mic-denied') return
    setPhase('finishing')
    const rec = recorderRef.current
    const id = meetingIdRef.current
    try {
      await rec?.stop()
      const durationSec = Math.floor(elapsedMsRef.current / 1000)
      if (id) {
        await window.api.finishRecording(id, durationSec)
        openMeeting(id)
        return
      }
    } catch {
      /* fall through to home */
    }
    navigate('home')
  }

  const cancel = async (): Promise<void> => {
    const rec = recorderRef.current
    const id = meetingIdRef.current
    rec?.cleanup()
    if (id) await window.api.cancelRecording(id)
    navigate('home')
  }

  if (phase === 'mic-denied') {
    return <MicDenied detail={micDetail} onBack={() => navigate('home')} onRetry={cancel} />
  }

  const title = pendingTitle || strings.recording.untitled
  const isPaused = phase === 'paused'
  const isStarting = phase === 'starting'

  return (
    <div className="mx-auto max-w-lg px-5 py-10 flex flex-col items-center text-center min-h-full justify-center">
      {/* Recording indicator */}
      <div className="flex items-center gap-2.5 mb-8">
        <span className="relative flex h-3 w-3">
          {!isPaused && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-rec opacity-60 animate-ping" />
          )}
          <span
            className={cn(
              'relative inline-flex h-3 w-3 rounded-full',
              isPaused ? 'bg-fg-subtle' : 'bg-rec'
            )}
          />
        </span>
        <span className="text-sm font-medium tracking-wide text-fg-muted uppercase">
          {isStarting
            ? strings.recording.starting
            : isPaused
              ? strings.recording.paused
              : strings.recording.title}
        </span>
      </div>

      <h1 className="text-xl font-semibold text-fg mb-2 max-w-sm truncate w-full">{title}</h1>

      {/* Timer */}
      <div
        className={cn(
          'text-6xl font-semibold tabular-nums tracking-tight mb-10 transition-colors',
          isPaused ? 'text-fg-subtle' : 'text-fg'
        )}
      >
        {formatDuration(elapsed)}
      </div>

      {/* Level meters */}
      <div className="w-full flex flex-col gap-5 mb-10">
        <LevelMeter
          level={levels.mic}
          label={strings.recording.micLabel}
          icon={<IconMic size={16} />}
          tone="rec"
        />
        <LevelMeter
          level={levels.system}
          label={strings.recording.systemLabel}
          icon={<IconWave size={16} />}
          tone="accent"
          muted={!hasSystem}
        />
      </div>

      {systemMissing && (
        <div className="w-full mb-8 flex items-start gap-2.5 text-left rounded-[10px] bg-warning-soft text-warning px-4 py-3 text-sm animate-fade-in">
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{strings.recording.systemAudioMissing}</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="lg"
          onClick={togglePause}
          disabled={isStarting}
          iconLeft={isPaused ? <IconPlay size={18} /> : <IconPause size={18} />}
          className="min-w-32"
        >
          {isPaused ? strings.recording.resume : strings.recording.pause}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={stop}
          disabled={isStarting}
          loading={phase === 'finishing'}
          iconLeft={phase === 'finishing' ? undefined : <IconStop size={18} />}
          className="min-w-40"
        >
          {strings.recording.stop}
        </Button>
      </div>

      <button
        onClick={() => setShowCancel(true)}
        disabled={phase === 'finishing'}
        className="mt-6 text-sm text-fg-subtle hover:text-danger transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
      >
        {strings.recording.cancel}
      </button>

      <Modal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title={strings.recording.cancelTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCancel(false)}>
              {strings.recording.cancelKeep}
            </Button>
            <Button variant="danger" onClick={cancel}>
              {strings.recording.cancelConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted leading-relaxed">{strings.recording.cancelBody}</p>
      </Modal>
    </div>
  )
}

function MicDenied({
  detail,
  onBack,
  onRetry
}: {
  detail: string
  onBack: () => void
  onRetry: () => void
}): JSX.Element {
  const [showDetail, setShowDetail] = useState(false)
  return (
    <div className="mx-auto max-w-md px-5 py-10 flex flex-col items-center text-center min-h-full justify-center animate-fade-in">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft text-danger mb-6">
        <IconMic size={30} />
      </div>
      <h1 className="text-xl font-semibold text-fg mb-2">{strings.recording.micDeniedTitle}</h1>
      <p className="text-sm text-fg-muted leading-relaxed max-w-sm">
        {strings.recording.micDeniedBody}
      </p>

      <div className="flex items-center gap-3 mt-7">
        <Button variant="ghost" onClick={onBack}>
          {strings.common.back}
        </Button>
        <Button variant="primary" onClick={onRetry}>
          {strings.common.retry}
        </Button>
      </div>

      {detail && (
        <div className="mt-6 w-full text-left">
          <button
            onClick={() => setShowDetail((s) => !s)}
            className="text-xs text-fg-subtle hover:text-fg-muted transition-colors"
          >
            {showDetail ? strings.common.hideDetails : strings.common.showDetails}
          </button>
          {showDetail && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs text-fg-muted font-mono">
              {detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
