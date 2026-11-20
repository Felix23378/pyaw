import type { ApiKey, HealthAdapter, HealthState, KeyHealth, KeyStatus } from '../types'

const STORAGE_KEY = 'pyaw.health.v1'

function emptyState(): HealthState {
  return { keys: {}, models: {} }
}

function load(): HealthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<HealthState>
    return {
      keys: parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : {},
      models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {},
    }
  } catch {
    return emptyState()
  }
}

let state: HealthState = typeof localStorage === 'undefined' ? emptyState() : load()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Health is best-effort; never break transcription over storage.
  }
}

function setState(next: HealthState): void {
  state = next
  persist()
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    state = load()
    for (const listener of listeners) listener()
  })
}

export function subscribeHealth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHealth(): HealthState {
  return state
}

export function getKeyHealth(id: string): KeyHealth | undefined {
  return state.keys[id]
}

export function setKeyHealth(id: string, patch: Partial<KeyHealth>): void {
  const previous = state.keys[id] ?? { status: 'unknown' as KeyStatus }
  setState({
    ...state,
    keys: {
      ...state.keys,
      [id]: { ...previous, ...patch },
    },
  })
}

export function markKeyOk(id: string): void {
  setKeyHealth(id, {
    status: 'ok',
    cooldownUntil: undefined,
    lastError: undefined,
    lastUsedAt: Date.now(),
  })
}

export function markKeyInvalid(id: string, message?: string): void {
  setKeyHealth(id, { status: 'invalid', lastError: message })
}

export function markKeyCooling(id: string, until: number, message?: string): void {
  setKeyHealth(id, {
    status: 'cooling',
    cooldownUntil: Date.now() + Math.max(1_000, until),
    lastError: message,
  })
}

export function markKeyExhausted(id: string, message?: string): void {
  setKeyHealth(id, {
    status: 'exhausted',
    cooldownUntil: nextQuotaReset(),
    lastUsedAt: Date.now(),
    lastError: message,
  })
}

export function markModelUnavailable(id: string): void {
  setState({
    ...state,
    models: { ...state.models, [id]: Date.now() + 12 * 60 * 60 * 1000 },
  })
}

export function resetKeyHealth(id: string): void {
  if (!(id in state.keys)) return
  const keys = { ...state.keys }
  delete keys[id]
  setState({ ...state, keys })
}

export function resetModelHealth(id: string): void {
  if (!(id in state.models)) return
  const models = { ...state.models }
  delete models[id]
  setState({ ...state, models })
}

export function resetAllHealth(): void {
  setState(emptyState())
}

export function isKeyUsable(key: ApiKey, now = Date.now()): boolean {
  const health = state.keys[key.id]
  if (health?.status === 'invalid') return false
  if (health?.cooldownUntil && health.cooldownUntil > now) return false
  return true
}

export function effectiveKeyStatus(health?: KeyHealth): KeyStatus {
  if (!health) return 'unknown'
  if (health.status === 'invalid') return 'invalid'
  if (
    (health.status === 'cooling' || health.status === 'exhausted') &&
    health.cooldownUntil &&
    health.cooldownUntil > Date.now()
  ) {
    return health.status
  }
  if (health.status === 'ok') return 'ok'
  return 'unknown'
}

export function formatCooldown(health?: KeyHealth): string {
  if (!health) return ''
  const remaining = (health.cooldownUntil ?? 0) - Date.now()
  if (remaining <= 0) return ''
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * Gemini's daily quotas reset at midnight Pacific. Format "now" in that
 * timezone, then convert the next local midnight back to UTC.
 */
export function nextQuotaReset(now = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now))
    const lookup = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    const year = lookup('year')
    const month = lookup('month')
    const day = lookup('day')
    const hour = lookup('hour') % 24
    const minute = lookup('minute')
    const second = lookup('second')
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
    const offset = asUtc - now
    return Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offset
  } catch {
    return now + 60 * 60 * 1000
  }
}

export const healthAdapter: HealthAdapter = {
  getKey: (id) => state.keys[id],
  getModelUnavailable: (id) => state.models[id],
  setKey: (id, patch) => setKeyHealth(id, patch),
  setModelUnavailable: (id) => markModelUnavailable(id),
}
