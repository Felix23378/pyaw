export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatRelative(timestamp: number): string {
  const diff = timestamp - Date.now()
  const abs = Math.abs(diff)
  if (abs < 45_000) return 'Just now'
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), 'hour')
  if (abs < 604_800_000) return formatter.format(Math.round(diff / 86_400_000), 'day')
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

export type DateGroup = 'Today' | 'Yesterday' | 'Earlier'

export function dateGroup(timestamp: number): DateGroup {
  const now = new Date()
  const then = new Date(timestamp)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (timestamp >= startOfToday) return 'Today'
  if (timestamp >= startOfToday - 86_400_000) return 'Yesterday'
  return 'Earlier'
}

export function prettyModel(id: string): string {
  return id
    .replace(/^gemini-/, '')
    .split('-')
    .map((part, index) => {
      if (/^\d/.test(part)) return index === 0 ? part : part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

export function maskKey(value: string): string {
  if (value.length <= 8) return '••••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
