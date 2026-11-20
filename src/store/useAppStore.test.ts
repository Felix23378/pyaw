import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, DEFAULT_SETTINGS, MAX_RECENTS, SESSION_KEYS_STORAGE_KEY, STORE_KEY } from '../config'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const localStore = new MemoryStorage()
const sessionStore = new MemoryStorage()

Object.defineProperty(globalThis, 'localStorage', { value: localStore, configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStore, configurable: true })
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStore,
    sessionStorage: sessionStore,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  configurable: true,
})

const { useAppStore, clearSessionKeys } = await import('./useAppStore')

describe('useAppStore', () => {
  beforeEach(() => {
    localStore.clear()
    sessionStore.clear()
    clearSessionKeys()
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, models: DEFAULT_MODELS.map((m) => ({ ...m })) },
      recents: [],
      pending: [],
      onboarded: false,
      settingsOpen: false,
      welcomeOpen: false,
      activeEntryId: null,
      toast: null,
    })
  })

  it('migrates API keys between localStorage and sessionStorage when toggling sessionOnlyKeys', () => {
    useAppStore.getState().addKey('Personal', 'AIza-secret-1')

    const persistedLocal = JSON.parse(localStore.getItem(STORE_KEY) ?? '{}')
    expect(persistedLocal.state.settings.keys).toHaveLength(1)
    expect(sessionStore.getItem(SESSION_KEYS_STORAGE_KEY)).toBeNull()

    // Enable session-only mode: keys move to sessionStorage and vanish from localStorage
    useAppStore.getState().setSessionOnlyKeys(true)
    const localAfterSessionOnly = JSON.parse(localStore.getItem(STORE_KEY) ?? '{}')
    const sessionKeys = JSON.parse(sessionStore.getItem(SESSION_KEYS_STORAGE_KEY) ?? '[]')
    expect(localAfterSessionOnly.state.settings.keys).toEqual([])
    expect(localAfterSessionOnly.state.settings.sessionOnlyKeys).toBe(true)
    expect(sessionKeys).toHaveLength(1)
    expect(sessionKeys[0].value).toBe('AIza-secret-1')

    // Adding another key while session-only keeps localStorage empty
    useAppStore.getState().addKey('Work', 'AIza-secret-2')
    const localAfterAdd = JSON.parse(localStore.getItem(STORE_KEY) ?? '{}')
    const sessionKeysAfterAdd = JSON.parse(sessionStore.getItem(SESSION_KEYS_STORAGE_KEY) ?? '[]')
    expect(localAfterAdd.state.settings.keys).toEqual([])
    expect(sessionKeysAfterAdd).toHaveLength(2)

    // Disable session-only mode: keys return to localStorage and sessionStorage clears
    useAppStore.getState().setSessionOnlyKeys(false)
    const localRestored = JSON.parse(localStore.getItem(STORE_KEY) ?? '{}')
    expect(localRestored.state.settings.keys).toHaveLength(2)
    expect(sessionStore.getItem(SESSION_KEYS_STORAGE_KEY)).toBeNull()
  })

  it('caps recents at MAX_RECENTS newest-first', () => {
    for (let i = 0; i < MAX_RECENTS + 10; i++) {
      useAppStore.getState().addRecent({
        id: `entry-${i}`,
        text: `Transcript ${i}`,
        createdAt: 1000 + i,
        durationMs: 2000,
        model: 'gemini-3.1-flash-lite',
        language: 'my',
        source: 'live',
        charCount: 12,
      })
    }

    const recents = useAppStore.getState().recents
    expect(recents).toHaveLength(MAX_RECENTS)
    expect(recents[0].id).toBe(`entry-${MAX_RECENTS + 9}`)
    expect(recents[MAX_RECENTS - 1].id).toBe('entry-10')
  })

  it('validates, reorders, and toggles models', () => {
    expect(useAppStore.getState().addModel('gemini-custom-test')).toBe(true)
    expect(useAppStore.getState().addModel('gemini-custom-test')).toBe(false) // duplicate
    expect(useAppStore.getState().addModel('bad model!')).toBe(false) // invalid chars

    const initialFirst = useAppStore.getState().settings.models[0].id
    const initialSecond = useAppStore.getState().settings.models[1].id
    useAppStore.getState().moveModel(initialSecond, -1)
    expect(useAppStore.getState().settings.models[0].id).toBe(initialSecond)
    expect(useAppStore.getState().settings.models[1].id).toBe(initialFirst)

    useAppStore.getState().toggleModel(initialSecond)
    expect(useAppStore.getState().settings.models[0].enabled).toBe(false)
  })
})
