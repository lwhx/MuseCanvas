import { redirect } from 'next/navigation'
import { serverApi } from '@/shared/services/server-api'
import { ServiceUnavailable } from '@/shared/components/service-unavailable'
import { WorkspaceHeader } from '@/features/workspace/components/workspace-header'

export const dynamic = 'force-dynamic'

/**
 * Workspace shell (foundations.md → 管理后台布局).
 *
 * The header is a full-bleed bar at `--layout-header`; the content it drives is
 * capped at `--container-content` (`max-w-content`, 1200px) and centred, so a 4K
 * monitor gets a wide console rather than edge-to-edge form fields. Nothing here
 * hardcodes a height or a pixel width: both come from the token contract in
 * `app/globals.css`.
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
      <main className="flex min-h-0 flex-1 justify-center overflow-auto">
        <div className="flex min-h-0 w-full max-w-content flex-1 flex-col">{children}</div>
      </main>
    </div>
  )
}
