'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS, type OAuthProviderName } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { OAuthIdentity, OAuthProvider, UserProfile } from '@/shared/types'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  Divider,
  EmptyState,
  PageHeader,
  SkeletonText,
  buttonVariants,
  useToast,
} from '@/shared/components/ui'
import { GithubIcon, GoogleIcon } from '@/shared/components/brand-icons'
import { cn } from '@/shared/lib/cn'
import {
  Calendar,
  Link2,
  Mail,
  ShieldCheck,
  Unlink,
  X,
} from 'lucide-react'

/** The two providers this page can offer, in display order. */
const PROVIDERS: { name: OAuthProviderName; label: string }[] = [
  { name: 'github', label: 'GitHub' },
  { name: 'google', label: 'Google' },
]

/** Left group nav (components.md → 设置页). The ids double as the anchor targets. */
const NAV_GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  { title: '个人资料', items: [{ id: 'profile', label: '基本资料' }] },
  {
    title: '账号安全',
    items: [{ id: 'linked-accounts', label: '第三方账号绑定' }],
  },
]

/**
 * The contract answers 401/403 with `error.code`, and states.md §5 wants 无权限 told
 * apart from 加载失败 — so the code has to survive into the query error instead of
 * collapsing into a message string.
 */
class AccountRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AccountRequestError'
    this.code = code
  }
}

function isPermissionFailure(error: unknown): boolean {
  const code = error instanceof AccountRequestError ? error.code : ''
  return /FORBIDDEN|UNAUTHORIZED|ACCOUNT_UNAVAILABLE|CSRF_REJECTED|HTTP_40[13]/.test(code)
}

