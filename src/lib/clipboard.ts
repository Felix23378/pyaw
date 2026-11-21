export interface DeferredCopy {
  commit: (text: string) => Promise<boolean>
  abort: () => void
}

/**
 * Starts a clipboard write synchronously inside a user gesture (required by iOS Safari
 * and mobile browsers) using a deferred ClipboardItem Promise<Blob>, so async
 * transcription results can be written to the clipboard after fetch completes.
 */
export function beginDeferredCopy(): DeferredCopy | null {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    typeof ClipboardItem === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.clipboard?.write
  ) {
    return null
  }

  let resolveBlob!: (blob: Blob) => void
  let rejectBlob!: (reason?: unknown) => void
  let settled = false

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    resolveBlob = resolve
    rejectBlob = reject
  })
  blobPromise.catch(() => {})

  let writePromise: Promise<boolean>
  try {
    writePromise = navigator.clipboard
      .write([new ClipboardItem({ 'text/plain': blobPromise })])
      .then(() => true)
      .catch(() => false)
  } catch {
    return null
  }

  return {
    commit: async (text: string) => {
      if (settled) return false
      settled = true
      if (!text) {
        rejectBlob(new Error('empty'))
        return false
      }
      resolveBlob(new Blob([text], { type: 'text/plain' }))
      return writePromise
    },
    abort: () => {
      if (settled) return
      settled = true
      rejectBlob(new Error('aborted'))
    },
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.appendChild(area)
    area.focus()
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export type ShareResult = 'shared' | 'copied' | false

export async function shareText(text: string): Promise<ShareResult> {
  if (!text) return false
  if (navigator.share) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return false
    }
  }
  return (await copyText(text)) ? 'copied' : false
}
