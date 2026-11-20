import { describe, expect, it } from 'vitest'
import { computeBackoff, parseRetryDelay } from './backoff'

describe('computeBackoff', () => {
  it('grows exponentially from the base', () => {
    const options = { random: () => 0.5 }
    expect(computeBackoff(1, options)).toBe(1_000)
    expect(computeBackoff(2, options)).toBe(2_000)
    expect(computeBackoff(3, options)).toBe(4_000)
  })

  it('never exceeds the cap plus jitter allowance', () => {
    const value = computeBackoff(20, { maxMs: 20_000, random: () => 0.999 })
    expect(value).toBeLessThanOrEqual(26_000)
  })

  it('always returns a positive duration', () => {
    expect(computeBackoff(1, { random: () => 0 })).toBeGreaterThan(0)
  })
})

describe('parseRetryDelay', () => {
  it('parses seconds with and without a decimal', () => {
    expect(parseRetryDelay('34s')).toBe(34_000)
    expect(parseRetryDelay('34.4s')).toBe(34_400)
  })

  it('parses milliseconds', () => {
    expect(parseRetryDelay('1500ms')).toBe(1_500)
  })

  it('parses minutes and hours', () => {
    expect(parseRetryDelay('2m')).toBe(120_000)
    expect(parseRetryDelay('1h')).toBe(3_600_000)
  })

  it('treats a bare number as seconds', () => {
    expect(parseRetryDelay('12')).toBe(12_000)
  })

  it('returns undefined for junk', () => {
    expect(parseRetryDelay('')).toBeUndefined()
    expect(parseRetryDelay(null)).toBeUndefined()
    expect(parseRetryDelay('soon-ish')).toBeUndefined()
  })

  it('parses HTTP dates', () => {
    const future = new Date(Date.now() + 60_000).toUTCString()
    const parsed = parseRetryDelay(future)
    expect(parsed).toBeGreaterThan(50_000)
    expect(parsed).toBeLessThan(70_000)
  })
})
