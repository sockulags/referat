import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { strings } from '../strings'
import { formatDuration } from '../format'
import { MeetingRecorder, isMicPermissionError } from '../audio/recorder'
import { meetingMicrophoneId } from '../audio/microphoneChoice'
import { LiveQueue, type LiveState } from '../audio/live'
import { isLiveTranscriptionOn } from '../../../shared/live'
import { LevelMeter } from '../components/LevelMeter'
import { Button, IconButton } from '../components/ui/Button'
import { ConfirmModal } from '../components/ui/ConfirmModal'
import { ErrorDetail } from '../components/ErrorDetail'
import {
  IconMic,
  IconWave,
  IconPause,
  IconPlay,
  IconStop,
  IconAlert,
  IconX
} from '../components/icons'
import { ConsentButton } from '../components/ConsentButton'
import { cn } from '../components/ui/cn'

type Phase = 'starting' | 'recording' | 'paused' | 'mic-denied' | 'finishing'

export function Recording(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const settings = useApp((s) => s.settings)
  const pendingTitle = useApp((s) => s.pendingTitle)
  const pendingStart = useApp((s) => s.pendingStart)

  const [phase, setPhase] = useState<Phase>('starting')
  const [elapsed, setElapsed] = useState(0)
  const [showConsent, setShowConsent] = useState(true)
  const [levels, setLevels] = useState({ mic: 0, system: 0 })
  const [systemMissing, setSystemMissing] = useState(false)
  const [hasSystem, setHasSystem] = useState(false)
  const [micDetail, setMicDetail] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const liveOn =
    !!settings &&
    isLiveTranscriptionOn(
      settings.transcription.live,
      settings.transcription.preset,
      settings.transcription.baseUrl
    )
  const [live, setLive] = useState<LiveState>({ entries: [], status: 'waiting' })

  const recorderRef = useRef<MeetingRecorder | null>(null)
  const liveQueueRef = useRef<LiveQueue | null>(null)
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
    const liveQueue = liveOn
      ? new LiveQueue(
          (w) => window.api.transcribeLive(w.audio, meetingIdRef.current ?? undefined),
          setLive
        )
      : null
    liveQueueRef.current = liveQueue

    ;(async (): Promise<void> => {
      try {
        const handle = await window.api.startRecording(
          pendingTitle,
          pendingStart.templateId || settings?.summary.defaultTemplateId,
          pendingStart.projectId || undefined
        )
        meetingIdRef.current = handle.meetingId
        // Left on the system default, a meeting uses the microphone dictation
        // would pick, so a Bluetooth headset is avoided the same way.
        const microphoneId = meetingMicrophoneId(
          settings?.microphoneId ?? '',
          await window.api.getDictationMicrophone().catch(() => null),
          await navigator.mediaDevices.enumerateDevices().catch(() => [])
        )
        await recorder.start({
          microphoneId,
          captureSystemAudio: settings?.captureSystemAudio ?? false,
          onChunk: async (chunk, segmentIndex) => {
            if (meetingIdRef.current) {
              await window.api.appendAudioChunk(meetingIdRef.current, chunk, segmentIndex)
            }
          },
          onSystemAudioUnavailable: () => setSystemMissing(true),
          onLiveWindow: liveQueue ? (w) => liveQueue.push(w) : undefined
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
      liveQueueRef.current?.stop()
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

  // A calendar meeting that is over: ask whether to stop, or stop as main says.
  const [meetingEnded, setMeetingEnded] = useState<{ stopAt: string } | null>(null)
  const stopRef = useRef<() => Promise<void>>(async () => {})
  useEffect(
    () =>
      window.api.onCalendarRecordingEnd((e) => {
        if (e.state === 'ask') setMeetingEnded({ stopAt: e.stopAt })
        else setMeetingEnded(null)
        if (e.state === 'stop') void stopRef.current()
      }),
    []
  )

  const keepRecording = (): void => {
    setMeetingEnded(null)
    void window.api.keepCalendarRecording()
  }

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
    liveQueueRef.current?.stop()
    const rec = recorderRef.current
    const id = meetingIdRef.current
    try {
      await rec?.stop()
      const durationSec = Math.floor(elapsedMsRef.current / 1000)
      if (id) {
        const envelope = rec?.getEnvelope()
        // Best-effort: losing the envelope costs the speaker labels, not the
        // meeting, so it must never block finishing the recording.
        if (envelope && envelope.mic.length > 0) {
          await window.api.saveLevelEnvelope(id, envelope).catch(() => undefined)
        }
        await window.api.finishRecording(id, durationSec)
        navigate('meeting', id)
        return
      }
    } catch {
      /* fall through to home */
    }
    navigate('home')
  }

  useEffect(() => {
    stopRef.current = stop
  })

  const cancel = async (): Promise<void> => {
    const rec = recorderRef.current
    const id = meetingIdRef.current
    liveQueueRef.current?.stop()
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

      {meetingEnded && phase !== 'finishing' && (
        <div
          role="alert"
          className="w-full mb-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-border-strong bg-surface py-3 px-4 text-left text-sm animate-fade-in"
        >
          <div className="min-w-0 flex-[1_1_220px]">
            <p className="font-medium text-fg">{strings.recording.calendarEndTitle}</p>
            <p className="text-fg-muted">
              {strings.recording.calendarEndBody(
                new Date(meetingEnded.stopAt).toLocaleTimeString('sv-SE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={keepRecording}>
              {strings.recording.calendarKeep}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void stop()}>
              {strings.recording.calendarStop}
            </Button>
          </div>
        </div>
      )}

      {showConsent && (
        <div
          role="note"
          className="w-full mb-6 flex items-start gap-2 rounded-[10px] bg-accent-soft py-3 pl-4 pr-2 text-left text-sm text-accent-soft-fg animate-fade-in"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <span className="min-w-0 flex-[1_1_200px]">{strings.consent.reminder}</span>
            <ConsentButton />
          </div>
          <IconButton
            size="sm"
            label={strings.consent.dismiss}
            onClick={() => setShowConsent(false)}
          >
            <IconX size={16} />
          </IconButton>
        </div>
      )}

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

      {liveOn && !isStarting && <LivePanel state={live} />}

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

      <ConfirmModal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title={strings.recording.cancelTitle}
        confirmLabel={strings.recording.cancelConfirm}
        cancelLabel={strings.recording.cancelKeep}
        onConfirm={cancel}
      >
        {strings.recording.cancelBody}
      </ConfirmModal>
    </div>
  )
}

/** The running preview text. Follows the newest line unless the reader has scrolled up. */
function LivePanel({ state }: { state: LiveState }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [state.entries])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const notice =
    state.status === 'unavailable'
      ? strings.recording.liveUnavailable
      : state.status === 'behind'
        ? strings.recording.liveBehind
        : null

  return (
    <section
      aria-label={strings.recording.liveTitle}
      className="w-full mb-8 text-left rounded-[10px] border border-border bg-surface animate-fade-in"
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="text-sm font-medium text-fg">{strings.recording.liveTitle}</h2>
        <span className="text-xs text-fg-subtle">{strings.recording.liveNote}</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        data-testid="live-transcript"
        className="max-h-48 overflow-y-auto px-4 pb-3 flex flex-col gap-2"
      >
        {state.entries.length === 0 ? (
          <p className="text-sm text-fg-subtle">{strings.recording.liveWaiting}</p>
        ) : (
          state.entries.map((entry, i) =>
            entry.kind === 'gap' ? (
              <p key={i} className="text-xs italic text-fg-subtle">
                {formatDuration(Math.floor(entry.startSec))} · {strings.recording.liveGap}
              </p>
            ) : (
              <p key={i} className="text-sm text-fg leading-relaxed">
                <span className="mr-2 text-xs tabular-nums text-fg-subtle">
                  {formatDuration(Math.floor(entry.startSec))}
                </span>
                {entry.text}
              </p>
            )
          )
        )}
      </div>
      {notice && <p className="border-t border-border px-4 py-2 text-xs text-fg-muted">{notice}</p>}
    </section>
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

      {detail && <ErrorDetail detail={detail} className="mt-6 w-full text-left" />}
    </div>
  )
}
