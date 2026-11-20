import { parseRetryDelay } from './backoff'

export type ErrorKind =
  | 'daily_quota'
  | 'rate_limit'
  | 'busy'
  | 'invalid_key'
  | 'model_gone'
  | 'too_large'
  | 'bad_request'
  | 'blocked'
  | 'billing'
  | 'network'
  | 'aborted'
  | 'unknown'

export interface ClassifiedError {
  kind: ErrorKind
  message: string
  status?: number
  retryAfterMs?: number
  quotaIds: string[]
}

interface ErrorLike {
  status?: number
  body?: string
  message?: string
  name?: string
  aborted?: boolean
  network?: boolean
  retryAfter?: string | null
  retryAfterMs?: number
}

interface RpcDetail {
  '@type'?: string
  retryDelay?: string
  violations?: Array<{ quotaId?: string; quotaMetric?: string }>
  reason?: string
}

function normalize(input: unknown): ErrorLike {
  if (input instanceof Error) {
    return input as Error & ErrorLike
  }
  if (typeof input === 'string') return { message: input }
  if (input && typeof input === 'object') return input as ErrorLike
  return { message: 'Unknown error' }
}

function parseBody(body?: string): Record<string, unknown> | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const root = parsed as Record<string, unknown>
      const error = root.error
      if (error && typeof error === 'object') return error as Record<string, unknown>
      return root
    }
  } catch {
    // fall through
  }
  return null
}

export function classifyError(input: unknown): ClassifiedError {
  const err = normalize(input)
  const status = err.status
  const message = err.message || (status ? `Request failed (${status})` : 'Request failed')
  const bodyText = err.body ?? ''
  const body = parseBody(bodyText)
  const apiMessage = typeof body?.message === 'string' ? body.message : message
  const details = Array.isArray(body?.details) ? (body.details as RpcDetail[]) : []

  const quotaIds: string[] = []
  let retryAfterMs = err.retryAfterMs
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    if (detail['@type']?.includes('QuotaFailure')) {
      for (const violation of detail.violations ?? []) {
        if (violation?.quotaId) quotaIds.push(violation.quotaId)
        else if (violation?.quotaMetric) quotaIds.push(violation.quotaMetric)
      }
    }
    if (detail['@type']?.includes('RetryInfo')) {
      retryAfterMs = parseRetryDelay(detail.retryDelay) ?? retryAfterMs
    }
  }
  if (retryAfterMs == null) {
    retryAfterMs = parseRetryDelay(err.retryAfter ?? undefined)
  }

  if (err.aborted || err.name === 'AbortError' || status === 499) {
    return { kind: 'aborted', message: 'Canceled.', status, quotaIds }
  }

  if (err.network || status === 0) {
    return {
      kind: 'network',
      message: 'Could not reach Gemini. Check your connection.',
      status,
      quotaIds,
    }
  }

  if (status === 401 || status === 403) {
    return {
      kind: 'invalid_key',
      message:
        'This API key was rejected by Google. Check it in Settings or add another key.',
      status,
      quotaIds,
    }
  }

  if (status === 404) {
    return {
      kind: 'model_gone',
      message: 'This model is not available for your key.',
      status,
      quotaIds,
    }
  }

  if (status === 413 || /too large|exceeds.*(size|limit)|payload.*large/i.test(bodyText)) {
    return {
      kind: 'too_large',
      message: 'That recording is too large to send. Try a shorter one.',
      status,
      quotaIds,
    }
  }

  if (status === 402 || /prepay|credits.*depleted|billing/i.test(bodyText)) {
    return {
      kind: 'billing',
      message: 'Your Gemini account has no available credit.',
      status,
      quotaIds,
    }
  }

  if (status === 408) {
    return {
      kind: 'network',
      message: 'The request timed out. Check your connection.',
      status,
      quotaIds,
    }
  }

  if (status === 429) {
    const daily = quotaIds.some((id) => /perday|daily/i.test(id))
    if (daily) {
      return {
        kind: 'daily_quota',
        message: 'This API key has used its daily quota.',
        status,
        retryAfterMs,
        quotaIds,
      }
    }
    if (retryAfterMs != null || quotaIds.length > 0) {
      return {
        kind: 'rate_limit',
        message: 'Gemini is rate-limiting this key right now.',
        status,
        retryAfterMs,
        quotaIds,
      }
    }
    // A bare 429 with no quota details is almost always capacity, not quota.
    return {
      kind: 'busy',
      message: 'Gemini is busy right now.',
      status,
      quotaIds,
    }
  }

  if (status != null && status >= 500) {
    return {
      kind: 'busy',
      message: 'Gemini is unavailable right now.',
      status,
      quotaIds,
    }
  }

  if (status === 400) {
    if (/blockReason|safety|recitation|blocked/i.test(bodyText)) {
      return {
        kind: 'blocked',
        message: "This clip couldn't be transcribed. Try recording again.",
        status,
        quotaIds,
      }
    }
    return {
      kind: 'bad_request',
      message: apiMessage,
      status,
      quotaIds,
    }
  }

  return {
    kind: 'unknown',
    message: apiMessage,
    status,
    retryAfterMs,
    quotaIds,
  }
}
