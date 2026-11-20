import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { Recording } from '../types'
import { formatDuration } from '../lib/utils'
import { useRecorder } from '../audio/useRecorder'
import { Waveform } from './Waveform'
import { Button } from './ui/Button'

interface RecorderCardProps {
  hasKeys: boolean
  processing: boolean
  statusLine: string
  maxDurationSec: number
  audioDeviceId?: string
  autoStart?: boolean
  onAutoStartHandled?: () => void
  onRecording: (recording: Recording) => void
  onStartNew: () => void
  onCancelProcessing: () => void
  onOpenSettings: () => void
}

export function RecorderCard({
  hasKeys,
  processing,
  statusLine,
  maxDurationSec,
  audioDeviceId,
  autoStart,
  onAutoStartHandled,
  onRecording,
  onStartNew,
  onCancelProcessing,
  onOpenSettings,
}: RecorderCardProps) {
  const {
    status,
    level,
    bars,
    elapsedMs,
    error,
    start,
    stop,
    pause,
    resume,
    cancel,
    clearError,
    isRecording,
  } = useRecorder({ maxDurationSec, deviceId: audioDeviceId, onComplete: onRecording })

  const cardRef = useRef<HTMLElement>(null)
  const [cardOffscreen, setCardOffscreen] = useState(false)

  useEffect(() => {
    const node = cardRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setCardOffscreen(!entry.isIntersecting)
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!autoStart || processing || status !== 'idle') return
    onAutoStartHandled?.()
    onStartNew()
    void start()
  }, [autoStart, onAutoStartHandled, onStartNew, processing, start, status])

  const isPaused = status === 'paused'
  const requesting = status === 'requesting'
  const active = isRecording

  const begin = () => {
    onStartNew()
    void start()
  }

  const handleCenter = () => {
    if (processing || requesting) return
    if (isPaused) {
      resume()
      return
    }
    if (isRecording) {
      stop()
      return
    }
    begin()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      if (processing || requesting) return
      if (document.querySelector('[data-modal-open]')) return
      const target = event.target as HTMLElement | null
      if (
        target?.closest(
          'button, a, input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      ) {
        return
      }
      event.preventDefault()
      if (isPaused) resume()
      else if (isRecording) stop()
      else begin()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <>
      <section ref={cardRef} className="paper-card relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-marigold/10 blur-3xl" />

        <div className="relative flex items-start justify-between gap-3 p-5 pb-0 sm:p-7 sm:pb-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              {processing ? 'Transcribing' : active ? 'Recording' : 'New thought'}
            </p>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">
              {processing
                ? 'Writing it down…'
                : isPaused
                  ? 'Paused'
                  : isRecording
                    ? 'Listening…'
                    : 'Say what’s on your mind'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {processing
                ? 'Gemini is turning your voice into text.'
                : 'Burmese voice · English controls'}
            </p>
          </div>

          {hasKeys ? (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-jade/10 px-2.5 py-1.5 text-[11px] font-medium text-jade sm:inline-flex">
              <span className="size-1.5 rounded-full bg-jade" />
              Gemini ready
            </span>
          ) : (
            <Button variant="soft" size="sm" onClick={onOpenSettings} className="shrink-0">
              <KeyRound className="size-3.5" />
              Add key
            </Button>
          )}
        </div>

        {processing ? (
          <div className="relative flex flex-col items-center px-5 pb-7 pt-7 sm:px-7">
            <div className="relative grid size-24 place-items-center rounded-full bg-marigold-soft/60 sm:size-28">
              <span className="pulse-ring absolute inset-0 rounded-full border border-marigold/50" />
              <Loader2 className="size-9 animate-spin text-marigold-deep" />
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-marigold-deep" />
              Listening closely
            </p>
            <p className="mt-1 min-h-5 max-w-sm text-center text-xs leading-relaxed text-muted">
              {statusLine || 'Sending your recording to Gemini…'}
            </p>
            <Button variant="ghost" size="sm" onClick={onCancelProcessing} className="mt-4">
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="relative flex flex-col items-center px-5 pb-6 pt-6 sm:px-7">
            <div className="relative grid place-items-center">
              {active && (
                <span
                  className="absolute size-32 rounded-full border border-marigold/50 transition-transform duration-100 sm:size-36"
                  style={{
                    transform: `scale(${1 + level * 0.22})`,
                    opacity: 0.35 + level * 0.5,
                  }}
                />
              )}
              {active && !isPaused && (
                <span className="pulse-ring absolute size-32 rounded-full border border-marigold/40 sm:size-36" />
              )}
              <button
                type="button"
                onClick={handleCenter}
                disabled={requesting}
                aria-label={
                  isPaused
                    ? 'Resume recording'
                    : isRecording
                      ? 'Stop recording and transcribe'
                      : 'Start recording'
                }
                aria-pressed={active}
                aria-keyshortcuts="Space"
                className={[
                  'relative z-10 grid size-24 place-items-center rounded-full transition-all duration-300 sm:size-28',
                  isRecording || isPaused
                    ? 'bg-rust text-white shadow-lift hover:brightness-95'
                    : 'bg-marigold text-[#23180a] shadow-lift hover:-translate-y-0.5 hover:brightness-[0.98]',
                  requesting ? 'cursor-wait opacity-70' : '',
                ].join(' ')}
              >
                {requesting ? (
                  <Loader2 className="size-9 animate-spin" />
                ) : isPaused ? (
                  <Play className="size-10 fill-current pl-1" />
                ) : isRecording ? (
                  <Square className="size-9 fill-current" />
                ) : (
                  <Mic className="size-10" strokeWidth={1.8} />
                )}
              </button>
            </div>

            <div className="mt-5 flex items-center gap-2 text-sm">
              <span className="tabular text-base font-semibold tracking-tight">
                {formatDuration(elapsedMs)}
              </span>
              <span className="text-xs text-muted">/ {Math.round(maxDurationSec / 60)}:00</span>
              {active && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span
                    className={`size-1.5 rounded-full ${isPaused ? 'bg-muted' : 'bg-rust'}`}
                  />
                  {isPaused ? 'Paused' : 'Recording'}
                </span>
              )}
            </div>

            <Waveform
              bars={active ? bars : []}
              active={active && !isPaused}
              className="mt-2 w-full max-w-md"
            />

            {active ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={isPaused ? resume : pause}
                >
                  {isPaused ? <Play className="size-3.5 fill-current" /> : <Pause className="size-3.5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="primary" size="md" onClick={stop}>
                  <Square className="size-3.5 fill-current" />
                  Stop & transcribe
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cancel}
                  aria-label="Discard recording"
                  title="Discard recording"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-center text-xs text-muted">
                {requesting ? (
                  'Waiting for microphone permission…'
                ) : (
                  <>
                    Tap the mic, or press{' '}
                    <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] text-ink">
                      Space
                    </kbd>{' '}
                    · up to {Math.round(maxDurationSec / 60)} min
                  </>
                )}
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 flex w-full items-start gap-2.5 rounded-2xl bg-rust/10 px-3.5 py-3 text-sm text-rust"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="flex-1 text-[13px] leading-relaxed">{error}</p>
                <button
                  type="button"
                  onClick={clearError}
                  aria-label="Dismiss microphone error"
                  className="rounded-full p-0.5 hover:bg-rust/10"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {!hasKeys && !processing && (
          <div className="relative border-t border-line/70 bg-surface-2/40 px-5 py-3.5 sm:px-7">
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-ink">One step first:</span> add a Gemini API
              key to transcribe. It stays in this browser.
            </p>
          </div>
        )}
      </section>

      {active && (
        <div
          className="fixed inset-x-3 z-40 md:hidden"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2.5 pl-4 shadow-lift backdrop-blur-xl">
            <span
              className={`size-2 rounded-full ${isPaused ? 'bg-muted' : 'animate-pulse bg-rust'}`}
            />
            <span className="tabular text-sm font-semibold">{formatDuration(elapsedMs)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {isPaused ? 'Paused' : 'Recording your thought'}
            </span>
            <Button variant="primary" size="sm" onClick={stop}>
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          </div>
        </div>
      )}

      {!active && !processing && cardOffscreen && (
        <div
          className="fixed inset-x-3 z-40 md:hidden"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2 pl-4 shadow-lift backdrop-blur-xl">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">
              Ready to record a new thought
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={requesting}
              onClick={() => {
                cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                begin()
              }}
            >
              <Mic className="size-3.5" />
              Record
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
