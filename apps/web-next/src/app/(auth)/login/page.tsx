import { redirect } from 'next/navigation'
import { serverApi } from '@/shared/services/server-api'
import { LoginForm } from '@/features/auth/components/login-form'
import { ServiceUnavailable } from '@/shared/components/service-unavailable'
import { SkeletonText } from '@/shared/components/ui/skeleton'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '登录 - MuseCanvas',
  description: '登录 MuseCanvas AI 创作工作台',
}

/**
 * Placeholder for the client island behind `useSearchParams`. It stacks a title
 * line and two control-height blocks so the form swaps in without reflowing the
 * card — `states.md` §7 / skeleton geometry rules.
 */
function LoginFormFallback() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <SkeletonText lines={1} width="12rem" className="justify-center" />
        <SkeletonText lines={1} width="16rem" className="justify-center" />
      </div>
      <SkeletonText lines={1} width="100%" />
      <span className="motion-shimmer block min-h-[var(--control-md)] w-full rounded-control" aria-hidden="true" />
      <span className="motion-shimmer block min-h-[var(--control-md)] w-full rounded-control" aria-hidden="true" />
      <span className="sr-only">正在加载登录表单</span>
    </div>
  )
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams

  // Server-side session pre-check: authenticated users redirect; a downed
  // backend must not render a form whose submit is guaranteed to fail.
  const sessionRes = await serverApi.getMe()
  if (sessionRes.success && sessionRes.data?.user) {
    redirect(from || '/generate')
  }
  if (sessionRes.error?.code === 'UPSTREAM_UNAVAILABLE') {
    return <ServiceUnavailable />
  }

  return (
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  )
}
