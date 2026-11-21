import type { LanguageMode, OutputMode } from '../types'
import { MAX_INLINE_AUDIO_BYTES } from '../config'
import { buildSystemPrompt } from './prompt'
import { uploadAudioFile } from './files'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiApiError extends Error {
  readonly status?: number
  readonly body: string
  readonly retryAfter?: string | null
  readonly network?: boolean

  constructor(
    status: number | undefined,
    body: string,
    retryAfter?: string | null,
    network = false,
  ) {
    let message = `Gemini request failed${status ? ` (${status})` : ''}`
    try {
      const parsed = JSON.parse(body)
      message = parsed?.error?.message ?? parsed?.message ?? message
    } catch {
      if (body) message = body.slice(0, 300)
    }
    super(message)
    this.name = 'GeminiApiError'
    this.status = status
    this.body = body
    this.retryAfter = retryAfter
    this.network = network
  }
}

interface TranscribeOptions {
  apiKey: string
  keyId?: string
  model: string
  blob: Blob
  mimeType: string
  languageMode: LanguageMode
  outputMode?: OutputMode
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onStatus?: (message: string) => void
}

type AudioPart =
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }

function buildBody(
  audioPart: AudioPart,
  languageMode: LanguageMode,
  outputMode: OutputMode,
  includeThinkingConfig: boolean,
) {
  return {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(languageMode, outputMode) }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Transcribe this recording.' }, audioPart],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain',
      ...(includeThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result ?? '')
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'))
      reader.readAsDataURL(blob)
    })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function extractText(payload: unknown): {
  text: string
  blocked: boolean
} {
  if (!payload || typeof payload !== 'object') return { text: '', blocked: false }
  const root = payload as Record<string, unknown>
  const feedback = root.promptFeedback as Record<string, unknown> | undefined
  const candidates = Array.isArray(root.candidates) ? root.candidates : []
  const candidate = candidates[0] as Record<string, unknown> | undefined
  const content = candidate?.content as Record<string, unknown> | undefined
  const parts = Array.isArray(content?.parts) ? content.parts : []
  let text = ''
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.thought === true) continue
    if (typeof record.text === 'string') text += record.text
  }
  const finishReason = String(candidate?.finishReason ?? '')
  const blocked =
    Boolean(feedback?.blockReason) ||
    (finishReason === 'SAFETY' && text.trim().length === 0) ||
    (finishReason === 'RECITATION' && text.trim().length === 0)
  return { text, blocked }
}

function mergeText(previous: string, chunk: string): string {
  if (!chunk) return previous
  if (!previous) return chunk
  if (chunk === previous) return previous
  if (chunk.startsWith(previous)) return chunk
  return previous + chunk
}

class StreamReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamReadError'
  }
}

async function readSse(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new StreamReadError('No response body for SSE stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let blocked = false

  const consume = (frame: string) => {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      const error = (payload as { error?: { code?: number; message?: string } })?.error
      if (error) {
        throw new GeminiApiError(error.code ?? 500, JSON.stringify({ error }))
      }
      const result = extractText(payload)
      if (result.blocked) blocked = true
      if (result.text) {
        full = mergeText(full, result.text)
        onDelta?.(full)
      }
    }
  }

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (readError) {
        if ((readError as Error)?.name === 'AbortError') throw readError
        if (!full) {
          throw new StreamReadError(
            (readError as Error)?.message ?? 'SSE stream could not be read.',
          )
        }
        throw new GeminiApiError(
          0,
          JSON.stringify({ error: { message: (readError as Error)?.message ?? 'Stream interrupted.' } }),
          null,
          true,
        )
      }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        consume(frame)
        boundary = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer.replace(/\r\n/g, '\n'))
  } finally {
    reader.releaseLock()
  }

  if (!full.trim() && blocked) {
    throw new GeminiApiError(
      400,
      JSON.stringify({ error: { message: 'blocked', blockReason: 'SAFETY' } }),
    )
  }
  return full
}

