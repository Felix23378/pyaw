import type { Recording, RecordingSource, Settings, TranscriptEntry } from '../types'
import { uuid } from '../lib/utils'
import { transcribeAudio } from '../gemini/client'
import { healthAdapter } from '../retry/health'
import {
  runTranscription,
  TranscriptionError,
  type AttemptEvent,
} from '../retry/orchestrator'

export interface TranscribeInput {
  recording: Recording
  settings: Settings
  source: RecordingSource
  signal?: AbortSignal
  onPartial?: (text: string) => void
  onEvent?: (event: AttemptEvent) => void
  onStatus?: (message: string) => void
}

export async function transcribeRecording(input: TranscribeInput): Promise<TranscriptEntry> {
  const { recording, settings, source } = input
  const models = settings.models.filter((model) => model.enabled).map((model) => model.id)

  if (settings.keys.length === 0) {
    throw new TranscriptionError('no_keys', 'Add a Gemini API key to transcribe.')
  }
  if (models.length === 0) {
    throw new TranscriptionError('no_models', 'Enable at least one Gemini model in Settings.')
  }

  const result = await runTranscription({
    keys: settings.keys,
    models,
    health: healthAdapter,
    signal: input.signal,
    onPartial: input.onPartial,
    onEvent: input.onEvent,
    onStatus: input.onStatus,
    call: async ({ model, key, signal, onDelta }) => {
      const text = await transcribeAudio({
        apiKey: key.value,
        keyId: key.id,
        model,
        blob: recording.blob,
        mimeType: recording.mimeType,
        languageMode: settings.languageMode,
        signal,
        onDelta,
        onStatus: input.onStatus,
      })
      return { text }
    },
  })

  const text = result.text.trim() || '[no speech]'

  return {
    id: uuid(),
    text,
    createdAt: Date.now(),
    durationMs: recording.durationMs,
    model: result.model,
    language: settings.languageMode,
    source,
    charCount: [...text].length,
  }
}

export interface ErrorCopy {
  title: string
  message: string
  settingsCta: boolean
  retryable: boolean
}

export function errorCopy(error: unknown): ErrorCopy {
  if (error instanceof TranscriptionError) {
    switch (error.kind) {
      case 'no_keys':
        return {
          title: 'One key and you’re set',
          message: 'Add a Gemini API key in Settings to start transcribing. It stays in this browser.',
          settingsCta: true,
          retryable: false,
        }
      case 'no_models':
        return {
          title: 'No models enabled',
          message: 'Enable at least one Gemini model in Settings, then try again.',
          settingsCta: true,
          retryable: false,
        }
      case 'invalid_key':
        return {
          title: 'Your API key was rejected',
          message: 'Google rejected every key we tried. Add a working Gemini key in Settings.',
          settingsCta: true,
          retryable: false,
        }
      case 'daily_quota':
        return {
          title: 'All keys are out of quota',
          message:
            'Every key has used its daily Gemini quota. It resets at midnight Pacific — try again then, or add another key.',
          settingsCta: true,
          retryable: false,
        }
      case 'rate_limit':
        return {
          title: 'Gemini is rate-limiting you',
          message: 'All keys are cooling down. Wait a few seconds, then try again.',
          settingsCta: false,
          retryable: true,
        }
      case 'busy':
        return {
          title: 'Gemini is busy',
          message: 'We tried every model. Give it a moment and try again.',
          settingsCta: false,
          retryable: true,
        }
      case 'network':
        return {
          title: 'Couldn’t reach Gemini',
          message: 'Check your connection, then try again. Your recording is still here.',
          settingsCta: false,
          retryable: true,
        }
      case 'too_large':
        return {
          title: 'That recording is too long',
          message: 'Keep it under 10 minutes (or about 12 MB), then try again.',
          settingsCta: false,
          retryable: false,
        }
      case 'blocked':
        return {
          title: 'Couldn’t transcribe that clip',
          message: 'Try recording again, a little closer to the mic.',
          settingsCta: false,
          retryable: true,
        }
      case 'billing':
        return {
          title: 'No credit on this key',
          message: 'Your Gemini account has no available credit. Check billing in Google AI Studio.',
          settingsCta: true,
          retryable: false,
        }
      case 'model_gone':
        return {
          title: 'Models unavailable',
          message: 'Your key can’t access the enabled models. Choose different models in Settings.',
          settingsCta: true,
          retryable: false,
        }
      case 'aborted':
        return {
          title: 'Canceled',
          message: 'The transcription was canceled.',
          settingsCta: false,
          retryable: false,
        }
      default:
        return {
          title: 'Something went wrong',
          message: error.message || 'Gemini could not transcribe this recording. Try again.',
          settingsCta: false,
          retryable: true,
        }
    }
  }

  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : 'Gemini could not transcribe this recording.',
    settingsCta: false,
    retryable: true,
  }
}
