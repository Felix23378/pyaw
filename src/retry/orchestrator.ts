import type { ApiKey, HealthAdapter } from '../types'
import { computeBackoff } from './backoff'
import { classifyError, type ClassifiedError, type ErrorKind } from './classifier'
import { nextQuotaReset } from './health'

export type TranscriptionFailureKind =
  | ErrorKind
  | 'no_keys'
  | 'no_models'
  | 'aborted'

export interface AttemptEvent {
  type: 'attempt' | 'retry' | 'wait' | 'success'
  index: number
  at: number
  model: string
  keyId: string
  keyLabel: string
  kind?: ErrorKind
  message?: string
  waitMs?: number
}

export interface CallArgs {
  model: string
  key: ApiKey
  signal: AbortSignal
  onDelta: (text: string) => void
}

export interface CallResult {
  text: string
}

export interface RetryPolicy {
  maxRounds: number
  maxAttempts: number
  totalTimeoutMs: number
  attemptTimeoutMs: number
  rateLimitInlineWaitMs: number
  backoffBaseMs: number
  backoffMaxMs: number
}

export const DEFAULT_POLICY: RetryPolicy = {
  maxRounds: 4,
  maxAttempts: 12,
  totalTimeoutMs: 150_000,
  attemptTimeoutMs: 60_000,
  rateLimitInlineWaitMs: 10_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 20_000,
}

export interface RunTranscriptionOptions {
  call: (args: CallArgs) => Promise<CallResult>
  keys: ApiKey[]
  models: string[]
  health: HealthAdapter
  signal?: AbortSignal
  policy?: Partial<RetryPolicy>
  onEvent?: (event: AttemptEvent) => void
  onPartial?: (text: string) => void
  onStatus?: (message: string) => void
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  classify?: (error: unknown) => ClassifiedError
}

export interface TranscriptionSuccess {
  text: string
  model: string
  keyId: string
  keyLabel: string
  attempts: number
  elapsedMs: number
  log: AttemptEvent[]
}

export class TranscriptionError extends Error {
  readonly kind: TranscriptionFailureKind
  readonly attempts: number
  readonly log: AttemptEvent[]
  readonly retryAfterMs?: number

