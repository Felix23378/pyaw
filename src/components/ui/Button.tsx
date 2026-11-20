import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variants: Record<Variant, string> = {
  primary:
    'bg-marigold text-[#23180a] shadow-sm hover:brightness-[0.96] active:brightness-90',
  secondary:
    'border border-line bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  soft: 'bg-marigold-soft/60 text-marigold-deep hover:bg-marigold-soft',
  danger: 'bg-rust/10 text-rust hover:bg-rust/15',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 gap-1.5 px-3 text-xs',
  md: 'h-11 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
  icon: 'size-10 p-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
})
