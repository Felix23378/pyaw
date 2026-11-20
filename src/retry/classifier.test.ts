import { describe, expect, it } from 'vitest'
import { classifyError } from './classifier'
import { GeminiApiError } from '../gemini/client'

function apiError(status: number, body: unknown, retryAfter?: string) {
  return new GeminiApiError(status, JSON.stringify(body), retryAfter)
}

describe('classifyError', () => {
  it('treats 401 and 403 as an invalid key', () => {
    for (const status of [401, 403]) {
      const result = classifyError(apiError(status, { error: { message: 'nope' } }))
      expect(result.kind).toBe('invalid_key')
    }
  })

  it('treats a missing model as model_gone', () => {
    expect(classifyError(apiError(404, { error: { message: 'not found' } })).kind).toBe(
      'model_gone',
    )
  })

  it('treats 413 as too_large', () => {
    expect(classifyError(apiError(413, { error: { message: 'too large' } })).kind).toBe(
      'too_large',
    )
  })

  it('classifies a daily quota violation', () => {
    const result = classifyError(
      apiError(429, {
        error: {
          code: 429,
          message: 'Quota exceeded',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                {
                  quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                  quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                },
              ],
            },
          ],
        },
      }),
    )
    expect(result.kind).toBe('daily_quota')
    expect(result.quotaIds.join(' ')).toMatch(/perday/i)
  })

  it('classifies a per-minute quota as rate_limit and reads RetryInfo', () => {
    const result = classifyError(
      apiError(429, {
        error: {
          code: 429,
          message: 'Rate limit',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }],
            },
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '7s',
            },
          ],
        },
      }),
    )
    expect(result.kind).toBe('rate_limit')
    expect(result.retryAfterMs).toBe(7_000)
  })

  it('reads a Retry-After header when the body has no details', () => {
    const result = classifyError(
      apiError(429, { error: { message: 'slow down' } }, '12'),
    )
    expect(result.kind).toBe('rate_limit')
    expect(result.retryAfterMs).toBe(12_000)
  })

  it('treats a bare 429 as capacity pressure, not quota', () => {
    expect(classifyError(apiError(429, { error: { message: 'busy' } })).kind).toBe('busy')
  })

  it('treats 5xx as busy', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyError(apiError(status, { error: { message: 'unavailable' } })).kind).toBe(
        'busy',
      )
    }
  })

  it('treats safety blocks as blocked, other 400s as bad_request', () => {
    expect(
      classifyError(
        apiError(400, { error: { message: 'Request blocked', blockReason: 'SAFETY' } }),
      ).kind,
    ).toBe('blocked')
    expect(
      classifyError(apiError(400, { error: { message: 'Invalid argument' } })).kind,
    ).toBe('bad_request')
  })

  it('detects aborts and network failures', () => {
    expect(classifyError(new DOMException('Aborted', 'AbortError')).kind).toBe('aborted')
    expect(classifyError(new GeminiApiError(0, 'offline', null, true)).kind).toBe('network')
    expect(classifyError(apiError(408, { error: { message: 'timeout' } })).kind).toBe('network')
  })
})
