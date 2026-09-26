import { LibraryView } from '@/features/library/components/library-view'
import { Suspense } from 'react'

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
    <Suspense fallback={<div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">正在加载作品图库...</div>}>
      <LibraryView />
    </Suspense>
  )
}
