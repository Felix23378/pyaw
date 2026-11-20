import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { transcribeRecording } from '../services/transcribe'
import { TranscriptionError } from '../retry/orchestrator'
import { saveAudio } from '../storage/idb'
import { deletePending, listPending, listPendingMeta, updatePending } from '../storage/idb'

export function usePendingQueue(): void {
  const settings = useAppStore((store) => store.settings)
  const addRecent = useAppStore((store) => store.addRecent)
  const setPending = useAppStore((store) => store.setPending)
  const notify = useAppStore((store) => store.notify)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const runningRef = useRef(false)

  const run = useCallback(async () => {
    if (runningRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (settingsRef.current.keys.length === 0) return

    runningRef.current = true
    let completed = 0

    try {
      const items = await listPending()
      for (const item of items) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break
        try {
          const entry = await transcribeRecording({
            recording: item,
            settings: settingsRef.current,
            source: 'queue',
          })
          let saved = entry
          if (settingsRef.current.keepAudio) {
            try {
              const audioId = await saveAudio(entry.id, item.blob)
              saved = { ...entry, audioId }
            } catch {
              // optional
            }
          }
          addRecent(saved)
          await deletePending(item.id)
          completed += 1
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Could not transcribe this recording.'
          await updatePending(item.id, {
            attempts: item.attempts + 1,
            lastError: message,
          }).catch(() => {})
          if (
            error instanceof TranscriptionError &&
            (error.kind === 'no_keys' ||
              error.kind === 'no_models' ||
              error.kind === 'invalid_key' ||
              error.kind === 'daily_quota' ||
              error.kind === 'rate_limit' ||
              error.kind === 'aborted')
          ) {
            break
          }
          break
        }
      }
    } finally {
      runningRef.current = false
      try {
        setPending(await listPendingMeta())
      } catch {
        // IndexedDB may be unavailable in private windows.
      }
    }

    if (completed > 0) {
      notify(
        `${completed} saved thought${completed === 1 ? '' : 's'} transcribed`,
      )
    }
  }, [addRecent, notify, setPending])

  useEffect(() => {
    const handle = () => {
      void run()
    }
    window.addEventListener('online', handle)
    const initial = window.setTimeout(handle, 1_200)
    const interval = window.setInterval(handle, 5 * 60 * 1000)
    return () => {
      window.removeEventListener('online', handle)
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [run])

  useEffect(() => {
    if (settings.keys.length === 0) return
    const timer = window.setTimeout(() => void run(), 800)
    return () => window.clearTimeout(timer)
  }, [settings.keys.length, run])
}
