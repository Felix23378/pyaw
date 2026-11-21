import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, RefreshCw, X } from 'lucide-react'
import type { Recording } from './types'
import { Header } from './components/Header'
import { RecorderCard } from './components/RecorderCard'
import { RecentsDetail } from './components/RecentsDetail'
import { RecentsPanel } from './components/RecentsPanel'
import { SettingsSheet } from './components/SettingsSheet'
import { Toast } from './components/Toast'
import { TranscriptCard } from './components/TranscriptCard'
import { WelcomeSheet } from './components/WelcomeSheet'
import { Button } from './components/ui/Button'
import { useHealth } from './hooks/useHealth'
import { useOnline } from './hooks/useOnline'
import { usePendingQueue } from './hooks/usePendingQueue'
import { useTheme } from './hooks/useTheme'
import { useTranscription } from './hooks/useTranscription'
import { useAppStore } from './store/useAppStore'
import { listPendingMeta } from './storage/idb'
import { useRegisterSW } from 'virtual:pwa-register/react'

function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  const [busy, setBusy] = useState(false)

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 top-[68px] z-40 flex justify-center px-4">
      <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs shadow-lift animate-pop-in">
        <RefreshCw className="size-3.5 shrink-0 text-marigold-deep" />
        <span className="min-w-0 flex-1 truncate">A new version of Pyaw is ready.</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void updateServiceWorker(true)
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-marigold px-2.5 py-1 font-semibold text-[#23180a] disabled:opacity-50"
        >
          {busy ? <RefreshCw className="size-3 animate-spin" /> : <Check className="size-3" />}
          Update
        </button>
        <button
          type="button"
          aria-label="Dismiss update"
          onClick={() => setNeedRefresh(false)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function OfflineBanner() {
  const online = useOnline()
  const pendingCount = useAppStore((store) => store.pending.length)
  if (online) return null

  return (
    <div className="flex items-center justify-center gap-2 border-b border-line/60 bg-surface-2/60 px-4 py-2 text-center text-[11px] text-muted">
      <span className="size-1.5 rounded-full bg-rust" />
      You’re offline — record now and we’ll transcribe it when you reconnect.
      {pendingCount > 0 && <span className="font-medium text-ink">{pendingCount} waiting</span>}
    </div>
  )
}

function Footer() {
  return (
    <footer className="safe-bottom mx-auto mt-10 w-full max-w-[1120px] px-4 pb-8 sm:px-6">
      <div className="flex flex-col items-center gap-2 border-t border-line/60 pt-5 text-center text-[11px] leading-relaxed text-muted sm:flex-row sm:justify-between sm:text-left">
        <p>
          Pyaw · <span className="font-mm">ပြော</span> · Speak first, type never.
        </p>
        <p className="flex items-center gap-1.5">
          <span className="size-1 rounded-full bg-jade" />
          Keys &amp; transcripts stay in this browser
        </p>
      </div>
    </footer>
  )
}

export default function App() {
  useTheme()
  usePendingQueue()

  const online = useOnline()
  useHealth()

  const settings = useAppStore((store) => store.settings)
  const updateSettings = useAppStore((store) => store.updateSettings)
  const onboarded = useAppStore((store) => store.onboarded)
  const settingsOpen = useAppStore((store) => store.settingsOpen)
  const setSettingsOpen = useAppStore((store) => store.setSettingsOpen)
  const setWelcomeOpen = useAppStore((store) => store.setWelcomeOpen)
  const setPending = useAppStore((store) => store.setPending)

  const transcription = useTranscription()
  const recorderRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const hasOpenedWelcome = useRef(false)
  const [autoStartRecord, setAutoStartRecord] = useState(false)
  const [appendEntryId, setAppendEntryId] = useState<string | null>(null)

  const hasKeys = settings.keys.length > 0

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('record') === '1') {
      params.delete('record')
      const cleanSearch = params.toString()
      const nextUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', nextUrl)
      hasOpenedWelcome.current = true
      setAutoStartRecord(true)
    }
  }, [])

  useEffect(() => {
    if (onboarded || hasOpenedWelcome.current) return
    hasOpenedWelcome.current = true
    setWelcomeOpen(true)
  }, [onboarded, setWelcomeOpen])

  useEffect(() => {
    listPendingMeta()
      .then(setPending)
      .catch(() => {})
  }, [setPending])

  const scrollToResult = useCallback(() => {
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }, [])

  const handleRecording = useCallback(
    (recording: Recording) => {
      const targetId = appendEntryId
      setAppendEntryId(null)
      scrollToResult()
      void transcription.transcribe(recording, targetId ? { appendToEntryId: targetId } : undefined)
    },
    [appendEntryId, scrollToResult, transcription],
  )

  const handleContinue = useCallback((entryId: string) => {
    setAppendEntryId(entryId)
    recorderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setAutoStartRecord(true)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <OfflineBanner />
      <UpdateBanner />

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-5 sm:px-6 sm:pt-7">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:gap-7">
          <div className="space-y-5">
            <div ref={recorderRef} className="scroll-mt-24">
              <RecorderCard
                hasKeys={hasKeys}
                processing={transcription.status === 'processing'}
                statusLine={transcription.statusLine}
                maxDurationSec={settings.maxDurationSec}
                outputMode={settings.outputMode}
                onOutputModeChange={(mode) => updateSettings({ outputMode: mode })}
                appending={Boolean(appendEntryId)}
                onCancelAppend={() => setAppendEntryId(null)}
                audioDeviceId={settings.audioDeviceId}
                autoStart={autoStartRecord}
                onAutoStartHandled={() => setAutoStartRecord(false)}
                onRecording={handleRecording}
                onStartNew={() => {
                  setAppendEntryId(null)
                  transcription.reset()
                }}
                onCancelProcessing={transcription.cancel}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>

            <div ref={resultRef} className="scroll-mt-24">
              <TranscriptCard
                state={transcription}
                online={online}
                onRetry={transcription.retry}
                onCancel={transcription.cancel}
                onSaveForLater={transcription.saveForLater}
                onOpenSettings={() => setSettingsOpen(true)}
                onContinue={handleContinue}
                onReset={() => {
                  setAppendEntryId(null)
                  transcription.reset()
                }}
              />
            </div>

            {!hasKeys && transcription.status === 'idle' && (
              <section className="paper-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div>
                  <h2 className="text-sm font-semibold">Transcribe in three taps</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Paste one free Gemini key, allow the mic, and your first Burmese thought
                    becomes text.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className="shrink-0 self-start sm:self-auto"
                >
                  Add a key
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </section>
            )}
          </div>

          <RecentsPanel />
        </div>
      </main>

      <Footer />

      <RecentsDetail />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <WelcomeSheet />
      <Toast />
    </div>
  )
}