/** `YYYY-MM-DD` (copy.md §9). */
function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function AccountView() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [activeSection, setActiveSection] = useState(NAV_GROUPS[0].items[0].id)

  // Providers marked for removal but not yet saved, and the ones currently in
  // flight. Both are keyed by provider so one slow request cannot grey out the
  // other row the way a single shared `isPending` did.
  const [stagedUnlinks, setStagedUnlinks] = useState<OAuthProviderName[]>([])
  const [unlinking, setUnlinking] = useState<OAuthProviderName[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const {
    data: userProfile,
    isLoading: profileLoading,
    isError: profileIsError,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['account', 'me'],
    queryFn: async () => {
      const res = await api.getMe()
      if (!res.success || !res.data) {
        throw new AccountRequestError(res.error?.code || 'UNKNOWN', res.error?.message || '获取用户资料失败')
      }
      return res.data as UserProfile
    },
  })

  const {
    data: identities = [],
    isLoading: identitiesLoading,
    isError: identitiesIsError,
    error: identitiesError,
    refetch: refetchIdentities,
  } = useQuery<OAuthIdentity[], AccountRequestError>({
    queryKey: ['account', 'oauth-identities'],
    queryFn: async () => {
      const res = await api<OAuthIdentity[]>(API_ENDPOINTS.account.oauth)
      if (!res.success) {
        throw new AccountRequestError(res.error?.code || 'UNKNOWN', res.error?.message || '获取第三方绑定列表失败')
      }
      return res.data || []
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async (provider: OAuthProviderName) => {
      const res = await api(API_ENDPOINTS.account.oauthUnlink(provider), { method: 'DELETE' })
      if (!res.success) throw new Error(res.error?.message || '解除绑定失败')
      return res.data
    },
    onSuccess: (_data, provider) => {
      queryClient.invalidateQueries({ queryKey: ['account', 'oauth-identities'] })
      toast.push({
        title: `已解除 ${PROVIDERS.find((item) => item.name === provider)?.label ?? provider} 绑定`,
        variant: 'success',
      })
    },
    onError: (error: Error, provider) => {
      toast.push({
        title: `无法解除 ${PROVIDERS.find((item) => item.name === provider)?.label ?? provider} 绑定`,
        description: `${error.message}。请检查网络后重新保存更改。`,
        variant: 'error',
      })
    },
  })

  function identityOf(provider: OAuthProvider): OAuthIdentity | undefined {
    return identities.find((identity) => identity.provider === provider)
  }

  function toggleStaged(provider: OAuthProviderName) {
    setStagedUnlinks((prev) =>
      prev.includes(provider) ? prev.filter((item) => item !== provider) : [...prev, provider],
    )
  }

  /** Commits every staged removal. Each row keeps its own busy state, and a failed
   *  provider stays staged so the user can save it again without re-marking it. */
  async function saveUnlinks() {
    setConfirmOpen(false)
    const targets = stagedUnlinks
    if (targets.length === 0) return
    setUnlinking((prev) => [...prev, ...targets])
    const results = await Promise.allSettled(targets.map((provider) => unlinkMutation.mutateAsync(provider)))
    const succeeded = targets.filter((_, index) => results[index].status === 'fulfilled')
    setUnlinking((prev) => prev.filter((provider) => !targets.includes(provider)))
    setStagedUnlinks((prev) => prev.filter((provider) => !succeeded.includes(provider)))
  }

  function renderSectionState({
    isError,
    error,
    objectName,
    onRetry,
  }: {
    isError: boolean
    error: unknown
    objectName: string
    onRetry: () => void
  }) {
    if (!isError) return null
    if (isPermissionFailure(error)) {
      return (
        <EmptyState
          variant="no-permission"
          objectName={objectName}
          density="compact"
          description="你没有访问该设置的权限，或登录状态已失效。重新登录后即可继续修改。"
          action={
            <a href="/login" className={buttonVariants({ variant: 'secondary' })}>
              重新登录
            </a>
          }
        />
      )
    }
    return (
      <EmptyState
        variant="error"
        objectName={objectName}
        density="compact"
        description={`无法读取${objectName}：${error instanceof Error ? error.message : '网络或服务端错误'}。请稍后刷新重试。`}
        onAction={onRetry}
      />
    )
  }

  const profileSectionError = renderSectionState({
    isError: profileIsError && !profileLoading,
    error: profileError,
    objectName: '账户资料',
    onRetry: () => void refetchProfile(),
  })

  const identitiesSectionError = renderSectionState({
    isError: identitiesIsError && !identitiesLoading,
    error: identitiesError,
    objectName: '第三方绑定',
    onRetry: () => void refetchIdentities(),
  })

  const hasStagedChanges = stagedUnlinks.length > 0

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-content flex-1 flex-col gap-6 lg:gap-8">
        <PageHeader
          title="账户与安全"
          description="查看您的个人资料，并管理第三方账号的绑定与解绑。"
        />

        <div className="flex flex-1 flex-col gap-6 md:flex-row md:gap-8">
          {/* 设置页 left group nav: 16px group labels, `tonal-selected` + a 3px
              primary bar on the current item, collapsing to a wrapping chip row under
              `md:` (960px). */}
          <nav aria-label="设置分组" className="flex flex-wrap gap-3 md:w-settings-nav md:shrink-0 md:flex-col md:gap-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="flex min-w-0 flex-row flex-wrap items-center gap-2 md:flex-col md:items-stretch md:gap-1">
                <p className="hidden text-base font-medium text-foreground md:block mb-1">{group.title}</p>
                {group.items.map((item) => {
                  const current = item.id === activeSection
                  return (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        'relative rounded-control py-2 pr-3 pl-5 text-sm transition-colors duration-[var(--motion-fast)]',
                        current
                          ? 'bg-tonal-selected font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-tonal-hover hover:text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-pill',
                          current ? 'bg-primary' : 'bg-transparent',
                        )}
                      />
                      {item.label}
                    </a>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-8">
            {/* 基本资料 */}
            <section id="profile" aria-labelledby="profile-title" className="scroll-mt-4">
              {profileSectionError ? (
                profileSectionError
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle level={2} id="profile-title">
                      基本资料
                    </CardTitle>
                    <CardDescription>账户的基础信息，此处仅供查看。</CardDescription>
                  </CardHeader>
                  <CardBody>
                    {profileLoading ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-busy>
                        {[0, 1, 2].map((slot) => (
                          <div key={slot} className="flex min-w-0 flex-col gap-2">
                            <SkeletonText lines={1} width="72%" />
                            <SkeletonText lines={1} />
                          </div>
                        ))}
                        <p className="sr-only">正在加载账户资料…</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="flex items-start gap-3">
                          <Mail aria-hidden="true" className="mt-1 h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-xs text-muted-foreground">登录邮箱</p>
                            <p className="truncate text-sm text-foreground">{userProfile?.email || '—'}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <ShieldCheck aria-hidden="true" className="mt-1 h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-xs text-muted-foreground">账户权限</p>
                            <p className="text-sm text-foreground">
                              {userProfile?.role === 'admin' ? (
                                <Badge tone="info">管理员</Badge>
                              ) : (
                                <Badge tone="neutral">普通用户</Badge>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <Calendar aria-hidden="true" className="mt-1 h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-xs text-muted-foreground">注册时间</p>
                            <p className="font-mono text-sm tabular-nums text-foreground">
                              {formatDate(userProfile?.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}
            </section>

            <Divider />

            {/* 第三方账号绑定 — the only section that writes, hence the save bar. */}
            <section id="linked-accounts" aria-labelledby="linked-accounts-title" className="scroll-mt-4">
              {identitiesSectionError ? (
                identitiesSectionError
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle level={2} id="linked-accounts-title">
                      第三方账号绑定
                    </CardTitle>
                    <CardDescription>
                      绑定后可使用对应账号登录。标记解除的绑定需要点击底部“保存更改”才会生效。
                    </CardDescription>
                  </CardHeader>
                  <CardBody>
                    {identitiesLoading ? (
                      <div className="flex flex-col gap-3" aria-busy>
                        {PROVIDERS.map((provider) => (
                          <div
                            key={provider.name}
                            className="flex min-w-0 flex-col gap-3 rounded-control bg-tonal p-4"
                          >
                            <SkeletonText lines={1} width="40%" />
                            <SkeletonText lines={1} width="72%" />
                          </div>
                        ))}
                        <p className="sr-only">正在加载第三方绑定…</p>
                      </div>
                    ) : (
                      PROVIDERS.map((provider) => {
                        const identity = identityOf(provider.name)
                        const linked = Boolean(identity)
                        const pending = unlinking.includes(provider.name)
                        const staged = stagedUnlinks.includes(provider.name)
                        return (
                          // A card carries no rules: each provider is its own tonal
                          // group instead of a bordered sub-row.
                          <div
                            key={provider.name}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-tonal p-4"
                          >
                            <div className="flex min-w-0 flex-col gap-2">
                              <div className="flex items-center gap-2">
                                {provider.name === 'github' ? (
                                  <GithubIcon className="h-4 w-4 shrink-0 text-foreground" />
                                ) : (
                                  <GoogleIcon className="h-4 w-4 shrink-0" />
                                )}
                                <p className="text-sm font-medium text-foreground">{provider.label}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {linked ? (
                                  <Badge tone="success">已绑定</Badge>
                                ) : (
                                  <Badge tone="neutral">未绑定</Badge>
                                )}
                                {staged ? <Badge tone="warning">待解除绑定</Badge> : null}
                                {identity?.email ? (
                                  <span className="truncate text-xs text-muted-foreground">{identity.email}</span>
                                ) : null}
                                {identity?.linkedAt ? (
                                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                    绑定于 {formatDate(identity.linkedAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {pending ? (
                                <Button variant="secondary" size="sm" loading>
                                  解除中
                                </Button>
                              ) : linked ? (
                                staged ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<X aria-hidden="true" />}
                                    onClick={() => toggleStaged(provider.name)}
                                  >
                                    取消解除
                                  </Button>
                                ) : (
                                  <Button
                                    variant="danger-ghost"
                                    size="sm"
                                    icon={<Unlink aria-hidden="true" />}
                                    onClick={() => toggleStaged(provider.name)}
                                  >
                                    解除绑定
                                  </Button>
                                )
                              ) : (
                                /* 绑定账号 leaves this app for the provider, so it is a
                                   link wearing button styling, never a button. */
                                <a
                                  href={API_ENDPOINTS.account.oauthLinkStart(provider.name)}
                                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                                >
                                  <Link2 aria-hidden="true" />
                                  绑定账号
                                </a>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </CardBody>
                </Card>
              )}
            </section>
          </div>
        </div>

        {/* 设置页 bottom save bar: sticky, ghost 取消 + primary 保存, and only present
            while something is actually waiting to be written. */}
        {hasStagedChanges ? (
          <Card density="compact" className="sticky bottom-0 z-sticky shadow-floating">
            <CardFooter>
              <p className="text-sm text-muted-foreground">
                已标记 {stagedUnlinks.length} 个待解除的绑定，保存后生效。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={() => setStagedUnlinks([])}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  loading={unlinking.length > 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  保存更改
                </Button>
              </div>
            </CardFooter>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        size="narrow"
        title={`确定要解除 ${stagedUnlinks.length} 个第三方账号的绑定吗？`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void saveUnlinks()}>
              解除绑定
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          解除后你将无法再使用
          {' '}
          {stagedUnlinks
            .map((provider) => PROVIDERS.find((item) => item.name === provider)?.label ?? provider)
            .join('、')}
          {' '}
          登录 MuseCanvas，需要重新前往第三方授权才能恢复。此操作无法撤销。
        </p>
      </Dialog>
    </div>
  )
}
