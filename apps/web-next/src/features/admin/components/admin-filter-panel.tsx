'use client'

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components/ui'
import { cn } from '@/shared/lib/cn'

export function AdminFilterPanel({ children, activeCount, summary }: { children: ReactNode; activeCount: number; summary?: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  return <section className="flex min-w-0 flex-col gap-3 max-md:[&_button]:min-h-[var(--control-lg)]" aria-label="列表筛选">
    <Button variant="secondary" size="lg" className="md:hidden" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((previous) => !previous)}>
      筛选{activeCount ? `（已选 ${activeCount} 项）` : ''}
    </Button>
    {activeCount > 0 && summary && <p className="min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">已应用：{summary}</p>}
    <div id={panelId} className={cn('min-w-0 md:block', !expanded && 'hidden')}>{children}</div>
  </section>
}