async function readJson(response: Response, onDelta?: (text: string) => void): Promise<string> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new GeminiApiError(502, JSON.stringify({ error: { message: 'Invalid JSON from Gemini.' } }))
  }
  const result = extractText(payload)
  if (!result.text.trim() && result.blocked) {
    throw new GeminiApiError(
      400,
      JSON.stringify({ error: { message: 'blocked', blockReason: 'SAFETY' } }),
    )
  }
  if (result.text) onDelta?.(result.text)
  return result.text
}

async function request(
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal | undefined,
  onDelta?: (text: string) => void,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new GeminiApiError(
      0,
      JSON.stringify({ error: { message: (error as Error)?.message ?? 'Network error' } }),
      null,
      true,
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GeminiApiError(response.status, text, response.headers.get('retry-after'))
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    return readSse(response, onDelta)
  }
  return readJson(response, onDelta)
}

async function sendGenerateRequest(
  model: string,
  apiKey: string,
  audioPart: AudioPart,
  languageMode: LanguageMode,
  outputMode: OutputMode,
  signal: AbortSignal | undefined,
  onDelta?: (text: string) => void,
): Promise<string> {
  const streamEndpoint = `${API_ROOT}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  const fallbackEndpoint = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`

  const execute = async (endpoint: string) => {
    try {
      return await request(
        endpoint,
        apiKey,
        buildBody(audioPart, languageMode, outputMode, true),
        signal,
        onDelta,
      )
    } catch (error) {
      const message = error instanceof GeminiApiError ? error.body || error.message : ''
      if (error instanceof GeminiApiError && error.status === 400 && /thinking/i.test(message)) {
        return request(
          endpoint,
          apiKey,
          buildBody(audioPart, languageMode, outputMode, false),
          signal,
          onDelta,
        )
      }
      throw error
    }
  }

  try {
    return await execute(streamEndpoint)
  } catch (error) {
    if (error instanceof StreamReadError) {
      return execute(fallbackEndpoint)
    }
    throw error
  }
}

export async function transcribeAudio(options: TranscribeOptions): Promise<string> {
  const {
    apiKey,
    keyId,
    model,
    blob,
    mimeType,
    languageMode,
    outputMode = 'verbatim',
    signal,
    onDelta,
    onStatus,
  } = options

  if (blob.size === 0) {
    throw new GeminiApiError(
      400,
      JSON.stringify({ error: { message: 'The recording is empty.' } }),
    )
  }

  const sendViaFilesApi = async (): Promise<string> => {
    const uploaded = await uploadAudioFile({
      apiKey,
      keyId,
      blob,
      mimeType,
      signal,
      onStatus,
    })
    return sendGenerateRequest(
      model,
      apiKey,
      { fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri } },
      languageMode,
      outputMode,
      signal,
      onDelta,
    )
  }

  if (blob.size > MAX_INLINE_AUDIO_BYTES) {
    return sendViaFilesApi()
  }

  const audioBase64 = await blobToBase64(blob)
  try {
    return await sendGenerateRequest(
      model,
      apiKey,
      { inlineData: { mimeType, data: audioBase64 } },
      languageMode,
      outputMode,
      signal,
      onDelta,
    )
  } catch (error) {
    if (error instanceof GeminiApiError && error.status === 413) {
      return sendViaFilesApi()
    }
    throw error
  }
}

export async function testApiKey(apiKey: string, model: string): Promise<void> {
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`
  await request(
    url,
    apiKey,
    {
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
      generationConfig: { maxOutputTokens: 8, temperature: 0 },
    },
    undefined,
  )
}

export function mimeTypeForApi(blobType: string): string {
  const base = blobType.split(';')[0].trim().toLowerCase()
  if (base === 'audio/mp4' || base === 'audio/aac') return 'audio/m4a'
  if (base === 'audio/x-m4a') return 'audio/m4a'
  return base || 'audio/webm'
}
