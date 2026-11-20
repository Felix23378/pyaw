import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ApiKey, KeyHealth, LanguageMode, Theme } from '../types'
import { DEFAULT_MODELS, DEFAULT_SETTINGS } from '../config'
import { cn, formatBytes, maskKey } from '../lib/utils'
import { clearSessionKeys, useAppStore } from '../store/useAppStore'
import { useHealth } from '../hooks/useHealth'
import {
  effectiveKeyStatus,
  formatCooldown,
  markKeyCooling,
  markKeyExhausted,
  markKeyInvalid,
  markKeyOk,
  resetAllHealth,
} from '../retry/health'
import { classifyError } from '../retry/classifier'
import { testApiKey } from '../gemini/client'
import { clearAudio, clearPending } from '../storage/idb'
import { Modal, ModalCloseButton } from './ui/Modal'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'

interface SettingsSheetProps {
  open: boolean
  onClose: () => void
}

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-muted">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function KeyStatusBadge({ health }: { health?: KeyHealth }) {
  const status = effectiveKeyStatus(health)
  const cooldown = formatCooldown(health)
  const config =
    status === 'ok'
      ? { label: 'Ready', className: 'bg-jade/10 text-jade' }
      : status === 'cooling'
        ? { label: cooldown ? `Cooling ${cooldown}` : 'Cooling', className: 'bg-marigold-soft/60 text-marigold-deep' }
        : status === 'exhausted'
          ? { label: 'Out of quota', className: 'bg-rust/10 text-rust' }
          : status === 'invalid'
            ? { label: 'Rejected', className: 'bg-rust/10 text-rust' }
            : { label: 'Untested', className: 'bg-surface-2 text-muted' }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const settings = useAppStore((store) => store.settings)
  const recentsCount = useAppStore((store) => store.recents.length)
  const pendingCount = useAppStore((store) => store.pending.length)
  const addKey = useAppStore((store) => store.addKey)
  const removeKey = useAppStore((store) => store.removeKey)
  const addModel = useAppStore((store) => store.addModel)
  const toggleModel = useAppStore((store) => store.toggleModel)
  const moveModel = useAppStore((store) => store.moveModel)
  const removeModel = useAppStore((store) => store.removeModel)
  const resetModels = useAppStore((store) => store.resetModels)
  const updateSettings = useAppStore((store) => store.updateSettings)
  const setTheme = useAppStore((store) => store.setTheme)
  const setSessionOnlyKeys = useAppStore((store) => store.setSessionOnlyKeys)
  const clearRecents = useAppStore((store) => store.clearRecents)
  const setPending = useAppStore((store) => store.setPending)
  const notify = useAppStore((store) => store.notify)
  const health = useHealth()

  const [label, setLabel] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [modelValue, setModelValue] = useState('')
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return
    let live = true
    const refreshDevices = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!live) return
          const inputs = devices.filter(
            (device) => device.kind === 'audioinput' && device.deviceId && device.label,
          )
          setAudioInputs(inputs)
        })
        .catch(() => {})
    }
    refreshDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    return () => {
      live = false
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let live = true
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (live) {
          setUsage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [open, settings.keys.length, settings.models.length])

  const handleAddKey = (event: React.FormEvent) => {
    event.preventDefault()
    if (!keyValue.trim()) return
    addKey(label, keyValue)
    setLabel('')
    setKeyValue('')
    setShowKey(false)
  }

  const handleTestKey = async (key: ApiKey, silent = false): Promise<boolean> => {
    setTestingId(key.id)
    const model = settings.models.find((item) => item.enabled)?.id ?? DEFAULT_MODELS[0].id
    try {
      await testApiKey(key.value, model)
      markKeyOk(key.id)
      if (!silent) notify('Key works — ready to transcribe')
      return true
    } catch (error) {
      const classified = classifyError(error)
      if (classified.kind === 'invalid_key') markKeyInvalid(key.id, classified.message)
      else if (classified.kind === 'daily_quota') markKeyExhausted(key.id, classified.message)
      else if (classified.kind === 'rate_limit') {
        markKeyCooling(key.id, classified.retryAfterMs ?? 30_000, classified.message)
      } else {
        markKeyCooling(key.id, 30_000, classified.message)
      }
      if (!silent) notify(`Key test: ${classified.message}`, 'error')
      return false
    } finally {
      setTestingId(null)
    }
  }

  const handleTestAllKeys = async () => {
    if (testingAll || settings.keys.length === 0) return
    setTestingAll(true)
    let okCount = 0
    try {
      for (const key of settings.keys) {
        if (await handleTestKey(key, true)) okCount += 1
      }
      notify(
        okCount === settings.keys.length
          ? `All ${okCount} keys ready`
          : `${okCount} of ${settings.keys.length} keys ready`,
        okCount === 0 ? 'error' : 'default',
      )
    } finally {
      setTestingAll(false)
    }
  }

  const handleAddModel = (event: React.FormEvent) => {
    event.preventDefault()
    if (addModel(modelValue)) {
      setModelValue('')
      notify('Model added')
    } else if (modelValue.trim()) {
      notify('That model is already in the list', 'error')
    }
  }

  const handleRemoveKey = (key: ApiKey) => {
    if (!window.confirm(`Remove the key “${key.label}”?`)) return
    removeKey(key.id)
  }

  const handleClearQueue = async () => {
    if (!window.confirm('Delete every queued recording? They can’t be recovered.')) return
    await clearPending().catch(() => {})
    setPending([])
    notify('Queued recordings cleared')
  }

  const handleWipe = async () => {
    if (
      !window.confirm(
        'Delete every key, transcript, and queued recording stored in this browser? This can’t be undone.',
      )
    ) {
      return
    }
    await Promise.allSettled([clearPending(), clearAudio()])
    clearSessionKeys()
    resetAllHealth()
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, models: DEFAULT_MODELS.map((model) => ({ ...model })) },
      recents: [],
      pending: [],
      onboarded: false,
      settingsOpen: false,
    })
    notify('All local data deleted')
  }

  const enabledModels = settings.models.filter((model) => model.enabled).length
  const usagePercent =
    usage && usage.quota > 0 ? Math.min(100, Math.round((usage.usage / usage.quota) * 100)) : 0

  return (
    <Modal open={open} onClose={onClose} variant="sheet" labelledBy="settings-title">
      <div className="flex min-h-full flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="grid size-9 place-items-center rounded-full bg-marigold-soft/60 text-marigold-deep">
            <Settings2 className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="settings-title" className="text-lg font-semibold">
              Settings
            </h2>
            <p className="text-[11px] text-muted">Keys and transcripts never leave this device.</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="space-y-8 px-5 py-6 sm:px-6">
          <Section
            icon={<KeyRound className="size-4" />}
            title="Gemini API keys"
            description="Add one or more keys. When a key runs out of quota, Pyaw switches to the next one automatically."
            action={
              settings.keys.length >= 2 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleTestAllKeys()}
                  disabled={testingAll || testingId !== null}
                  className="shrink-0 px-2"
                >
                  <RefreshCw className={cn('size-3.5', testingAll && 'animate-spin')} />
                  Test all
                </Button>
              ) : undefined
            }
          >
            {settings.keys.length > 0 && (
              <ul className="space-y-2">
                {settings.keys.map((key) => {
                  const keyHealth = health.keys[key.id]
                  const cooldown = formatCooldown(keyHealth)
                  const exhausted = effectiveKeyStatus(keyHealth) === 'exhausted'
                  return (
                    <li
                      key={key.id}
                      className="rounded-2xl border border-line bg-surface px-3.5 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                          <KeyRound className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{key.label}</span>
                            <KeyStatusBadge health={keyHealth} />
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] text-muted">
                            {maskKey(key.value)}
                          </p>
                          {exhausted && cooldown && (
                            <p className="mt-1 text-[11px] text-muted">
                              Resets in {cooldown} (midnight Pacific)
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => void handleTestKey(key)}
                            disabled={testingId === key.id}
                            aria-label={`Test key ${key.label}`}
                            title="Test this key"
                            className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                          >
                            <RefreshCw
                              className={cn('size-3.5', testingId === key.id && 'animate-spin')}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveKey(key)}
                            aria-label={`Remove key ${key.label}`}
                            title="Remove key"
                            className="grid size-8 place-items-center rounded-full text-muted hover:bg-rust/10 hover:text-rust"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {settings.keys.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line bg-surface-2/40 p-4">
                <p className="text-sm font-medium">No keys yet</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Create a free key in Google AI Studio, then paste it below.
                </p>
              </div>
            )}

            <form
              onSubmit={handleAddKey}
              className="space-y-2.5 rounded-2xl border border-line bg-surface-2/40 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <label className="sr-only" htmlFor="key-label">
                  Key label
                </label>
                <input
                  id="key-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Label (optional)"
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none placeholder:text-muted/70 focus:border-marigold-deep/50"
                />
                <div className="relative">
                  <label className="sr-only" htmlFor="key-value">
                    Gemini API key
                  </label>
                  <input
                    id="key-value"
                    type={showKey ? 'text' : 'password'}
                    value={keyValue}
                    onChange={(event) => setKeyValue(event.target.value)}
                    placeholder="AIza…"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-10 w-full rounded-xl border border-line bg-surface pl-3 pr-10 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted/70 focus:border-marigold-deep/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                    className="absolute right-1 top-1 grid size-8 place-items-center rounded-lg text-muted hover:text-ink"
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-marigold-deep hover:underline"
                >
                  Get a key in AI Studio
                  <ExternalLink className="size-3" />
                </a>
                <Button type="submit" size="sm" variant="primary" disabled={!keyValue.trim()}>
                  <Plus className="size-3.5" />
                  Add key
                </Button>
              </div>
            </form>

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-3.5 py-3">
              <div>
                <p className="text-xs font-medium">Session-only keys</p>
                <p className="text-[11px] text-muted">
                  Keep keys in memory for this tab only; clear when the tab closes.
                </p>
              </div>
              <Switch
                checked={settings.sessionOnlyKeys}
                onChange={setSessionOnlyKeys}
                label="Keep API keys for this session only"
              />
            </div>

            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" />
              {settings.sessionOnlyKeys
                ? 'Keys are stored in sessionStorage for this tab only and sent only to Google’s Gemini API over HTTPS.'
                : 'Keys are stored in this browser’s localStorage and sent only to Google’s Gemini API over HTTPS. Anyone using this browser profile can read them.'}
            </p>
          </Section>

          <Section
            icon={<Cpu className="size-4" />}
            title="Models"
            description="Pyaw tries models in this order. If one is busy, it moves to the next."
            action={
              <Button variant="ghost" size="sm" onClick={resetModels} className="shrink-0 px-2">
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            }
          >
            <ul className="space-y-2">
              {settings.models.map((model, index) => {
                const unavailableUntil = health.models[model.id]
                const unavailable = Boolean(unavailableUntil && unavailableUntil > Date.now())
                return (
                  <li
                    key={model.id}
                    className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2.5"
                  >
                    <Switch
                      checked={model.enabled}
                      onChange={() => toggleModel(model.id)}
                      label={`Enable ${model.label}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-medium sm:text-sm">{model.label}</p>
                        {unavailable && (
                          <span className="rounded-full bg-rust/10 px-1.5 py-0.5 text-[9px] font-semibold text-rust">
                            Unavailable
                          </span>
                        )}
                      </div>
                      <p className="truncate font-mono text-[10px] text-muted">{model.id}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveModel(model.id, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${model.label} up`}
                        className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-25"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveModel(model.id, 1)}
                        disabled={index === settings.models.length - 1}
                        aria-label={`Move ${model.label} down`}
                        className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-25"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeModel(model.id)}
                        aria-label={`Remove ${model.label}`}
                        className="grid size-7 place-items-center rounded-full text-muted hover:bg-rust/10 hover:text-rust"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <form onSubmit={handleAddModel} className="flex gap-2">
              <label className="sr-only" htmlFor="model-id">
                Model ID
              </label>
              <input
                id="model-id"
                value={modelValue}
                onChange={(event) => setModelValue(event.target.value)}
                placeholder="gemini-…"
                spellCheck={false}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted/70 focus:border-marigold-deep/50"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={!modelValue.trim()}>
                <Plus className="size-3.5" />
                Add
              </Button>
            </form>
            <p className="text-[10px] leading-relaxed text-muted">
              {enabledModels} of {settings.models.length} models enabled. A model that returns
              404 is skipped for 12 hours.
            </p>
          </Section>

          <Section
            icon={<Sparkles className="size-4" />}
            title="Transcription"
            description="How Pyaw listens and what it saves."
          >
            <div className="divide-y divide-line/70 rounded-2xl border border-line bg-surface">
              <div className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Language</p>
                  <p className="text-[11px] text-muted">Burmese is the default.</p>
                </div>
                <select
                  value={settings.languageMode}
                  onChange={(event) =>
                    updateSettings({ languageMode: event.target.value as LanguageMode })
                  }
                  className="h-9 rounded-full border border-line bg-paper px-3 py-0 text-xs font-medium leading-9 outline-none focus:border-marigold-deep/50"
                  aria-label="Transcription language"
                >
                  <option value="my">Burmese</option>
                  <option value="auto">Auto-detect</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-4 p-3.5">
                <div>
                  <p className="text-sm font-medium">Copy automatically</p>
                  <p className="text-[11px] text-muted">
                    Put each new transcript on the clipboard.
                  </p>
                </div>
                <Switch
                  checked={settings.autoCopy}
                  onChange={(checked) => updateSettings({ autoCopy: checked })}
                  label="Copy transcript automatically"
                />
              </div>

              <div className="flex items-center justify-between gap-4 p-3.5">
                <div>
                  <p className="text-sm font-medium">Keep audio</p>
                  <p className="text-[11px] text-muted">
                    Save recordings for 7 days so you can play them again.
                  </p>
                </div>
                <Switch
                  checked={settings.keepAudio}
                  onChange={(checked) => updateSettings({ keepAudio: checked })}
                  label="Keep recordings"
                />
              </div>

              {audioInputs.length > 0 && (
                <div className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Microphone</p>
                    <p className="text-[11px] text-muted">Input device used for recording.</p>
                  </div>
                  <select
                    value={settings.audioDeviceId}
                    onChange={(event) => updateSettings({ audioDeviceId: event.target.value })}
                    className="h-9 max-w-[220px] truncate rounded-full border border-line bg-paper px-3 py-0 text-xs font-medium leading-9 outline-none focus:border-marigold-deep/50"
                    aria-label="Microphone input device"
                  >
                    <option value="">System default</option>
                    {audioInputs.map((device, idx) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Max recording</p>
                  <p className="text-[11px] text-muted">Longer clips use more quota.</p>
                </div>
                <select
                  value={settings.maxDurationSec}
                  onChange={(event) =>
                    updateSettings({ maxDurationSec: Number(event.target.value) })
                  }
                  className="h-9 rounded-full border border-line bg-paper px-3 py-0 text-xs font-medium leading-9 outline-none focus:border-marigold-deep/50"
                  aria-label="Maximum recording length"
                >
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                </select>
              </div>

              <div className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Theme</p>
                  <p className="text-[11px] text-muted">Follow your device or choose.</p>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-surface-2 p-1">
                  {(['light', 'dark', 'system'] as Theme[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTheme(option)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[11px] font-medium capitalize transition',
                        settings.theme === option
                          ? 'bg-surface text-ink shadow-sm'
                          : 'text-muted hover:text-ink',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section
            icon={<Database className="size-4" />}
            title="Storage"
            description="Everything stays local. Clear it whenever you like."
          >
            <div className="rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Browser storage</span>
                <span className="text-muted">
                  {usage ? `${formatBytes(usage.usage)} used` : 'Checking…'}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-marigold transition-all"
                  style={{ width: `${Math.max(2, usagePercent)}%` }}
                />
              </div>
              <p className="mt-2 text-[10px] text-muted">
                {settings.keys.length} keys · {recentsCount} transcripts · {pendingCount} queued
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  resetAllHealth()
                  notify('Key cooldowns reset')
                }}
              >
                <RefreshCw className="size-3.5" />
                Reset cooldowns
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (window.confirm('Delete all saved transcripts?')) clearRecents()
                }}
              >
                <Trash2 className="size-3.5" />
                Clear recents
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleClearQueue()}>
                <HardDrive className="size-3.5" />
                Clear queue
              </Button>
              <Button variant="danger" size="sm" onClick={() => void handleWipe()}>
                <Trash2 className="size-3.5" />
                Wipe all data
              </Button>
            </div>
          </Section>

          <Section
            icon={<ShieldCheck className="size-4" />}
            title="About Pyaw"
            description="A small, quiet tool for Myanmar thoughts."
          >
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-3.5 text-[11px] leading-relaxed text-muted">
              <p>
                Audio is sent only to Google’s Gemini API. Keys, transcripts, and recordings stay
                in this browser. Pyaw has no accounts, analytics, or backend.
              </p>
              <p>
                Free-tier Gemini data may be used to improve Google products. Check the Gemini API
                terms if that matters to you.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="https://ai.google.dev/gemini-api/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-marigold-deep hover:underline"
                >
                  Gemini docs
                  <ExternalLink className="size-3" />
                </a>
                <a
                  href="https://ai.google.dev/gemini-api/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-marigold-deep hover:underline"
                >
                  Terms
                  <ExternalLink className="size-3" />
                </a>
                <span className="ml-auto">v1.0</span>
              </div>
            </div>
          </Section>
        </div>

        <div className="safe-bottom mt-auto border-t border-line/70 px-5 py-3 sm:px-6">
          <p className="text-center text-[10px] text-muted">
            Pyaw · ပြော · Speak first, type never.
          </p>
        </div>
      </div>
    </Modal>
  )
}
