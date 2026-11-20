const TARGET_SAMPLE_RATE = 16_000

const SUPPORTED_API_MIMES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/webm',
  'audio/opus',
])

export function needsWavTranscode(mimeType: string): boolean {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  if (!base) return true
  return !SUPPORTED_API_MIMES.has(base)
}

/**
 * Downsample mono or stereo PCM samples to 16 kHz mono using linear interpolation.
 */
export function downsampleMono(
  samples: Float32Array,
  inputRate: number,
  outputRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (inputRate <= 0 || outputRate <= 0 || inputRate === outputRate) {
    return samples
  }
  const ratio = inputRate / outputRate
  const length = Math.max(1, Math.round(samples.length / ratio))
  const result = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = samples[Math.min(idx, samples.length - 1)] ?? 0
    const s1 = samples[Math.min(idx + 1, samples.length - 1)] ?? s0
    result[i] = s0 + (s1 - s0) * frac
  }
  return result
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  if (channels <= 1) return buffer.getChannelData(0)
  const mono = new Float32Array(length)
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels
    }
  }
  return mono
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/**
 * Encode mono float PCM samples (-1..1) as a 16-bit PCM WAV Blob.
 */
export function encodePcmToWav(
  samples: Float32Array,
  sampleRate = TARGET_SAMPLE_RATE,
): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
    view.setInt16(offset, int16, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Decode an arbitrary browser audio Blob via AudioContext and re-encode as 16 kHz mono WAV.
 */
export async function transcodeBlobToWav(blob: Blob): Promise<Blob> {
  const AudioCtor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!AudioCtor) {
    throw new Error('AudioContext is unavailable for WAV transcoding.')
  }

  const context = new AudioCtor()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0))
    const mono = mixToMono(decoded)
    const resampled = downsampleMono(mono, decoded.sampleRate, TARGET_SAMPLE_RATE)
    return encodePcmToWav(resampled, TARGET_SAMPLE_RATE)
  } finally {
    await context.close().catch(() => {})
  }
}
