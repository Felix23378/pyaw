import { useCallback, useEffect, useRef, useState } from 'react'
import type { Recording } from '../types'
import { mimeTypeForApi } from '../gemini/client'
import { needsWavTranscode, transcodeBlobToWav } from './encode'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused'

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

function friendlyMicError(error: unknown): string {
  const name = (error as DOMException)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone permission was denied. Allow mic access in your browser settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect one, then try again.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone is busy in another app. Close it, then try again.'
  }
  if (name === 'OverconstrainedError') {
    return 'Your microphone does not support the required audio settings.'
  }
  return 'Could not start recording. Check your microphone and try again.'
}

interface UseRecorderOptions {
  maxDurationSec: number
  deviceId?: string
  onComplete: (recording: Recording) => void
}

function hapticTick() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12)
    }
  } catch {
    // ignore
  }
}

export function useRecorder({ maxDurationSec, deviceId, onComplete }: UseRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [level, setLevel] = useState(0)
  const [bars, setBars] = useState<number[]>([])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const levelsRef = useRef<number[]>([])
  const barsRef = useRef<number[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const pausedTotalRef = useRef(0)
  const pausedAtRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const startingRef = useRef(false)
  const lastUiRef = useRef(0)

  const clearTimers = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const closeContext = useCallback(() => {
    analyserRef.current = null
    const context = contextRef.current
    contextRef.current = null
    if (context) void context.close().catch(() => {})
  }, [])

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return
    startingRef.current = true

    setError(null)
    setElapsedMs(0)
    setLevel(0)
    setBars([])
    barsRef.current = []
    levelsRef.current = []
    cancelledRef.current = false

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Recording is not supported in this browser. Try Chrome, Safari, or Firefox on a newer device.')
      setStatus('idle')
      startingRef.current = false
      return
    }
    if (!window.isSecureContext) {
      setError('Microphone access needs HTTPS. Open this app on a secure address and try again.')
      setStatus('idle')
      startingRef.current = false
      return
    }

    setStatus('requesting')
    const baseAudioConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
    let stream: MediaStream
    try {
      const audioConstraints: MediaTrackConstraints = deviceId
        ? { ...baseAudioConstraints, deviceId: { exact: deviceId } }
        : baseAudioConstraints
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    } catch (micError) {
      const name = (micError as DOMException)?.name ?? ''
      if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints })
        } catch (fallbackError) {
          setError(friendlyMicError(fallbackError))
          setStatus('idle')
          startingRef.current = false
          return
        }
      } else {
        setError(friendlyMicError(micError))
        setStatus('idle')
        startingRef.current = false
        return
      }
    }

    streamRef.current = stream
    const mimeType = pickMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 })
    } catch {
      try {
        recorder = new MediaRecorder(stream)
      } catch (recorderError) {
        stopTracks()
        setError(friendlyMicError(recorderError))
        setStatus('idle')
        startingRef.current = false
        return
      }
    }

    recorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
    }

    recorder.onerror = () => {
      cancelledRef.current = true
      setError('Recording stopped unexpectedly. Please try again.')
    }

    recorder.onstop = () => {
      const now = Date.now()
      const pausedExtra = pausedAtRef.current ? now - pausedAtRef.current : 0
      const duration = Math.max(
        300,
        now - startedAtRef.current - pausedTotalRef.current - pausedExtra,
      )
      const cancelled = cancelledRef.current
      const chunks = [...chunksRef.current]
      const type = recorder.mimeType || chunks[0]?.type || 'audio/webm'

      clearTimers()
      stopLoop()
      stopTracks()
      closeContext()

      recorderRef.current = null
      pausedAtRef.current = null
      setStatus('idle')
      setLevel(0)
      setElapsedMs(0)

      if (!cancelled && chunks.length > 0) {
        const rawBlob = new Blob(chunks, { type })
        if (rawBlob.size > 0) {
          const levels = levelsRef.current.slice(-96)
          const apiMime = mimeTypeForApi(type)
          hapticTick()
          if (needsWavTranscode(apiMime)) {
            void transcodeBlobToWav(rawBlob)
              .then((wavBlob) => {
                onCompleteRef.current({
                  blob: wavBlob,
                  mimeType: 'audio/wav',
                  durationMs: duration,
                  levels,
                })
              })
              .catch(() => {
                onCompleteRef.current({
                  blob: rawBlob,
                  mimeType: apiMime,
                  durationMs: duration,
                  levels,
                })
              })
          } else {
            onCompleteRef.current({
              blob: rawBlob,
              mimeType: apiMime,
              durationMs: duration,
              levels,
            })
          }
        }
      }
    }

    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioCtor) {
        const context = new AudioCtor()
        await context.resume().catch(() => {})
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.72
        const source = context.createMediaStreamSource(stream)
        source.connect(analyser)
        contextRef.current = context
        analyserRef.current = analyser
      }
    } catch {
      // A missing analyser only affects the visualizer, not the recording.
    }

    startedAtRef.current = Date.now()
    pausedTotalRef.current = 0
    pausedAtRef.current = null
    lastUiRef.current = 0

    try {
      recorder.start(1000)
    } catch (startError) {
      stopTracks()
      closeContext()
      recorderRef.current = null
      setError(friendlyMicError(startError))
      setStatus('idle')
      startingRef.current = false
      return
    }

    setStatus('recording')
    hapticTick()

    timerRef.current = window.setInterval(() => {
      const now = Date.now()
      const pausedExtra = pausedAtRef.current ? now - pausedAtRef.current : 0
      const elapsed = Math.max(
        0,
        now - startedAtRef.current - pausedTotalRef.current - pausedExtra,
      )
      setElapsedMs(elapsed)
      if (elapsed >= maxDurationSec * 1000 && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // already stopping
        }
      }
    }, 200)

    const loop = () => {
      const analyser = analyserRef.current
      if (!analyser) return
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const sample of data) {
        const normalized = (sample - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / data.length)
      const value = Math.min(1, rms * 3.4)
      const now = performance.now()

      if (now - lastUiRef.current >= 70) {
        lastUiRef.current = now
        if (recorderRef.current?.state === 'paused') {
          setLevel(0)
        } else {
          setLevel(value)
          const bar = Math.max(0.05, Math.min(1, value))
          const next = [...barsRef.current, bar].slice(-56)
          barsRef.current = next
          setBars(next)
          levelsRef.current = [...levelsRef.current, bar].slice(-3000)
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()

    startingRef.current = false
  }, [clearTimers, closeContext, deviceId, maxDurationSec, stopLoop, stopTracks])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // already stopping
      }
    }
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
  }, [stop])

  const pause = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') {
      recorder.pause()
      pausedAtRef.current = Date.now()
      setStatus('paused')
      setLevel(0)
    }
  }, [])

  const resume = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder?.state === 'paused') {
      if (pausedAtRef.current) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current
        pausedAtRef.current = null
      }
      recorder.resume()
      setStatus('recording')
    hapticTick()
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      clearTimers()
      stopLoop()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      recorderRef.current = null
      stopTracks()
      closeContext()
    }
  }, [clearTimers, closeContext, stopLoop, stopTracks])

  return {
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
    clearError: () => setError(null),
    isRecording: status === 'recording' || status === 'paused',
    isBusy: status !== 'idle',
  }
}
