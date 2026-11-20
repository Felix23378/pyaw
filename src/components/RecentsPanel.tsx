import { useDeferredValue, useMemo, useState } from 'react'
import { Clock3, Search, Sparkles, Trash2, X } from 'lucide-react'
import type { TranscriptEntry } from '../types'
import {
  dateGroup,
  formatDuration,
  formatRelative,
  prettyModel,
  type DateGroup,
} from '../lib/utils'
import { useAppStore } from '../store/useAppStore'
import { deletePending, listPendingMeta } from '../storage/idb'
import { CopyButton } from './CopyButton'

const GROUPS: DateGroup[] = ['Today', 'Yesterday', 'Earlier']

export function RecentsPanel() {
  const recents = useAppStore((store) => store.recents)
  const pending = useAppStore((store) => store.pending)
  const setPending = useAppStore((store) => store.setPending)
  const setActiveEntry = useAppStore((store) => store.setActiveEntry)
  const notify = useAppStore((store) => store.notify)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase()
    if (!term) return recents
    return recents.filter(
      (entry) =>
        entry.text.toLowerCase().includes(term) ||
        prettyModel(entry.model).toLowerCase().includes(term),
    )
  }, [recents, deferredQuery])

  const grouped = useMemo(() => {
    const result = new Map<DateGroup, TranscriptEntry[]>()
    for (const group of GROUPS) result.set(group, [])
    for (const entry of filtered) result.get(dateGroup(entry.createdAt))?.push(entry)
    return GROUPS.map((group) => ({ group, entries: result.get(group) ?? [] })).filter(
      (section) => section.entries.length > 0,
    )
  }, [filtered])

  const handleDeletePending = async (id: string) => {
    try {
      await deletePending(id)
      setPending(await listPendingMeta())
      notify('Queued recording deleted')
    } catch {
      notify('Couldn’t delete that queued recording', 'error')
    }
  }

  const total = recents.length + pending.length
  const searching = deferredQuery.trim().length > 0

  return (
    <aside className="paper-card flex flex-col overflow-hidden lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-108px)]">
      <div className="border-b border-line/70 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Recent thoughts</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {total === 0 ? 'Nothing yet' : `${total} saved on this device`}
            </p>
          </div>
          <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted">
            <Sparkles className="size-3.5" />
          </span>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Search thoughts</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search thoughts"
            className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-9 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-marigold-deep/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {pending.length > 0 && !searching && (
          <div className="mb-2">
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Waiting to transcribe
            </p>
            <ul className="space-y-1.5">
              {pending.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line px-3 py-2.5"
                >
                  <Clock3 className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink">Saved recording</p>
                    <p className="truncate text-[11px] text-muted">
                      {formatDuration(item.durationMs)} · {formatRelative(item.createdAt)}
                      {item.attempts > 0 ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeletePending(item.id)}
                    aria-label="Delete queued recording"
                    className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-rust"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {grouped.map(({ group, entries }) => (
          <div key={group} className="mb-2">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {group}
            </p>
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setActiveEntry(entry.id)}
                    className="w-full rounded-2xl px-3 py-2.5 pr-11 text-left transition hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <p className="mm-text line-clamp-2 text-[14px] text-ink">{entry.text}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                      <span>{formatRelative(entry.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(entry.durationMs)}</span>
                      <span aria-hidden="true" className="hidden sm:inline">·</span>
                      <span className="hidden truncate sm:inline">{prettyModel(entry.model)}</span>
                    </p>
                  </button>
                  <CopyButton
                    text={entry.text}
                    variant="icon"
                    className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {total === 0 && (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <div className="relative grid size-16 place-items-center rounded-full bg-surface-2">
              <span className="absolute inset-0 rounded-full border border-line" />
              <span className="absolute -inset-3 rounded-full border border-line/60" />
              <Sparkles className="size-5 text-marigold-deep" />
            </div>
            <p className="mt-5 text-sm font-medium">Your thoughts will land here</p>
            <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-muted">
              Record something in Burmese. The transcript is saved automatically.
            </p>
          </div>
        )}

        {total > 0 && searching && grouped.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No matches</p>
            <p className="mt-1 text-xs text-muted">
              Try a Burmese word or a model name.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line/70 px-4 py-3">
        <p className="text-[10px] leading-relaxed text-muted">
          Transcripts live in this browser only. Clearing site data removes them.
        </p>
      </div>
    </aside>
  )
}
