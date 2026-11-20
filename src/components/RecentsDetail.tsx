import { useEffect, useState } from 'react'
import { Clock3, Share2, Trash2 } from 'lucide-react'
import { Modal, ModalCloseButton } from './ui/Modal'
import { CopyButton } from './CopyButton'
import { Button } from './ui/Button'
import { useAppStore } from '../store/useAppStore'
import { getAudio } from '../storage/idb'
import { formatDuration, formatRelative, prettyModel } from '../lib/utils'
import { shareText } from '../lib/clipboard'

export function RecentsDetail() {
  const entry = useAppStore(
    (store) => store.recents.find((item) => item.id === store.activeEntryId) ?? null,
  )
  const setActiveEntry = useAppStore((store) => store.setActiveEntry)
  const removeRecent = useAppStore((store) => store.removeRecent)
  const notify = useAppStore((store) => store.notify)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let objectUrl: string | undefined
    setAudioUrl(null)
    if (entry?.audioId) {
      getAudio(entry.audioId)
        .then((blob) => {
          if (live && blob) {
            objectUrl = URL.createObjectURL(blob)
            setAudioUrl(objectUrl)
          }
        })
        .catch(() => {})
    }
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry?.audioId])

  if (!entry) return null

  const handleShare = async () => {
    const result = await shareText(entry.text)
    if (result === 'copied') notify('Copied — share it anywhere')
    if (result === false) notify('Sharing was canceled', 'error')
  }

  const handleDelete = () => {
    if (!window.confirm('Delete this thought? This can’t be undone.')) return
    removeRecent(entry.id)
  }

  return (
    <Modal
      open={Boolean(entry)}
      onClose={() => setActiveEntry(null)}
      labelledBy="recent-detail-title"
    >
      <div className="sticky top-0 flex items-start gap-3 border-b border-line bg-paper/95 p-5 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Saved thought
          </p>
          <h2 id="recent-detail-title" className="mt-1 text-lg font-semibold">
            {formatRelative(entry.createdAt)}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {new Date(entry.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        </div>
        <ModalCloseButton onClose={() => setActiveEntry(null)} />
      </div>

      <div className="p-5 sm:p-6">
        <p className="mm-text whitespace-pre-wrap text-[17px] text-ink">{entry.text}</p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
            <Clock3 className="size-3" />
            {formatDuration(entry.durationMs)}
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
            {prettyModel(entry.model)}
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
            {entry.language === 'my' ? 'Burmese' : 'Auto language'}
          </span>
        </div>

        {audioUrl && (
          <audio
            controls
            src={audioUrl}
            className="mt-5 w-full rounded-full"
            aria-label="Recording playback"
          />
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-line/70 pt-4">
          <CopyButton text={entry.text} variant="primary" />
          <Button variant="secondary" size="sm" onClick={handleShare}>
            <Share2 className="size-3.5" />
            Share
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} className="ml-auto">
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  )
}
