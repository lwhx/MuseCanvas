import Link from 'next/link'
import { ThemeToggle } from '@/shared/components/ui/theme-toggle'
import { buttonVariants } from '@/shared/components/ui/button-variants'
import { cn } from '@/shared/lib/cn'

export interface PublicHeaderProps {
  current?: 'landing' | 'terms' | 'privacy'
  className?: string
}

const navLink = buttonVariants({ variant: 'ghost', size: 'sm' })
const headerLogin = buttonVariants({ variant: 'primary', size: 'md' })

/**
 * Reusable top navigation header for public pages (landing, terms, privacy).
 *
 * Sizing & Layout Contract:
 * - Height is STRICTLY FIXED to `h-[var(--layout-header)]` (56px).
 * - Sits in a centered `max-w-content` container with standard `px-4 sm:px-6`.
 * - Brand wordmark has a strictly fixed height `h-6 w-auto` (24px).
 * - Border rule `border-b border-border bg-surface` at `z-sticky`.
 */
export function PublicHeader({ current = 'landing', className }: PublicHeaderProps) {
  return (
    <header
      className={cn('sticky top-0 z-sticky border-b border-border bg-surface', className)}
      aria-label="主导航"
    >
      <div className="mx-auto flex h-[var(--layout-header)] w-full max-w-content items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="flex min-w-0 shrink items-center rounded-control"
            aria-label="MuseCanvas 首页"
          >
            <img
              src="/brand/musecanvas_flow_ribbon_final_pack/03_transparent_trimmed_png/03_wordmark_transparent_trimmed.png"
              alt="MuseCanvas"
              className="h-6 w-auto"
            />
          </Link>

          {/* Legal quick switcher when on terms or privacy */}
          {(current === 'terms' || current === 'privacy') && (
            <div className="hidden items-center gap-1 sm:flex text-sm">
              <Link
                href="/terms"
                className={cn(
                  'rounded-control px-2.5 py-1 transition-colors',
                  current === 'terms'
                    ? 'font-medium text-foreground bg-tonal'
                    : 'text-muted-foreground hover:bg-tonal-hover hover:text-foreground',
                )}
              >
                用户协议
              </Link>
              <Link
                href="/privacy"
                className={cn(
                  'rounded-control px-2.5 py-1 transition-colors',
                  current === 'privacy'
                    ? 'font-medium text-foreground bg-tonal'
                    : 'text-muted-foreground hover:bg-tonal-hover hover:text-foreground',
                )}
              >
                隐私政策
              </Link>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {current === 'landing' ? (
            <>
              <Link href="#capabilities" className={cn(navLink, 'hidden md:inline-flex')}>
                产品能力
              </Link>
              <Link href="#workflow" className={cn(navLink, 'hidden md:inline-flex')}>
                创作流程
              </Link>
              <Link href="/terms" className={cn(navLink, 'hidden sm:inline-flex')}>
                用户协议
              </Link>
              <Link href="/privacy" className={cn(navLink, 'hidden sm:inline-flex')}>
                隐私政策
              </Link>
            </>
          ) : (
            <Link href="/" className={cn(navLink, 'hidden sm:inline-flex')}>
              返回首页
            </Link>
          )}

          <ThemeToggle />

          <Link href="/login" className={headerLogin}>
            登录
          </Link>
        </div>
      </div>
    </header>
  )
}