  constructor(
    kind: TranscriptionFailureKind,
    message: string,
    options: {
      attempts?: number
      log?: AttemptEvent[]
      retryAfterMs?: number
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'TranscriptionError'
    this.kind = kind
    this.attempts = options.attempts ?? 0
    this.log = options.log ?? []
    this.retryAfterMs = options.retryAfterMs
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createAttemptSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const onParentAbort = () => controller.abort()

  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', onParentAbort, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clear: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

function messageForAllKeys(
  keys: ApiKey[],
  health: HealthAdapter,
  fallback?: ClassifiedError,
): TranscriptionFailureKind {
  if (fallback) return fallback.kind
  const states = keys.map((key) => health.getKey(key.id))
  if (states.length > 0 && states.every((state) => state?.status === 'invalid')) {
    return 'invalid_key'
  }
  if (
    states.length > 0 &&
    states.every(
      (state) =>
        state?.status === 'exhausted' ||
        (state?.status === 'cooling' &&
          state.cooldownUntil != null &&
          state.cooldownUntil > Date.now()),
    )
  ) {
    return states.some((state) => state?.status === 'exhausted') ? 'daily_quota' : 'rate_limit'
  }
  return 'busy'
}

export async function runTranscription(
  options: RunTranscriptionOptions,
): Promise<TranscriptionSuccess> {
  const policy: RetryPolicy = { ...DEFAULT_POLICY, ...options.policy }
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const classify = options.classify ?? classifyError
  const health = options.health
  const keys = options.keys
  const models = [...new Set(options.models.filter(Boolean))]

  if (keys.length === 0) {
    throw new TranscriptionError('no_keys', 'Add a Gemini API key to transcribe.')
  }
  if (models.length === 0) {
    throw new TranscriptionError('no_models', 'Enable at least one Gemini model in Settings.')
  }

  const startedAt = now()
  const deadline = startedAt + policy.totalTimeoutMs
  const log: AttemptEvent[] = []
  let attempts = 0
  let round = 0
  let lastError: ClassifiedError | undefined

  const emit = (event: AttemptEvent) => {
    log.push(event)
    options.onEvent?.(event)
  }

  const isUsable = (key: ApiKey) => {
    const state = health.getKey(key.id)
    if (state?.status === 'invalid') return false
    if (state?.cooldownUntil && state.cooldownUntil > now()) return false
    return true
  }

  const throwAborted = (): never => {
    throw new TranscriptionError('aborted', 'Canceled.', {
      attempts,
      log,
      cause: new DOMException('Aborted', 'AbortError'),
    })
  }

  while (round < policy.maxRounds && now() < deadline) {
    const availableKeys = keys.filter(isUsable)

    if (availableKeys.length === 0) {
      const soonest = Math.min(
        ...keys.map((key) => health.getKey(key.id)?.cooldownUntil ?? Infinity),
      )
      const wait = soonest - now()
      if (Number.isFinite(wait) && wait > 0 && wait <= policy.rateLimitInlineWaitMs && now() + wait < deadline) {
        options.onStatus?.(`Waiting ${Math.ceil(wait / 1000)}s for a key…`)
        emit({
          type: 'wait',
          index: attempts,
          at: now(),
          model: '',
          keyId: '',
          keyLabel: '',
          waitMs: wait,
          message: 'All keys are cooling down.',
        })
        await sleep(wait, options.signal)
        continue
      }
      break
    }

    const availableModels = models.filter((model) => {
      const until = health.getModelUnavailable(model)
      return !until || until <= now()
    })
    if (availableModels.length === 0) break

    const orderedKeys = [...availableKeys].sort((a, b) => {
      const aUsed = health.getKey(a.id)?.lastUsedAt ?? 0
      const bUsed = health.getKey(b.id)?.lastUsedAt ?? 0
      return aUsed - bUsed
    })

    let stop = false

    for (const model of availableModels) {
      if (stop) break
      let nextModel = false

      for (const key of orderedKeys) {
        if (stop || nextModel) break
        if (!isUsable(key)) continue
        if (options.signal?.aborted) throwAborted()

        let inlineRetry = false

        while (true) {
          if (attempts >= policy.maxAttempts || now() >= deadline) {
            stop = true
            break
          }

          attempts += 1
          const attemptIndex = attempts
          const attemptAt = now()
          emit({
            type: 'attempt',
            index: attemptIndex,
            at: attemptAt,
            model,
            keyId: key.id,
            keyLabel: key.label,
          })

          const timeout = createAttemptSignal(options.signal, policy.attemptTimeoutMs)
          let streamed = ''

          try {
            const result = await options.call({
              model,
              key,
              signal: timeout.signal,
              onDelta: (text) => {
                streamed = text
                options.onPartial?.(text)
              },
            })
            timeout.clear()

            if (options.signal?.aborted) throwAborted()

            const text = (result.text || streamed || '').trim()
            health.setKey(key.id, {
              status: 'ok',
              cooldownUntil: undefined,
              lastError: undefined,
              lastUsedAt: now(),
            })
            emit({
              type: 'success',
              index: attemptIndex,
              at: now(),
              model,
              keyId: key.id,
              keyLabel: key.label,
            })
            options.onPartial?.(text)

            return {
              text,
              model,
              keyId: key.id,
              keyLabel: key.label,
              attempts,
              elapsedMs: now() - startedAt,
              log,
            }
          } catch (error) {
            timeout.clear()

            if (options.signal?.aborted) throwAborted()

            let classified = classify(error)
            if (timeout.didTimeout() && classified.kind !== 'aborted') {
              classified = {
                kind: 'network',
                message: 'Gemini took too long to respond.',
                status: classified.status,
                quotaIds: classified.quotaIds,
              }
            }
            lastError = classified
            emit({
              type: 'retry',
              index: attemptIndex,
              at: now(),
              model,
              keyId: key.id,
              keyLabel: key.label,
              kind: classified.kind,
              message: classified.message,
            })
            options.onPartial?.('')

            if (classified.kind === 'invalid_key') {
              health.setKey(key.id, {
                status: 'invalid',
                lastError: classified.message,
              })
              break
            }

            if (classified.kind === 'daily_quota') {
              health.setKey(key.id, {
                status: 'exhausted',
                cooldownUntil: nextQuotaReset(),
                lastUsedAt: now(),
                lastError: classified.message,
              })
              break
            }

            if (classified.kind === 'rate_limit') {
              const wait = Math.min(classified.retryAfterMs ?? 2_000, 60_000)
              if (!inlineRetry && wait <= policy.rateLimitInlineWaitMs && now() + wait < deadline) {
                inlineRetry = true
                options.onStatus?.(`Rate limited — waiting ${Math.ceil(wait / 1000)}s…`)
                emit({
                  type: 'wait',
                  index: attemptIndex,
                  at: now(),
                  model,
                  keyId: key.id,
                  keyLabel: key.label,
                  waitMs: wait,
                  message: 'Rate limited by Gemini.',
                })
                await sleep(wait, options.signal)
                continue
              }
              health.setKey(key.id, {
                status: 'cooling',
                cooldownUntil: now() + Math.max(wait, 5_000),
                lastError: classified.message,
              })
              break
            }

            if (
              classified.kind === 'busy' ||
              classified.kind === 'network' ||
              classified.kind === 'bad_request'
            ) {
              nextModel = true
              break
            }

            if (classified.kind === 'model_gone') {
              health.setModelUnavailable(model)
              nextModel = true
              break
            }

            throw new TranscriptionError(classified.kind, classified.message, {
              attempts,
              log,
              retryAfterMs: classified.retryAfterMs,
              cause: error,
            })
          }
        }
      }
    }

    if (stop) break

    round += 1
    if (round >= policy.maxRounds || now() >= deadline) break

    const wait = computeBackoff(round, {
      baseMs: policy.backoffBaseMs,
      maxMs: policy.backoffMaxMs,
    })
    if (now() + wait >= deadline) break
    options.onStatus?.(`Retrying in ${Math.ceil(wait / 1000)}s…`)
    emit({
      type: 'wait',
      index: attempts,
      at: now(),
      model: '',
      keyId: '',
      keyLabel: '',
      waitMs: wait,
      message: 'Backing off before trying again.',
    })
    await sleep(wait, options.signal)
  }

  const kind = messageForAllKeys(keys, health, lastError)
  throw new TranscriptionError(kind, lastError?.message ?? 'Gemini could not transcribe this recording.', {
    attempts,
    log,
    retryAfterMs: lastError?.retryAfterMs,
  })
}
