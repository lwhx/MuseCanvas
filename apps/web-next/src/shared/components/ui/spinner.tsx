import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/** Icon sizes from `--icon-*` (icons.md §3): the spinner never invents a size. */
const sizeClass = {
  xs: 'h-[var(--icon-xs)] w-[var(--icon-xs)]',
  sm: 'h-[var(--icon-sm)] w-[var(--icon-sm)]',
  md: 'h-[var(--icon-md)] w-[var(--icon-md)]',
  lg: 'h-[var(--icon-lg)] w-[var(--icon-lg)]',
} as const

export interface SpinnerProps {
  /** `sm` (16px) sits inside a 40px control; `lg` is for page-level loading. */
  size?: keyof typeof sizeClass
  /**
   * Text for assistive tech (`加载中`). The glyph itself is always decorative
   * per icons.md §1, so a busy state is announced through this text or through
   * `aria-busy` on the owning control — never through the icon.
   */
  label?: string
  /** Swap the glyph for another loader without changing the behaviour contract. */
  icon?: LucideIcon
  className?: string
}

/**
 * Busy indicator. Rotation comes from `.motion-spin` (600ms linear, globals.css)
 * rather than Tailwind's `animate-spin`, so the duration stays a token and
 * reduced-motion turns it into a static glyph while the state stays legible.
 */
export function Spinner({ size = 'sm', label, icon: Icon = Loader2, className }: SpinnerProps) {
  return (
    <>
      <Icon aria-hidden="true" className={cn('motion-spin shrink-0', sizeClass[size], className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  )
}
