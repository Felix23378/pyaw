import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/useAppStore'

interface CopyButtonProps {
  text: string
  variant?: 'primary' | 'secondary' | 'icon'
  className?: string
  label?: string
  onCopied?: () => void
}

export function CopyButton({
  text,
  variant = 'secondary',
  className,
  label = 'Copy',
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  const notify = useAppStore((store) => store.notify)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = await copyText(text)
    if (!ok) {
      notify('Couldn’t copy automatically — select the text and copy it.', 'error')
      return
    }
    setCopied(true)
    onCopied?.()
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1800)
  }

  const iconOnly = variant === 'icon'

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy transcript'}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-all duration-200',
        iconOnly ? 'size-9' : 'h-9 px-3 text-xs',
        variant === 'primary' &&
          'bg-marigold text-[#23180a] shadow-sm hover:brightness-95',
        variant === 'secondary' &&
          'border border-line bg-surface text-ink hover:bg-surface-2',
        variant === 'icon' && 'text-muted hover:bg-surface-2 hover:text-ink',
        copied && variant !== 'icon' && 'bg-jade text-white hover:brightness-100',
        className,
      )}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  )
}
