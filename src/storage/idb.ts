import { clear, createStore, del, entries, get, set } from 'idb-keyval'
import type { PendingMeta, Recording } from '../types'
import { MAX_AUDIO_AGE_MS } from '../config'
import { uuid } from '../lib/utils'

const metaStore = createStore('pyaw-pending', 'meta')
const blobStore = createStore('pyaw-pending', 'blobs')
const keptStore = createStore('pyaw-audio', 'kept')

const MAX_PENDING_ITEMS = 5
const MAX_PENDING_BYTES = 50 * 1024 * 1024

export interface PendingItem extends PendingMeta {
  blob: Blob
  mimeType: string
  levels: number[]
}

interface BlobRecord {
  blob: Blob
  mimeType: string
  levels: number[]
}

interface KeptAudio {
  blob: Blob
  createdAt: number
}

export async function listPendingMeta(): Promise<PendingMeta[]> {
  const all = await entries<string, PendingMeta>(metaStore)
  return all
    .map(([, value]) => value)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function savePending(recording: Recording): Promise<PendingMeta> {
  const existing = await listPendingMeta()
  if (existing.length >= MAX_PENDING_ITEMS) {
    throw new Error('Your offline queue is full (5 recordings). Reconnect to transcribe them.')
  }
  if (existing.reduce((total, item) => total + item.size, 0) + recording.blob.size > MAX_PENDING_BYTES) {
    throw new Error('Your offline queue is full (50 MB). Reconnect to transcribe saved thoughts.')
  }

  const meta: PendingMeta = {
    id: uuid(),
    durationMs: recording.durationMs,
    createdAt: Date.now(),
    attempts: 0,
    size: recording.blob.size,
  }
  const payload: BlobRecord = {
    blob: recording.blob,
    mimeType: recording.mimeType,
    levels: recording.levels.slice(-96),
  }
  await set(meta.id, meta, metaStore)
  await set(meta.id, payload, blobStore)
  return meta
}

export async function listPending(): Promise<PendingItem[]> {
  const metas = await listPendingMeta()
  const result: PendingItem[] = []
  for (const meta of metas) {
    const payload = await get<BlobRecord>(meta.id, blobStore)
    if (!payload?.blob) {
      await deletePending(meta.id)
      continue
    }
    result.push({ ...meta, ...payload })
  }
  return result
}

export async function updatePending(
  id: string,
  patch: Partial<PendingMeta>,
): Promise<PendingMeta | undefined> {
  const meta = await get<PendingMeta>(id, metaStore)
  if (!meta) return undefined
  const next = { ...meta, ...patch }
  await set(id, next, metaStore)
  return next
}

export async function deletePending(id: string): Promise<void> {
  await Promise.all([del(id, metaStore), del(id, blobStore)])
}

export async function clearPending(): Promise<void> {
  await Promise.all([clear(metaStore), clear(blobStore)])
}

export async function saveAudio(id: string, blob: Blob): Promise<string> {
  const record: KeptAudio = { blob, createdAt: Date.now() }
  await set(id, record, keptStore)
  return id
}

export async function getAudio(id: string): Promise<Blob | null> {
  const record = await get<KeptAudio>(id, keptStore)
  return record?.blob ?? null
}

export async function deleteAudio(id: string): Promise<void> {
  await del(id, keptStore)
}

export async function pruneAudio(): Promise<void> {
  const all = await entries<string, KeptAudio>(keptStore)
  const cutoff = Date.now() - MAX_AUDIO_AGE_MS
  await Promise.all(
    all.filter(([, value]) => !value || value.createdAt < cutoff).map(([key]) => del(key, keptStore)),
  )
}

export async function clearAudio(): Promise<void> {
  await clear(keptStore)
}
