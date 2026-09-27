import { Suspense } from 'react'
import { PageHeader, Skeleton, SkeletonRow, SkeletonText } from '@/shared/components/ui'
import { GenerateConsole } from '@/features/generate/components/generate-console'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '创作工作台 - MuseCanvas',
  description: 'AI 图像与视频生成工作室与控制台',
}

/**
 * The console still reads `?tab=` as a one-shot deep link into the creation
 * mode, so it remains a `useSearchParams` consumer and needs a boundary like
 * every other one. The mode itself is owned by `useGenerateUiStore.activeTab`,
 * which is what the workspace header's 作图 / 生视频 entries write.
 *
 * The fallback mirrors the console's own geometry — header, composer, stage —
 * so the swap to the real thing moves nothing on screen.
 */
function GenerateConsoleFallback() {
  return (
    <div aria-busy="true" className="flex min-h-0 w-full flex-1 overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6 lg:p-8">
        <PageHeader title="创作台" description="正在载入创作台…" />
        <div className="flex flex-col gap-0 rounded-card bg-surface p-4 shadow-soft">
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <SkeletonText lines={4} className="w-full" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Skeleton className="h-[var(--control-sm)] w-36" />
            <Skeleton className="h-[var(--control-sm)] w-24" />
            <Skeleton className="h-[var(--control-sm)] w-24" />
            <Skeleton className="h-[var(--control-sm)] w-32" />
            <Skeleton className="ml-auto h-[var(--control-md)] w-28" />
          </div>
        </div>
        <span className="sr-only">正在载入创作台</span>
      </main>
      <aside aria-hidden="true" className="hidden w-72 shrink-0 flex-col gap-3 bg-surface p-4 md:flex">
        <SkeletonRow cells={2} cellWidth="96px" />
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex gap-3 rounded-control bg-tonal p-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-control" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <SkeletonRow cells={2} cellWidth="72px" />
              <Skeleton className="h-1 w-full rounded-full" />
              <SkeletonRow />
            </div>
          </div>
        ))}
      </aside>
    </div>
  )
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<GenerateConsoleFallback />}>
      <GenerateConsole />
    </Suspense>
  )
}
