import type { ModelConfig, Settings } from './types'

export const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', enabled: true },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', enabled: true },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', enabled: true },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', enabled: true },
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  keys: [],
  models: DEFAULT_MODELS,
  languageMode: 'my',
  autoCopy: false,
  keepAudio: false,
  maxDurationSec: 600,
  sessionOnlyKeys: false,
  audioDeviceId: '',
}

export const STORE_KEY = 'pyaw-store'
export const SESSION_KEYS_STORAGE_KEY = 'pyaw-session-keys'
export const MAX_RECENTS = 100
export const MAX_AUDIO_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_INLINE_AUDIO_BYTES = 12 * 1024 * 1024
