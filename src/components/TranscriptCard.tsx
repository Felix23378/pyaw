import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  CloudOff,
  Loader2,
  Mic,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { TranscriptionState } from '../hooks/useTranscription'
import { errorCopy } from '../services/transcribe'
import { shareText } from '../lib/clipboard'
import { cn, formatDuration, formatRelative, prettyModel } from '../lib/utils'
import { useAppStore } from '../store/useAppStore'
import { CopyButton } from './CopyButton'
import { Button } from './ui/Button'
import type { AttemptEvent } from '../retry/orchestrator'

interface TranscriptCardProps {
  state: TranscriptionState
  online: boolean
  onRetry: () => void
  onCancel: () => void
  onSaveForLater: () => void
  onOpenSettings: () => void
  onContinue: (entryId: string) => void
  onReset: () => void
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
      {children}
    </span>
  )
}

function attemptLabel(event: AttemptEvent): string {
  if (event.type === 'attempt') {
    return `${prettyModel(event.model)} · ${event.keyLabel}`
  }
  if (event.type === 'success') return `Success on ${prettyModel(event.model)}`
  if (event.type === 'wait') return event.message ?? 'Waiting'
  return event.message ?? event.kind ?? 'Retrying'
}

function AttemptList({ events }: { events: AttemptEvent[] }) {
  const visible = events.filter((event) => event.type !== 'success').slice(-6).reverse()
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted">No attempts recorded yet. This error happened before the request went out.</p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {visible.map((event, index) => (
        <li
          key={`${event.at}-${index}`}
          className="flex items-start gap-2 rounded-xl bg-surface-2/70 px-2.5 py-2"
        >
          <span
            className={cn(
              'mt-1.5 size-1.5 shrink-0 rounded-full',
              event.kind === 'daily_quota' || event.kind === 'invalid_key'
                ? 'bg-rust'
                : event.type === 'attempt'
                  ? 'bg-marigold-deep'
                  : 'bg-muted',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted">
              Attempt {event.index} · {new Date(event.at).toLocaleTimeString()}
            </p>
            <p className="truncate text-xs text-ink">{attemptLabel(event)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function TranscriptCard({
  state,
  online,
  onRetry,
  onCancel,
  onSaveForLater,
  onOpenSettings,
  onContinue,
  onReset,
}: TranscriptCardProps) {
  const storedEntry = useAppStore((store) =>
    state.entry ? store.recents.find((entry) => entry.id === state.entry?.id) ?? null : null,
  )
  const updateRecent = useAppStore((store) => store.updateRecent)
  const removeRecent = useAppStore((store) => store.removeRecent)
  const notify = useAppStore((store) => store.notify)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const entry = storedEntry

  useEffect(() => {
    setEditing(false)
  }, [entry?.id])

  if (state.status === 'idle') return null

  if (state.status === 'processing') {
    return (
      <section className="paper-card animate-soft-in p-5 sm:p-7" aria-busy="true">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Transcript
            </p>
            <h2 className="mt-1.5 text-lg font-semibold">Listening closely</h2>
          </div>
          <Loader2 className="size-5 animate-spin text-marigold-deep" />
        </div>

        <p className="mt-1.5 min-h-5 text-xs text-muted" aria-live="polite">
          {state.statusLine || 'Sending your recording to Gemini…'}
        </p>

        <div className="mt-5 min-h-[110px]">
          {state.partial ? (
            <p className="mm-text whitespace-pre-wrap text-[17px] text-ink">{state.partial}</p>
          ) : (
            <div className="space-y-3" aria-hidden="true">
              <div className="skeleton h-4 w-[92%] rounded-full" />
              <div className="skeleton h-4 w-[78%] rounded-full" />
              <div className="skeleton h-4 w-[64%] rounded-full" />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="size-3.5" />
            Cancel
          </Button>
          <span className="text-[11px] text-muted">
            Retries switch models or keys automatically.
          </span>
        </div>

        {state.events.length > 0 && (
          <details className="group mt-4 border-t border-line/70 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted hover:text-ink">
              <ChevronDown className="size-3 transition group-open:rotate-180" />
              Attempt details ({state.events.length})
            </summary>
            <div className="mt-3">
              <AttemptList events={state.events} />
            </div>
          </details>
        )}
      </section>
    )
  }

  if (state.status === 'queued') {
    return (
      <section className="paper-card animate-soft-in border-jade/25 p-5 sm:p-7" role="status">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-jade/10 text-jade">
            <CloudOff className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Saved for later</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Your recording is safe on this device. We’ll transcribe it automatically when
              you’re back online.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                disabled={!online}
              >
                <RefreshCw className="size-3.5" />
                {online ? 'Try now' : 'Waiting for connection'}
              </Button>
              {state.recording && (
                <span className="text-[11px] text-muted">
                  {formatDuration(state.recording.durationMs)} recorded
                </span>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (state.status === 'error') {
    const copy = errorCopy(state.error)
    return (
      <section
        className="paper-card animate-soft-in border-rust/25 p-5 sm:p-7"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-rust/10 text-rust">
            <AlertCircle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{copy.message}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {copy.settingsCta && (
                <Button variant="primary" size="sm" onClick={onOpenSettings}>
                  Open settings
                </Button>
              )}
              {copy.retryable && state.recording && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              )}
              {state.recording && (
                <Button variant="ghost" size="sm" onClick={onSaveForLater}>
                  Save for later
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onReset}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>

        {state.events.length > 0 && (
          <details className="group mt-4 border-t border-line/70 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted hover:text-ink">
              <ChevronDown className="size-3 transition group-open:rotate-180" />
              What we tried ({state.events.length})
            </summary>
            <div className="mt-3">
              <AttemptList events={state.events} />
            </div>
          </details>
        )}
      </section>
    )
  }

  if (!entry) return null

  const text = entry.text
  const handleShare = async () => {
    const result = await shareText(text)
    if (result === 'copied') notify('Copied — share it anywhere')
    if (result === false) notify('Sharing was canceled', 'error')
  }

  const handleDelete = () => {
    if (!window.confirm('Delete this thought? This can’t be undone.')) return
    removeRecent(entry.id)
    onReset()
  }

  const saveEdit = () => {
    const next = draft.trim()
    if (!next) return
    updateRecent(entry.id, { text: next, charCount: [...next].length })
    setEditing(false)
    notify('Transcript updated')
  }

  return (
    <section className="paper-card animate-soft-in overflow-hidden" id="transcript">
      <div className="flex items-start justify-between gap-3 border-b border-line/70 p-5 sm:px-7">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Transcript
          </p>
          <h2 className="mt-1.5 flex items-center gap-2 text-lg font-semibold">
            Your thought
            <Sparkles className="size-4 text-marigold-deep" />
          </h2>
          <p className="mt-1 text-xs text-muted">
            {formatRelative(entry.createdAt)} · {formatDuration(entry.durationMs)}
          </p>
        </div>
        <CopyButton text={text} variant="primary" />
      </div>

      <div className="p-5 sm:px-7 sm:py-6">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="mm-text min-h-[170px] w-full resize-y rounded-2xl border border-line bg-paper px-3.5 py-3 text-[17px] text-ink outline-none focus:border-marigold-deep/60"
              aria-label="Edit transcript"
              autoFocus
            />
            <div className="mt-3 flex gap-2">
              <Button variant="primary" size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                <Check className="size-3.5" />
                Save changes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mm-text whitespace-pre-wrap text-[17px] text-ink sm:text-[18px]">
            {text}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <MetaChip>{entry.language === 'my' ? 'Burmese' : 'Auto language'}</MetaChip>
          {entry.mode && entry.mode !== 'verbatim' && (
            <MetaChip>
              {entry.mode === 'clean'
                ? 'Clean'
                : entry.mode === 'english'
                  ? 'English'
                  : 'Bullets'}
            </MetaChip>
          )}
          <MetaChip>{prettyModel(entry.model)}</MetaChip>
          <MetaChip>{entry.charCount} characters</MetaChip>
          {entry.source === 'queue' && <MetaChip>From queue</MetaChip>}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-line/70 pt-4">
          <CopyButton text={text} variant="secondary" />
          <Button variant="secondary" size="sm" onClick={() => onContinue(entry.id)}>
            <Mic className="size-3.5" />
            Continue
          </Button>
          <Button variant="ghost" size="sm" onClick={handleShare}>
            <Share2 className="size-3.5" />
            Share
          </Button>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(text)
                setEditing(true)
              }}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={handleDelete} className="ml-auto">
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </section>
  )
}
