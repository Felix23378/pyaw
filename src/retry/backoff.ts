export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
  random?: () => number
}

/**
 * Exponential backoff with jitter, capped. Round 1 → ~1s, 2 → ~2s, …
 * The 0.7–1.3 multiplier prevents a thundering herd without ever
 * exceeding the configured cap by more than the jitter allowance.
 */
export function computeBackoff(round: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1_000
  const max = options.maxMs ?? 20_000
  const random = options.random ?? Math.random
  const exponential = base * Math.pow(2, Math.max(0, round - 1))
  const capped = Math.min(max, exponential)
  const jitter = 0.7 + random() * 0.6
  return Math.round(capped * jitter)
}

/**
 * Parse Gemini's RetryInfo.retryDelay ("34s", "34.4s", "1500ms") or an
 * HTTP Retry-After header (seconds or an HTTP date).
 */
export function parseRetryDelay(value?: string | null): number | undefined {
  if (value == null) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined

  const relative = raw.match(/^([\d.]+)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?$/i)
  if (relative) {
    const amount = Number(relative[1])
    if (!Number.isFinite(amount) || amount < 0) return undefined
    const unit = (relative[2] ?? 's').toLowerCase()
    let ms = amount * 1000
    if (unit.startsWith('ms') || unit.startsWith('millisecond')) ms = amount
    else if (unit.startsWith('m')) ms = amount * 60_000
    else if (unit.startsWith('h')) ms = amount * 3_600_000
    return Math.round(ms)
  }

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) {
    return Math.max(0, parsed - Date.now())
  }
  return undefined
}
