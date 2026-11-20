import { describe, expect, it, vi } from 'vitest'
import type { ApiKey, KeyHealth, HealthAdapter } from '../types'
import { runTranscription, TranscriptionError } from './orchestrator'

function makeKey(id: string, label = id): ApiKey {
  return { id, label, value: `value-${id}`, addedAt: 0 }
}

function makeHealth() {
  const keys: Record<string, KeyHealth> = {}
  const models: Record<string, number> = {}
  const adapter: HealthAdapter = {
    getKey: (id) => keys[id],
    getModelUnavailable: (id) => models[id],
    setKey: (id, patch) => {
      keys[id] = { ...(keys[id] ?? { status: 'unknown' }), ...patch }
    },
    setModelUnavailable: (id) => {
      models[id] = 1e15
    },
  }
  return { adapter, keys, models }
}

function httpError(status: number, message = 'error') {
  return { status, body: JSON.stringify({ error: { status, message } }) }
}

function quotaError(quotaId: string, retryDelay?: string) {
  return {
    status: 429,
    body: JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId }],
          },
          ...(retryDelay
            ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
            : []),
        ],
      },
    }),
  }
}

function harness(extra: Partial<Parameters<typeof runTranscription>[0]> = {}) {
  const clock = { t: 1_000_000 }
  const health = makeHealth()
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return {
    health,
    clock,
    sleep,
    base: {
      health: health.adapter,
      now: () => clock.t,
      sleep,
      ...extra,
    } as Parameters<typeof runTranscription>[0],
  }
}

describe('runTranscription', () => {
  it('throws no_keys when nothing is configured', async () => {
    const { base } = harness({ keys: [], models: ['m1'], call: async () => ({ text: '' }) })
    await expect(runTranscription(base)).rejects.toMatchObject({ kind: 'no_keys' })
  })

  it('throws no_models when no model is enabled', async () => {
    const { base } = harness({ keys: [makeKey('k1')], models: [], call: async () => ({ text: '' }) })
    await expect(runTranscription(base)).rejects.toMatchObject({ kind: 'no_models' })
  })

  it('switches to the next key when one is out of daily quota', async () => {
    const { base, health } = harness({
      keys: [makeKey('k1'), makeKey('k2')],
      models: ['m1'],
      call: async ({ key }) => {
        if (key.id === 'k1') throw quotaError('GenerateRequestsPerDayPerProjectPerModel')
        return { text: 'မင်္ဂလာပါ' }
      },
    })

    const result = await runTranscription(base)
    expect(result.keyId).toBe('k2')
    expect(result.text).toBe('မင်္ဂလာပါ')
    expect(health.keys.k1.status).toBe('exhausted')
  })

  it('switches to the next model when Gemini returns 503', async () => {
    const { base } = harness({
      keys: [makeKey('k1')],
      models: ['m1', 'm2'],
      call: async ({ model }) => {
        if (model === 'm1') throw httpError(503, 'overloaded')
        return { text: 'ok' }
      },
    })

    const result = await runTranscription(base)
    expect(result.model).toBe('m2')
  })

  it('skips a model that returns 404', async () => {
    const { base, health } = harness({
      keys: [makeKey('k1')],
      models: ['gone', 'live'],
      call: async ({ model }) => {
        if (model === 'gone') throw httpError(404, 'not found')
        return { text: 'ok' }
      },
    })

    const result = await runTranscription(base)
    expect(result.model).toBe('live')
    expect(health.models.gone).toBe(1e15)
  })

  it('skips a rejected key and succeeds on the next one', async () => {
    const { base } = harness({
      keys: [makeKey('k1'), makeKey('k2')],
      models: ['m1'],
      call: async ({ key }) => {
        if (key.id === 'k1') throw httpError(403, 'forbidden')
        return { text: 'second' }
      },
    })

    const result = await runTranscription(base)
    expect(result.keyId).toBe('k2')
    expect(result.attempts).toBe(2)
  })

  it('waits out a short per-minute limit on the same key', async () => {
    const calls: string[] = []
    const { base, sleep } = harness({
      keys: [makeKey('k1')],
      models: ['m1'],
      call: async () => {
        calls.push('call')
        if (calls.length === 1) {
          throw quotaError('GenerateRequestsPerMinutePerProject', '3s')
        }
        return { text: 'after wait' }
      },
    })

    const result = await runTranscription(base)
    expect(result.text).toBe('after wait')
    expect(result.attempts).toBe(2)
    expect(sleep).toHaveBeenCalledWith(3_000, undefined)
  })

  it('gives up with daily_quota when every key is exhausted', async () => {
    const { base } = harness({
      keys: [makeKey('k1'), makeKey('k2')],
      models: ['m1'],
      call: async () => {
        throw quotaError('GenerateRequestsPerDayPerProjectPerModel')
      },
    })

    let error: unknown
    try {
      await runTranscription(base)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TranscriptionError)
    expect((error as TranscriptionError).kind).toBe('daily_quota')
  })

  it('respects an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const { base } = harness({
      keys: [makeKey('k1')],
      models: ['m1'],
      call: async () => ({ text: 'never' }),
    })
    await expect(runTranscription({ ...base, signal: controller.signal })).rejects.toMatchObject(
      { kind: 'aborted' },
    )
  })

  it('reports partial output while streaming', async () => {
    const partials: string[] = []
    const { base } = harness({
      keys: [makeKey('k1')],
      models: ['m1'],
      onPartial: (text) => partials.push(text),
      call: async ({ onDelta }) => {
        onDelta('hello')
        onDelta('hello world')
        return { text: 'hello world' }
      },
    })

    const result = await runTranscription(base)
    expect(result.text).toBe('hello world')
    expect(partials).toContain('hello world')
  })
})
