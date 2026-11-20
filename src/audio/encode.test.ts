import { describe, expect, it } from 'vitest'
import { downsampleMono, encodePcmToWav, needsWavTranscode } from './encode'

describe('needsWavTranscode', () => {
  it('accepts Gemini-native audio MIME types', () => {
    expect(needsWavTranscode('audio/webm;codecs=opus')).toBe(false)
    expect(needsWavTranscode('audio/m4a')).toBe(false)
    expect(needsWavTranscode('audio/ogg;codecs=opus')).toBe(false)
    expect(needsWavTranscode('audio/wav')).toBe(false)
  })

  it('flags unknown or empty MIME types for WAV transcoding', () => {
    expect(needsWavTranscode('')).toBe(true)
    expect(needsWavTranscode('audio/x-matroska')).toBe(true)
    expect(needsWavTranscode('application/octet-stream')).toBe(true)
  })
})

describe('downsampleMono', () => {
  it('returns input unchanged when sample rates match', () => {
    const input = new Float32Array([0.1, -0.2, 0.3, -0.4])
    const output = downsampleMono(input, 16_000, 16_000)
    expect(output).toBe(input)
  })

  it('downsamples 48 kHz to 16 kHz (3:1 ratio)', () => {
    const input = new Float32Array(480)
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * i) / 48)
    }
    const output = downsampleMono(input, 48_000, 16_000)
    expect(output.length).toBe(160)
  })
})

describe('encodePcmToWav', () => {
  it('writes a valid 16-bit mono PCM WAV header and clamped samples', async () => {
    const samples = new Float32Array([0, 1, -1, 1.5, -1.5, 0.5])
    const blob = encodePcmToWav(samples, 16_000)

    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + samples.length * 2)

    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, offset, len))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000) // byteRate
    expect(view.getUint16(32, true)).toBe(2) // blockAlign
    expect(view.getUint16(34, true)).toBe(16) // bitsPerSample
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)

    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x8000)
    expect(view.getInt16(50, true)).toBe(0x7fff) // clamped > 1
    expect(view.getInt16(52, true)).toBe(-0x8000) // clamped < -1
    expect(view.getInt16(54, true)).toBe(Math.round(0.5 * 0x7fff))
  })
})
