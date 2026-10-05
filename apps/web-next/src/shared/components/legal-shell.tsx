import type { ReactNode } from 'react'
import { PublicHeader } from '@/shared/components/public-header'
import { SiteFooter } from '@/shared/components/site-footer'

export interface LegalSection {
  id: string
  title: string
}

interface LegalShellProps {
  title: string
  updatedAt: string
  current?: 'terms' | 'privacy'
  sections?: LegalSection[]
  children: ReactNode
}

/**
 * Responsive frame for the terms / privacy pages. Those routes are `force-static`,
 * so this file stays a plain server component: no `cookies()`, no `headers()`,
 * nothing browser-only at module scope or during render.
 *
 * Screen adaptability:
 * - Mobile (< 640px): 100% fluid reading flow, padding 16px, edge-to-edge breathing room.
 * - Tablet (640px - 1024px): Centered readable container (max-w-3xl), padding 24px.
 * - Desktop (>= 1024px): Full max-w-content layout with sticky Table of Contents sidebar
 *   on the left and structured reading article on the right (max-w-3xl / max-w-4xl).
 * - Opaque sticky navbar matches site max-w-content grid, with switcher between
 *   terms and privacy, theme toggle, and return navigation.
 * - Footer provides copyright and navigational symmetry with marketing page.
 */
export function LegalShell({ title, updatedAt, current = 'terms', sections = [], children }: LegalShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-foreground antialiased flex flex-col justify-between">
      <div>
        <PublicHeader current={current} />

        {/* Main Content Area */}
        <main className="mx-auto w-full max-w-content px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12 xl:gap-16">
            {/* Sticky Table of Contents on Desktop (>= 1024px) */}
            {sections.length > 0 && (
              <aside
                aria-label="条款目录导航"
                className="hidden lg:block lg:w-60 xl:w-68 lg:shrink-0 lg:sticky lg:top-[calc(var(--layout-header)+1.5rem)]"
              >
                <nav className="flex flex-col gap-3 rounded-card bg-surface p-4 border border-border shadow-soft">
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <h2 className="text-base font-medium text-foreground">
                      {title}目录
                    </h2>
                    <span className="font-mono text-xs text-muted-foreground">
                      {sections.length} 条
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 max-h-[calc(100vh-14rem)] overflow-y-auto pr-1">
                    {sections.map((sec) => (
                      <a
                        key={sec.id}
                        href={`#${sec.id}`}
                        className="rounded-control px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-tonal-hover hover:text-foreground truncate"
                        title={sec.title}
                      >
                        {sec.title}
                      </a>
                    ))}
                  </div>
                </nav>
              </aside>
            )}

            {/* Document Content Area */}
            <article className="min-w-0 flex-1 max-w-full lg:max-w-3xl xl:max-w-4xl">
              <header className="pb-6 border-b border-border">
                <h1 className="text-title font-normal text-foreground leading-[1.25]">{title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  最后更新：<span className="font-mono tabular-nums whitespace-nowrap">{updatedAt}</span>
                </p>
              </header>

              <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10 [&_h2]:[text-wrap:balance] [&_h2]:text-subtitle [&_h2]:font-normal [&_h2]:text-foreground [&_p]:mt-3 [&_p]:text-base [&_p]:leading-[1.59] [&_p]:[text-wrap:pretty] [&_p]:[overflow-wrap:break-word] [&_p]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-base [&_ul]:leading-[1.59] [&_ul]:text-foreground [&_li]:[text-wrap:pretty] [&_li]:[overflow-wrap:break-word] [&_strong]:font-medium [&_strong]:text-foreground">
                {children}
              </div>
            </article>
          </div>
        </main>
      </div>

      {/* Footer */}
      <SiteFooter current={current} className="mt-16" />
    </div>
  )
}
