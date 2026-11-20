import { cn } from '../lib/utils'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <svg
        viewBox="0 0 512 512"
        aria-hidden="true"
        className="size-10 shrink-0 rounded-[13px] shadow-sm"
      >
        <rect width="512" height="512" rx="112" fill="#181512" />
        <circle cx="256" cy="252" r="164" fill="#E09A2B" />
        <rect x="220" y="142" width="72" height="148" rx="36" fill="#181512" />
        <path
          d="M182 262a74 74 0 0 0 148 0"
          stroke="#181512"
          strokeWidth="24"
          fill="none"
          strokeLinecap="round"
        />
        <path d="M256 336v48" stroke="#181512" strokeWidth="24" strokeLinecap="round" />
        <path d="M208 384h96" stroke="#181512" strokeWidth="24" strokeLinecap="round" />
      </svg>
      <div className={cn('min-w-0', compact && 'hidden sm:block')}>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Pyaw</span>
          <span className="font-mm text-xs text-muted">ပြော</span>
        </div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Myanmar voice notes</p>
      </div>
    </div>
  )
}
