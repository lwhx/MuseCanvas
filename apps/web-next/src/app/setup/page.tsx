import { SetupWizard } from '@/features/setup/components/setup-wizard'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '系统安装向导 - MuseCanvas',
  description: 'MuseCanvas 实例初始化与环境配置',
}

/** Matches the wizard's own loading geometry, so the route swap does not jump. */
function SetupFallback() {
  return (
    <div
      className="flex min-h-screen flex-col items-center bg-canvas px-4 py-8 text-foreground"
      role="status"
      aria-label="正在加载向导"
    >
      <div className="flex w-full max-w-form flex-col gap-4" aria-hidden="true">
        <span className="motion-shimmer block h-8 w-52 rounded-checkbox" />
        <span className="motion-shimmer block h-10 w-full rounded-checkbox" />
        <span className="motion-shimmer block h-64 w-full rounded-card" />
      </div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupFallback />}>
      <SetupWizard />
    </Suspense>
  )
}
