import { GeminiApiError } from './client'
import { abortableSleep } from '../retry/orchestrator'

const UPLOAD_ROOT = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_POLL_ATTEMPTS = 30
const POLL_INTERVAL_MS = 1_500
const FILE_TTL_MS = 45 * 60 * 60 * 1000 // conservative 45h (Gemini expires at 48h)

export interface UploadedGeminiFile {
  uri: string
  mimeType: string
  name: string
}

interface CachedEntry {
  file: UploadedGeminiFile
  expiresAt: number
}

// WeakMap keyed by Blob instance so recordings are GC'd naturally after transcription.
let uploadCache = new WeakMap<Blob, Map<string, CachedEntry>>()

export function clearUploadCache(): void {
  uploadCache = new WeakMap<Blob, Map<string, CachedEntry>>()
}

function getCached(blob: Blob, cacheKey: string): UploadedGeminiFile | undefined {
  const byKey = uploadCache.get(blob)
  const entry = byKey?.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    byKey?.delete(cacheKey)
    return undefined
  }
  return entry.file
}

function setCached(blob: Blob, cacheKey: string, file: UploadedGeminiFile): void {
  let byKey = uploadCache.get(blob)
  if (!byKey) {
    byKey = new Map()
    uploadCache.set(blob, byKey)
  }
  byKey.set(cacheKey, { file, expiresAt: Date.now() + FILE_TTL_MS })
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new GeminiApiError(
      0,
      JSON.stringify({ error: { message: (error as Error)?.message ?? 'Network error' } }),
      null,
      true,
    )
  }
}

interface GeminiFileResource {
  name?: string
  uri?: string
  mimeType?: string
  state?: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED' | string
  error?: { message?: string }
}

function parseFileResource(payload: unknown): GeminiFileResource {
  if (!payload || typeof payload !== 'object') return {}
  const record = payload as Record<string, unknown>
  if (record.file && typeof record.file === 'object') {
    return record.file as GeminiFileResource
  }
  return record as GeminiFileResource
}

export interface UploadFileOptions {
  apiKey: string
  keyId?: string
  blob: Blob
  mimeType: string
  signal?: AbortSignal
  onStatus?: (message: string) => void
  pollIntervalMs?: number
}

export async function uploadAudioFile(options: UploadFileOptions): Promise<UploadedGeminiFile> {
  const {
    apiKey,
    keyId,
    blob,
    mimeType,
    signal,
    onStatus,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = options
  const cacheKey = keyId || apiKey

  const cached = getCached(blob, cacheKey)
  if (cached) return cached

  onStatus?.('Uploading longer recording to Gemini…')

  // Step 1: Initiate resumable upload session
  const startResponse = await safeFetch(UPLOAD_ROOT, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file: { display_name: `pyaw-${Date.now()}` },
    }),
    signal,
  })

  if (!startResponse.ok) {
    const text = await startResponse.text().catch(() => '')
    throw new GeminiApiError(startResponse.status, text, startResponse.headers.get('retry-after'))
  }

  const uploadUrl =
    startResponse.headers.get('x-goog-upload-url') ??
    startResponse.headers.get('X-Goog-Upload-URL')

  if (!uploadUrl) {
    throw new GeminiApiError(
      502,
      JSON.stringify({ error: { message: 'Gemini did not return an upload URL.' } }),
    )
  }

  // Step 2: Upload bytes and finalize
  const uploadResponse = await safeFetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: blob,
    signal,
  })

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => '')
    throw new GeminiApiError(uploadResponse.status, text, uploadResponse.headers.get('retry-after'))
  }

  let resource = parseFileResource(await uploadResponse.json().catch(() => ({})))
  if (!resource.uri) {
    throw new GeminiApiError(
      502,
      JSON.stringify({ error: { message: 'Gemini file upload returned no file URI.' } }),
    )
  }

  // Step 3: Poll until ACTIVE if Gemini is still processing the file
  let pollAttempt = 0
  while (resource.state === 'PROCESSING' && resource.name && pollAttempt < MAX_POLL_ATTEMPTS) {
    onStatus?.('Preparing uploaded audio…')
    await abortableSleep(pollIntervalMs, signal)
    pollAttempt += 1

    const pollUrl = `${API_ROOT}/${resource.name.replace(/^\/+/, '')}`
    const pollResponse = await safeFetch(pollUrl, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal,
    })

    if (!pollResponse.ok) {
      const text = await pollResponse.text().catch(() => '')
      throw new GeminiApiError(pollResponse.status, text, pollResponse.headers.get('retry-after'))
    }

    resource = parseFileResource(await pollResponse.json().catch(() => ({})))
  }

  if (resource.state === 'FAILED') {
    throw new GeminiApiError(
      400,
      JSON.stringify({
        error: {
          message: resource.error?.message ?? 'Gemini could not process the uploaded audio file.',
        },
      }),
    )
  }

  if (resource.state === 'PROCESSING') {
    throw new GeminiApiError(
      504,
      JSON.stringify({ error: { message: 'Timed out waiting for Gemini to process the audio file.' } }),
    )
  }

  const uploaded: UploadedGeminiFile = {
    uri: resource.uri ?? '',
    mimeType: resource.mimeType || mimeType,
    name: resource.name || '',
  }

  setCached(blob, cacheKey, uploaded)
  return uploaded
}
