import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import type { OutputMode, Recording } from '../types'
import { OUTPUT_MODES } from '../config'
import { cn, formatDuration } from '../lib/utils'
import { useRecorder } from '../audio/useRecorder'
import { Waveform } from './Waveform'
import { Button } from './ui/Button'

const HOLD_THRESHOLD_MS = 320

interface RecorderCardProps {
  hasKeys: boolean
  processing: boolean
  statusLine: string
  maxDurationSec: number
  outputMode: OutputMode
  onOutputModeChange: (mode: OutputMode) => void
  appending?: boolean
  onCancelAppend?: () => void
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
  outputMode,
  onOutputModeChange,
  appending,
  onCancelAppend,
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
  const [holding, setHolding] = useState(false)
  const holdRef = useRef<{ startedAt: number; startedRecording: boolean } | null>(null)
  const spaceDownAtRef = useRef<number | null>(null)

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
    if (!appending) onStartNew()
    void start()
  }, [appending, autoStart, onAutoStartHandled, onStartNew, processing, start, status])

  const isPaused = status === 'paused'
  const requesting = status === 'requesting'
  const active = isRecording

  const begin = () => {
    if (!appending) onStartNew()
    void start()
  }

  const handleCenterClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Pointer interactions are handled by pointerDown/pointerUp for tap + push-to-talk.
    // Keep onClick for keyboard activation (detail === 0).
    if (event.detail !== 0) return
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || processing || requesting) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (!isRecording && !isPaused) {
      holdRef.current = { startedAt: Date.now(), startedRecording: true }
      setHolding(true)
      begin()
    } else {
      holdRef.current = { startedAt: Date.now(), startedRecording: false }
    }
  }

  const handlePointerUp = () => {
    const hold = holdRef.current
    holdRef.current = null
    setHolding(false)
    if (!hold) return

    if (hold.startedRecording) {
      const heldMs = Date.now() - hold.startedAt
      if (heldMs >= HOLD_THRESHOLD_MS && isRecording) {
        stop()
      }
      return
    }

    if (isPaused) {
      resume()
    } else if (isRecording) {
      stop()
    }
  }

  const handlePointerCancel = () => {
    holdRef.current = null
    setHolding(false)
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
      if (isPaused) {
        spaceDownAtRef.current = null
        resume()
      } else if (isRecording) {
        spaceDownAtRef.current = null
        stop()
      } else {
        spaceDownAtRef.current = Date.now()
        setHolding(true)
        begin()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const downAt = spaceDownAtRef.current
      spaceDownAtRef.current = null
      setHolding(false)
      if (downAt != null && Date.now() - downAt >= HOLD_THRESHOLD_MS && isRecording) {
        stop()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
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

        {!processing && (
          <div className="relative px-5 pt-4 sm:px-7">
            <div
              role="radiogroup"
              aria-label="Output mode"
              className="grid grid-cols-4 gap-1 rounded-full border border-line bg-surface-2/80 p-1"
            >
              {OUTPUT_MODES.map((option) => {
                const selected = outputMode === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={active || requesting}
                    title={option.hint}
                    onClick={() => onOutputModeChange(option.id)}
                    className={cn(
                      'rounded-full px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 sm:text-xs',
                      selected
                        ? 'bg-surface text-ink shadow-sm'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            {appending && (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-full border border-marigold/30 bg-marigold-soft/45 px-3 py-1.5 text-xs text-marigold-deep">
                <span className="truncate font-medium">Adding to your last note</span>
                <button
                  type="button"
                  onClick={() => {
                    if (active) cancel()
                    onCancelAppend?.()
                  }}
                  aria-label="Cancel appending to note"
                  className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-marigold/20"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

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
                onClick={handleCenterClick}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onContextMenu={(event) => event.preventDefault()}
                disabled={requesting}
                aria-label={
                  isPaused
                    ? 'Resume recording'
                    : isRecording
                      ? 'Stop recording and transcribe'
                      : 'Tap or hold to record'
                }
                aria-pressed={active}
                aria-keyshortcuts="Space"
                className={[
                  'relative z-10 grid size-24 touch-none select-none place-items-center rounded-full transition-all duration-300 sm:size-28',
                  isRecording || isPaused
                    ? 'bg-rust text-white shadow-lift hover:brightness-95'
                    : 'bg-marigold text-[#23180a] shadow-lift hover:-translate-y-0.5 hover:brightness-[0.98]',
                  holding && isRecording ? 'scale-95' : '',
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
                  {isPaused ? 'Paused' : holding ? 'Release to transcribe' : 'Recording'}
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
                    Tap or hold mic (or{' '}
                    <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] text-ink">
                      Space
                    </kbd>
                    ) · up to {Math.round(maxDurationSec / 60)} min
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
