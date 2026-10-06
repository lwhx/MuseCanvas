import { Suspense } from 'react'
import { Skeleton } from '@/shared/components/ui'
import { GenerateConsole } from '@/features/generate/components/generate-console'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '创作工作台 - MuseCanvas',
  description: 'AI 图像与视频生成工作室与控制台',
}

/** Match the toolbar, remaining-height canvas and bottom composer. The console
 * consumes the one-shot ?tab= deep link and therefore needs this boundary. */
function GenerateConsoleFallback() {
  return (
    <div role="region" aria-label="创作台" aria-busy="true" className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden p-3 md:p-5">
      <div aria-hidden="true" className="flex shrink-0 items-center justify-between gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-[var(--control-sm)] w-36" />
      </div>
      <Skeleton className="min-h-0 w-full flex-1 rounded-card" />
      <div aria-hidden="true" className="flex shrink-0 flex-col gap-3 rounded-card bg-surface p-3 shadow-soft pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
        <div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-[var(--control-sm)] w-24" /></div>
        <div className="hidden flex-col gap-3 md:flex">
          <Skeleton className="h-[var(--control-sm)] w-44" />
          <Skeleton className="h-16 w-full" />
          <div className="flex flex-wrap gap-3"><Skeleton className="h-[var(--control-sm)] w-36" /><Skeleton className="h-[var(--control-sm)] w-28" /><Skeleton className="h-[var(--control-sm)] w-28" /></div>
        </div>
        <Skeleton className="ml-auto h-[var(--control-md)] w-28" />
      </div>
      <span className="sr-only">正在载入创作台</span>
    </div>
  )
}

export default function GeneratePage() {
  return <Suspense fallback={<GenerateConsoleFallback />}><GenerateConsole /></Suspense>
}
