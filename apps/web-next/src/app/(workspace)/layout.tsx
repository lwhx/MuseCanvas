import { redirect } from 'next/navigation'
import { serverApi } from '@/shared/services/server-api'
import { ServiceUnavailable } from '@/shared/components/service-unavailable'
import { WorkspaceHeader } from '@/features/workspace/components/workspace-header'

export const dynamic = 'force-dynamic'

/**
 * Workspace shell (foundations.md → 管理后台布局).
 *
 * The workspace body fills the viewport below the full-bleed header. Content
 * pages such as account and library own their readable max-width containers;
 * the generation console uses the available width for its full-screen canvas.
 * Heights and spacing still come from the token contract in `app/globals.css`.
 */
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sessionRes = await serverApi.getMe()
  const user = sessionRes.success ? sessionRes.data?.user : undefined

  if (!user) {
    if (sessionRes.error?.code === 'UPSTREAM_UNAVAILABLE') {
      return <ServiceUnavailable />
    }
    redirect('/login')
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-foreground">
      <WorkspaceHeader initialUser={user} />
      <main className="flex min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </main>
    </div>
  )
}
