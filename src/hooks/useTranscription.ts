import { useCallback, useRef, useState } from 'react'
import type { Recording, TranscriptEntry } from '../types'
import { useAppStore } from '../store/useAppStore'
import { transcribeRecording } from '../services/transcribe'
import { TranscriptionError, type AttemptEvent } from '../retry/orchestrator'
import { copyText } from '../lib/clipboard'
import { prettyModel } from '../lib/utils'
import { listPendingMeta, pruneAudio, saveAudio, savePending } from '../storage/idb'

export type TranscriptionStatus = 'idle' | 'processing' | 'success' | 'queued' | 'error'

export interface TranscriptionState {
  status: TranscriptionStatus
  partial: string
  entry: TranscriptEntry | null
  error: Error | null
  recording: Recording | null
  events: AttemptEvent[]
  statusLine: string
}

const initialState: TranscriptionState = {
  status: 'idle',
  partial: '',
  entry: null,
  error: null,
  recording: null,
  events: [],
  statusLine: '',
}

export function describeAttempt(event: AttemptEvent): string {
  if (event.type === 'attempt') {
    return `Trying ${prettyModel(event.model)} · ${event.keyLabel}`
  }
  if (event.type === 'success') {
    return `Done with ${prettyModel(event.model)}`
  }
  if (event.type === 'wait') {
    if (event.waitMs) return `Waiting ${Math.ceil(event.waitMs / 1000)}s…`
    return event.message ?? 'Waiting…'
  }
  switch (event.kind) {
    case 'daily_quota':
      return `Out of quota on ${event.keyLabel} — switching key…`
    case 'rate_limit':
      return `Rate limited on ${event.keyLabel} — backing off…`
    case 'invalid_key':
      return `${event.keyLabel} was rejected — trying another key…`
    case 'busy':
      return `${prettyModel(event.model)} is busy — trying another model…`
    case 'network':
      return `Network hiccup — trying another model…`
    case 'model_gone':
      return `${prettyModel(event.model)} unavailable — trying another model…`
    default:
      return event.message ?? 'Retrying…'
  }
}

export function useTranscription() {
  const [state, setState] = useState<TranscriptionState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  const settings = useAppStore((store) => store.settings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const addRecent = useAppStore((store) => store.addRecent)
  const notify = useAppStore((store) => store.notify)

  const abortRef = useRef<AbortController | null>(null)

  const queueRecording = useCallback(
    async (recording: Recording) => {
      try {
        await savePending(recording)
        useAppStore.getState().setPending(await listPendingMeta())
        setState({
          status: 'queued',
          partial: '',
          entry: null,
          error: null,
          recording,
          events: [],
          statusLine: '',
        })
        notify('Saved — we’ll transcribe it when you’re back online')
      } catch (queueError) {
        const error =
          queueError instanceof Error
            ? queueError
            : new Error('Could not save this recording for later.')
        setState((previous) => ({
          ...previous,
          status: 'error',
          error,
          recording,
          partial: '',
        }))
        notify(error.message, 'error')
      }
    },
    [notify],
  )

  const transcribe = useCallback(
    async (recording: Recording) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queueRecording(recording)
        return
      }

      setState({
        status: 'processing',
        partial: '',
        entry: null,
        error: null,
        recording,
        events: [],
        statusLine: 'Warming up Gemini…',
      })

      try {
        const entry = await transcribeRecording({
          recording,
          settings: settingsRef.current,
          source: 'live',
          signal: controller.signal,
          onPartial: (text) =>
            setState((previous) =>
              previous.status === 'processing' ? { ...previous, partial: text } : previous,
            ),
          onEvent: (event) =>
            setState((previous) =>
              previous.status === 'processing'
                ? {
                    ...previous,
                    events: [...previous.events, event].slice(-24),
                    statusLine: describeAttempt(event),
                  }
                : previous,
            ),
          onStatus: (message) =>
            setState((previous) =>
              previous.status === 'processing' ? { ...previous, statusLine: message } : previous,
            ),
        })

        let saved = entry
        if (settingsRef.current.keepAudio) {
          try {
            const audioId = await saveAudio(entry.id, recording.blob)
            saved = { ...entry, audioId }
          } catch {
            // Keeping audio is optional; never fail a transcript over it.
          }
        }
        addRecent(saved)
        setState((previous) => ({
          ...previous,
          status: 'success',
          partial: '',
          entry: saved,
          error: null,
          statusLine: '',
        }))

        if (settingsRef.current.autoCopy && saved.text !== '[no speech]') {
          const copied = await copyText(saved.text)
          notify(copied ? 'Copied to clipboard' : 'Saved to recents — tap Copy')
        } else {
          notify('Transcript saved to recents')
        }

        void pruneAudio()
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
          void navigator.storage.persist().catch(() => {})
        }
      } catch (error) {
        if (error instanceof TranscriptionError && error.kind === 'aborted') {
          return
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await queueRecording(recording)
          return
        }
        const normalized = error instanceof Error ? error : new Error('Transcription failed.')
        setState((previous) => ({
          ...previous,
          status: 'error',
          partial: '',
          entry: null,
          error: normalized,
          recording,
          statusLine: '',
        }))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [addRecent, notify, queueRecording],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(initialState)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(initialState)
  }, [])

  const retry = useCallback(() => {
    const recording = stateRef.current.recording
    if (recording) void transcribe(recording)
  }, [transcribe])

  const saveForLater = useCallback(() => {
    const recording = stateRef.current.recording
    if (recording) void queueRecording(recording)
  }, [queueRecording])

  return {
    ...state,
    transcribe,
    cancel,
    reset,
    retry,
    saveForLater,
  }
}
