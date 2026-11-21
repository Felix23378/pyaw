import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ApiKey,
  AppToast,
  ModelConfig,
  PendingMeta,
  Settings,
  Theme,
  TranscriptEntry,
} from '../types'
import {
  DEFAULT_MODELS,
  DEFAULT_SETTINGS,
  MAX_RECENTS,
  SESSION_KEYS_STORAGE_KEY,
  STORE_KEY,
} from '../config'
import { prettyModel, uuid } from '../lib/utils'
import { resetAllHealth, resetKeyHealth, resetModelHealth } from '../retry/health'
import { clearAudio, deleteAudio } from '../storage/idb'

function readSessionKeys(): ApiKey[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    const raw = sessionStorage.getItem(SESSION_KEYS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ApiKey[]) : []
  } catch {
    return []
  }
}

function writeSessionKeys(keys: ApiKey[]): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (keys.length === 0) sessionStorage.removeItem(SESSION_KEYS_STORAGE_KEY)
    else sessionStorage.setItem(SESSION_KEYS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // ignore storage errors
  }
}

export function clearSessionKeys(): void {
  writeSessionKeys([])
}

interface AppState {
  settings: Settings
  recents: TranscriptEntry[]
  pending: PendingMeta[]
  onboarded: boolean
  settingsOpen: boolean
  welcomeOpen: boolean
  activeEntryId: string | null
  toast: AppToast | null

  updateSettings: (patch: Partial<Settings>) => void
  setTheme: (theme: Theme) => void
  setSessionOnlyKeys: (enabled: boolean) => void

  addKey: (label: string, value: string) => void
  renameKey: (id: string, label: string) => void
  removeKey: (id: string) => void
  moveKey: (id: string, direction: -1 | 1) => void

  addModel: (id: string) => boolean
  toggleModel: (id: string) => void
  moveModel: (id: string, direction: -1 | 1) => void
  removeModel: (id: string) => void
  resetModels: () => void

  addRecent: (entry: TranscriptEntry) => void
  updateRecent: (id: string, patch: Partial<TranscriptEntry>) => void
  removeRecent: (id: string) => void
  clearRecents: () => void

  setPending: (items: PendingMeta[]) => void
  setOnboarded: (value: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setWelcomeOpen: (open: boolean) => void
  setActiveEntry: (id: string | null) => void
  notify: (message: string, tone?: 'default' | 'error') => void
  dismissToast: (id?: number) => void
}

type PersistedState = Pick<AppState, 'settings' | 'recents' | 'onboarded'>

function cloneModels(): ModelConfig[] {
  return DEFAULT_MODELS.map((model) => ({ ...model }))
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedState>(
    (set, get) => ({
      settings: { ...DEFAULT_SETTINGS, models: cloneModels() },
      recents: [],
      pending: [],
      onboarded: false,
      settingsOpen: false,
      welcomeOpen: false,
      activeEntryId: null,
      toast: null,

      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      setTheme: (theme) => set((state) => ({ settings: { ...state.settings, theme } })),

      setSessionOnlyKeys: (enabled) => {
        const currentKeys = get().settings.keys
        if (enabled) {
          writeSessionKeys(currentKeys)
        } else {
          clearSessionKeys()
        }
        set((state) => ({
          settings: { ...state.settings, sessionOnlyKeys: enabled },
        }))
        get().notify(
          enabled
            ? 'Keys will clear when you close this tab'
            : 'Keys saved across sessions in this browser',
        )
      },

      addKey: (label, value) => {
        const trimmed = value.trim()
        if (!trimmed) return
        const key: ApiKey = {
          id: uuid(),
          label: label.trim() || `Key ${get().settings.keys.length + 1}`,
          value: trimmed,
          addedAt: Date.now(),
        }
        const nextKeys = [...get().settings.keys, key]
        if (get().settings.sessionOnlyKeys) writeSessionKeys(nextKeys)
        set((state) => ({
          settings: { ...state.settings, keys: nextKeys },
          onboarded: true,
        }))
        get().notify('API key added')
      },

      renameKey: (id, label) =>
        set((state) => {
          const nextKeys = state.settings.keys.map((key) =>
            key.id === id ? { ...key, label: label.trim() || key.label } : key,
          )
          if (state.settings.sessionOnlyKeys) writeSessionKeys(nextKeys)
          return {
            settings: {
              ...state.settings,
              keys: nextKeys,
            },
          }
        }),

      removeKey: (id) => {
        resetKeyHealth(id)
        const nextKeys = get().settings.keys.filter((key) => key.id !== id)
        if (get().settings.sessionOnlyKeys) writeSessionKeys(nextKeys)
        set((state) => ({
          settings: {
            ...state.settings,
            keys: nextKeys,
          },
        }))
        get().notify('API key removed')
      },

      moveKey: (id, direction) =>
        set((state) => {
          const index = state.settings.keys.findIndex((key) => key.id === id)
          const nextKeys = moveItem(state.settings.keys, index, direction)
          if (state.settings.sessionOnlyKeys) writeSessionKeys(nextKeys)
          return {
            settings: {
              ...state.settings,
              keys: nextKeys,
            },
          }
        }),

      addModel: (rawId) => {
        const id = rawId.trim().toLowerCase()
        if (!id || !/^[a-z0-9][a-z0-9.\-]*$/.test(id)) return false
        if (get().settings.models.some((model) => model.id === id)) return false
        const model: ModelConfig = {
          id,
          label: id.startsWith('gemini-') ? `Gemini ${prettyModel(id)}` : id,
          enabled: true,
        }
        set((state) => ({
          settings: { ...state.settings, models: [...state.settings.models, model] },
        }))
        return true
      },

      toggleModel: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            models: state.settings.models.map((model) =>
              model.id === id ? { ...model, enabled: !model.enabled } : model,
            ),
          },
        })),

