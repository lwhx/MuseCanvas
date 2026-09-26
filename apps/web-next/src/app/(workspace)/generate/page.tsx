import { Suspense } from 'react'
import { PageHeader, SkeletonRow, SkeletonTile } from '@/shared/components/ui'
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
    <div
      aria-busy="true"
      className="flex w-full flex-1 flex-col gap-6 overflow-hidden p-4 md:p-6 lg:p-8"
    >
      <PageHeader title="创作台" description="正在载入创作台…" />
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-soft">
        <SkeletonRow cells={2} />
        <SkeletonRow cells={4} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonTile key={index} />
        ))}
      </div>
      <span className="sr-only">正在载入创作台</span>
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
