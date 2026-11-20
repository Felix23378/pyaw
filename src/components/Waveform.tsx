import { cn } from '../lib/utils'

export function Waveform({
  bars,
  active = false,
  className,
  count = 44,
}: {
  bars: number[]
  active?: boolean
  className?: string
  count?: number
}) {
  const display = Array.from({ length: count }, (_, index) => {
    if (bars.length <= count) return bars[index] ?? 0
    const sourceIndex = bars.length - count + index
    return bars[sourceIndex] ?? 0
  })

  return (
    <div
      aria-hidden="true"
      className={cn('flex h-14 items-center justify-center gap-[3px]', className)}
    >
      {display.map((value, index) => {
        const height = active ? Math.max(6, Math.min(100, value * 100)) : 6
        return (
          <span
            key={index}
            className={cn(
              'w-[3px] rounded-full transition-[height,background-color] duration-100',
              active ? 'bg-marigold-deep/75' : 'bg-line-strong/60',
            )}
            style={{ height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}
