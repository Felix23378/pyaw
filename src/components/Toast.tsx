import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export function Toast() {
  const toast = useAppStore((store) => store.toast)
  const dismissToast = useAppStore((store) => store.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismissToast(toast.id), 3600)
    return () => window.clearTimeout(timer)
  }, [toast, dismissToast])

  if (!toast) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div
        role={toast.tone === 'error' ? 'alert' : 'status'}
        className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border border-paper/10 bg-ink px-3.5 py-2.5 text-sm text-paper shadow-lift animate-pop-in"
      >
        {toast.tone === 'error' ? (
          <AlertCircle className="size-4 shrink-0 text-rust" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-jade" />
        )}
        <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          aria-label="Dismiss notification"
          className="grid size-6 shrink-0 place-items-center rounded-full text-paper/60 hover:bg-paper/10 hover:text-paper"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
