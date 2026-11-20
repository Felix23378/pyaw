import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiApiError, mimeTypeForApi, transcribeAudio } from './client'
import { clearUploadCache } from './files'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('mimeTypeForApi', () => {
  it('maps Safari audio/mp4 and audio/aac to audio/m4a', () => {
    expect(mimeTypeForApi('audio/mp4')).toBe('audio/m4a')
    expect(mimeTypeForApi('audio/mp4;codecs=mp4a.40.2')).toBe('audio/m4a')
    expect(mimeTypeForApi('audio/aac')).toBe('audio/m4a')
    expect(mimeTypeForApi('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(mimeTypeForApi('')).toBe('audio/webm')
  })
})

describe('transcribeAudio', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearUploadCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('streams SSE deltas and skips thought parts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"thinking...","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"မင်္ဂလာ"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"ပါ။"}]}}]}\n\n',
      ]),
    )
    globalThis.fetch = fetchMock as typeof fetch

    const deltas: string[] = []
    const text = await transcribeAudio({
      apiKey: 'AIza-test',
      model: 'gemini-3.1-flash-lite',
      blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      languageMode: 'my',
      onDelta: (value) => deltas.push(value),
    })

    expect(text).toBe('မင်္ဂလာပါ။')
    expect(deltas).toEqual(['မင်္ဂလာ', 'မင်္ဂလာပါ။'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(':streamGenerateContent?alt=sse')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test')
  })

  it('retries without thinkingConfig when model rejects it with 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'thinkingConfig is not supported for this model' } }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ဟုတ်ကဲ့"}]}}]}\n\n']),
      )
    globalThis.fetch = fetchMock as typeof fetch

    const text = await transcribeAudio({
      apiKey: 'AIza-test',
      model: 'gemini-legacy',
      blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      languageMode: 'my',
    })

    expect(text).toBe('ဟုတ်ကဲ့')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(secondBody.generationConfig.thinkingConfig).toBeUndefined()
  })

  it('falls back to non-streaming :generateContent when SSE stream cannot be read', async () => {
    const brokenStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream broken'))
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(brokenStream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Fallback OK' }] } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    globalThis.fetch = fetchMock as typeof fetch

    const text = await transcribeAudio({
      apiKey: 'AIza-test',
      model: 'gemini-3.1-flash-lite',
      blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      languageMode: 'auto',
    })

    expect(text).toBe('Fallback OK')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain(':streamGenerateContent?alt=sse')
    expect(String(fetchMock.mock.calls[1][0])).toContain(':generateContent')
  })

  it('uploads via Gemini Files API on 413 too_large and caches upload per keyId', async () => {
    const blob = new Blob(['audio-data'], { type: 'audio/webm' })
    const fetchMock = vi
      .fn()
      // 1st attempt: inlineData rejected with 413
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Payload too large' } }), { status: 413 }),
      )
      // 2nd call: resumable upload start
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/session-1' },
        }),
      )
      // 3rd call: upload finalize
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file: {
              name: 'files/abc123',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
              mimeType: 'audio/webm',
              state: 'ACTIVE',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // 4th call: generate with fileData
      .mockResolvedValueOnce(
        sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"Uploaded OK"}]}}]}\n\n']),
      )

    globalThis.fetch = fetchMock as typeof fetch

    const text = await transcribeAudio({
      apiKey: 'AIza-key-1',
      keyId: 'k1',
      model: 'gemini-3.1-flash-lite',
      blob,
      mimeType: 'audio/webm',
      languageMode: 'my',
    })

    expect(text).toBe('Uploaded OK')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const generateBody = JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))
    expect(generateBody.contents[0].parts[1]).toEqual({
      fileData: {
        mimeType: 'audio/webm',
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      },
    })
  })

  it('throws a 400 safety GeminiApiError when response is blocked with no text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"promptFeedback":{"blockReason":"SAFETY"},"candidates":[]}\n\n',
      ]),
    )
    globalThis.fetch = fetchMock as typeof fetch

    await expect(
      transcribeAudio({
        apiKey: 'AIza-test',
        model: 'gemini-3.1-flash-lite',
        blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        languageMode: 'my',
      }),
    ).rejects.toBeInstanceOf(GeminiApiError)
  })
})
