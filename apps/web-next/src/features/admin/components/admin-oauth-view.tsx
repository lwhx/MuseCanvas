'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS, type OAuthProviderName } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { AdminOAuthProvider } from '@/shared/types'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRow,
  SkeletonText,
  Switch,
} from '@/shared/components/ui'
import { RefreshCw } from 'lucide-react'

const oauthQueryKey = ['admin', 'oauth-providers'] as const

interface StatusMessage {
  tone: 'success' | 'danger'
  msg: string
}

const sourceLabel: Record<AdminOAuthProvider['source'], string> = {
  database: '数据库配置',
  environment: '环境变量配置',
  none: '未配置凭据',
}

/** Provider ids are lowercase codes; the display name comes from the payload's label. */
function providerName(provider: AdminOAuthProvider): string {
  return provider.label || provider.provider
}

export function AdminOAuthView() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StatusMessage | null>(null)

  const {
    data: providers = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: oauthQueryKey,
    queryFn: async () => {
      const res = await api<AdminOAuthProvider[]>(API_ENDPOINTS.admin.oauthProviders)
      if (!res.success) throw new Error(res.error?.message || '读取 OAuth 提供商失败')
      return res.data || []
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ provider, enabled }: { provider: string; enabled: boolean }) => {
      const res = await api(API_ENDPOINTS.admin.oauthProvider(provider as OAuthProviderName), {
        method: 'PATCH',
        body: { enabled },
      })
      if (!res.success) throw new Error(res.error?.message || '更新状态失败')
      return res.data
    },
    onSuccess: () => {
      setStatus({ tone: 'success', msg: 'OAuth 提供商状态已更新' })
      queryClient.invalidateQueries({ queryKey: oauthQueryKey })
    },
    onError: (err: Error) => {
      setStatus({ tone: 'danger', msg: `${err.message || '更新状态失败'}。开关已恢复原状态，设置未更改，请重试。` })
      queryClient.invalidateQueries({ queryKey: oauthQueryKey })
    },
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="OAuth 登录提供商"
        description="配置第三方账号认证源（GitHub、Google），支持一键登录与账号绑定。"
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
            icon={<RefreshCw aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />}
          >
            刷新
          </Button>
        }
      />

      {status ? (
        <Alert tone={status.tone} role={status.tone === 'danger' ? 'alert' : 'status'} onDismiss={() => setStatus(null)}>
          {status.msg}
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-4" role="status" aria-busy="true">
          <span className="sr-only">正在加载 OAuth 提供商</span>
          <Card aria-hidden="true" className="gap-3">
            <SkeletonText lines={1} width="160px" />
            <SkeletonRow cells={2} />
          </Card>
          <Card aria-hidden="true" className="gap-3">
            <SkeletonText lines={1} width="140px" />
            <SkeletonRow cells={2} />
          </Card>
        </div>
      ) : null}

      {isError ? (
        <EmptyState
          variant="error"
          title="无法加载 OAuth 提供商"
          description={
            error instanceof Error
              ? `${error.message}。请检查管理后台会话与网络后重试。`
              : '加载数据时出现问题，请稍后重试。'
          }
          onAction={() => void refetch()}
          actionLabel="刷新重试"
        />
      ) : null}

      {!isLoading && !isError ? (
        providers.length > 0 ? (
          <div className="flex flex-col gap-4">
            {providers.map((p) => {
              const name = providerName(p)
              return (
                <Card key={p.provider} className="flex-row flex-wrap items-center justify-between gap-x-6 gap-y-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-module text-foreground">{name}</h2>
                      <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? '已启用' : '已停用'}</Badge>
                      <Badge tone={p.source === 'none' ? 'warning' : 'neutral'}>{sourceLabel[p.source]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Client ID：
                      <span className="font-mono text-foreground">
                        {p.clientId ? `${p.clientId.slice(0, 8)}…` : '未配置'}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      回调地址：<span className="font-mono text-foreground">{p.redirectUri || '未配置'}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground">启用登录</span>
                    <Switch
                      checked={p.enabled}
                      aria-label={`${name} 登录`}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(enabled) =>
                        toggleMutation.mutateAsync({ provider: p.provider, enabled })
                      }
                    />
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <EmptyState
              variant="first-use"
              objectName="OAuth 登录"
              title="欢迎使用 OAuth 登录"
              description="在这里你可以启用或停用 GitHub、Google 登录。提供商凭据由服务端环境变量或初始化流程写入，管理后台不负责创建提供商。"
              actionLabel="刷新提供商列表"
              onAction={() => void refetch()}
            >
              <p className="max-w-reading text-sm text-muted-foreground">
                如果列表持续为空，请先在部署配置中为实例填写对应提供商的 Client ID 与 Client Secret。
              </p>
            </EmptyState>
          </Card>
        )
      ) : null}
    </div>
  )
}
