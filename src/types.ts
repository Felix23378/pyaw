export type Theme = 'system' | 'light' | 'dark'
export type LanguageMode = 'my' | 'auto'
export type KeyStatus = 'unknown' | 'ok' | 'cooling' | 'exhausted' | 'invalid'

export interface ApiKey {
  id: string
  label: string
  value: string
  addedAt: number
}

export interface ModelConfig {
  id: string
  label: string
  enabled: boolean
}

export interface Settings {
  theme: Theme
  keys: ApiKey[]
  models: ModelConfig[]
  languageMode: LanguageMode
  autoCopy: boolean
  keepAudio: boolean
  maxDurationSec: number
  sessionOnlyKeys: boolean
  audioDeviceId: string
}

export interface TranscriptEntry {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
  durationMs: number
  model: string
  language: LanguageMode
  source: 'live' | 'queue'
  charCount: number
  audioId?: string
}

export interface PendingMeta {
  id: string
  durationMs: number
  createdAt: number
  attempts: number
  lastError?: string
  size: number
}

export type RecordingSource = 'live' | 'queue'

export interface Recording {
  blob: Blob
  mimeType: string
  durationMs: number
  levels: number[]
}

export interface KeyHealth {
  status: KeyStatus
  cooldownUntil?: number
  lastError?: string
  lastUsedAt?: number
}

export interface HealthState {
  keys: Record<string, KeyHealth>
  models: Record<string, number>
}

/**
 * Small adapter so the retry loop can read and update health without
 * depending on React, localStorage, or the Zustand store.
 */
export interface HealthAdapter {
  getKey(id: string): KeyHealth | undefined
  getModelUnavailable(id: string): number | undefined
  setKey(id: string, patch: Partial<KeyHealth>): void
  setModelUnavailable(id: string): void
}

export interface AppToast {
  id: number
  message: string
  tone?: 'default' | 'error'
}