      moveModel: (id, direction) =>
        set((state) => {
          const index = state.settings.models.findIndex((model) => model.id === id)
          return {
            settings: {
              ...state.settings,
              models: moveItem(state.settings.models, index, direction),
            },
          }
        }),

      removeModel: (id) => {
        resetModelHealth(id)
        set((state) => ({
          settings: {
            ...state.settings,
            models: state.settings.models.filter((model) => model.id !== id),
          },
        }))
      },

      resetModels: () => {
        resetAllHealth()
        set((state) => ({ settings: { ...state.settings, models: cloneModels() } }))
      },

      addRecent: (entry) =>
        set((state) => ({
          recents: [entry, ...state.recents].slice(0, MAX_RECENTS),
        })),

      updateRecent: (id, patch) =>
        set((state) => ({
          recents: state.recents.map((entry) =>
            entry.id === id ? { ...entry, ...patch, updatedAt: Date.now() } : entry,
          ),
        })),

      removeRecent: (id) => {
        const entry = get().recents.find((item) => item.id === id)
        if (entry?.audioId) void deleteAudio(entry.audioId)
        set((state) => ({
          recents: state.recents.filter((item) => item.id !== id),
          activeEntryId: state.activeEntryId === id ? null : state.activeEntryId,
        }))
        get().notify('Deleted from recents')
      },

      clearRecents: () => {
        void clearAudio()
        set({ recents: [], activeEntryId: null })
        get().notify('Recents cleared')
      },

      setPending: (items) => set({ pending: items }),
      setOnboarded: (value) => set({ onboarded: value }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setWelcomeOpen: (open) => set({ welcomeOpen: open }),
      setActiveEntry: (id) => set({ activeEntryId: id }),

      notify: (message, tone = 'default') =>
        set({ toast: { id: Date.now(), message, tone } }),

      dismissToast: (id) =>
        set((state) => {
          if (id != null && state.toast?.id !== id) return state
          return { toast: null }
        }),
    }),
    {
      name: STORE_KEY,
      version: 2,
      migrate: (persisted, version) => {
        const stored = (persisted ?? {}) as Partial<PersistedState>
        if (version < 2 && stored.settings) {
          return {
            ...stored,
            settings: { ...stored.settings, autoCopy: true },
          } as PersistedState
        }
        return stored as PersistedState
      },
      partialize: (state) => ({
        settings: state.settings.sessionOnlyKeys
          ? { ...state.settings, keys: [] }
          : state.settings,
        recents: state.recents,
        onboarded: state.onboarded,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PersistedState>
        const storedSettings = stored.settings
        const sessionOnly = Boolean(storedSettings?.sessionOnlyKeys)
        const keys = sessionOnly
          ? readSessionKeys()
          : Array.isArray(storedSettings?.keys)
            ? storedSettings.keys
            : []
        const settings: Settings = {
          ...current.settings,
          ...(storedSettings ?? {}),
          sessionOnlyKeys: sessionOnly,
          outputMode: storedSettings?.outputMode ?? current.settings.outputMode,
          audioDeviceId:
            typeof storedSettings?.audioDeviceId === 'string' ? storedSettings.audioDeviceId : '',
          keys,
          models:
            Array.isArray(storedSettings?.models) && storedSettings.models.length > 0
              ? storedSettings.models
              : current.settings.models,
        }
        return {
          ...current,
          settings,
          recents: Array.isArray(stored.recents) ? stored.recents : [],
          onboarded: Boolean(stored.onboarded),
        }
      },
    },
  ),
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY) return
    void useAppStore.persist.rehydrate()
  })
}
