import { LibraryView } from '@/features/library/components/library-view'
import { Skeleton, SkeletonTile, SkeletonText } from '@/shared/components/ui'
import { Suspense } from 'react'

function LibraryPageSkeleton() {
  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-content flex-1 flex-col gap-6" aria-busy="true">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <SkeletonText lines={1} width="min(32rem, 75vw)" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-[var(--control-sm)] w-16 rounded-control" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-[var(--control-md)] min-w-60 flex-1 rounded-control md:max-w-form" />
            <Skeleton className="h-[var(--control-md)] w-32 rounded-control" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>

        <div className="flex gap-1 border-b border-border pb-2" aria-hidden="true">
          {[0, 1, 2].map((tab) => (
            <Skeleton key={tab} className="h-9 w-20 rounded-control" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <SkeletonTile key={index} />)}
        </div>
        <p className="sr-only">正在加载作品图库…</p>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '作品图库 - MuseCanvas',
  description: 'AI 创作画廊与历史作品管理',
}

export default function LibraryPage() {
  // The gallery keeps its filters (`q` / `type` / `page`) in the URL so a filtered
  // view is shareable, which makes it a `useSearchParams` consumer — and every one of
  // those needs a Suspense boundary over the route, or the whole page falls back to
  // client-side rendering on read.
  return (
    <Suspense fallback={<LibraryPageSkeleton />}>
      <LibraryView />
    </Suspense>
  )
}
