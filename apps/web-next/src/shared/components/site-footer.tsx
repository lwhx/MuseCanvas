import Link from 'next/link'
import { cn } from '@/shared/lib/cn'

export interface SiteFooterProps {
  current?: 'landing' | 'terms' | 'privacy'
  className?: string
}

/**
 * Reusable footer for public and legal pages.
 *
 * Sizing & Layout:
 * - Brand logo is enlarged to `h-9 sm:h-10` (~36-40px) for prominent legibility.
 * - Sits in a strictly centered `max-w-content` container with `px-4 sm:px-6`.
 * - Tonal surface with subtle border rule per Jude-Frontweb marketing layout guidelines.
 */
export function SiteFooter({ current, className }: SiteFooterProps) {
  return (
    <footer className={cn('border-t border-border bg-tonal py-10', className)}>
      <div className="mx-auto flex w-full max-w-content flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6">
        <Link href="/" className="flex items-center rounded-control" aria-label="返回 MuseCanvas 首页">
          <img
            src="/brand/musecanvas_flow_ribbon_final_pack/03_transparent_trimmed_png/04_monochrome_logo_transparent_trimmed.png"
            alt="MuseCanvas"
            className="h-9 sm:h-10 w-auto opacity-90 transition-opacity hover:opacity-100"
          />
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {current !== 'landing' && (
            <Link
              href="/"
              className="rounded-control transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-foreground"
            >
              首页
            </Link>
          )}
          <Link
            href="/terms"
            className={cn(
              'rounded-control transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-foreground',
              current === 'terms' && 'font-medium text-foreground',
            )}
          >
            用户协议
          </Link>
          <Link
            href="/privacy"
            className={cn(
              'rounded-control transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-foreground',
              current === 'privacy' && 'font-medium text-foreground',
            )}
          >
            隐私政策
          </Link>
          <span className="text-decorative-muted">&copy; 2026 MuseCanvas</span>
        </div>
      </div>
    </footer>
  )
}
