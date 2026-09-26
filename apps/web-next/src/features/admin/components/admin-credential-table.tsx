'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { ProviderCredential, ProviderTestStatus } from '@/shared/types'
import { credentialPluginKey } from '../lib/provider-templates'
import { Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  SkeletonRow,
  Switch,
} from '@/shared/components/ui'

interface AdminCredentialTableProps {
  credentials: ProviderCredential[]
  isLoading: boolean
  /**
   * `media` rows are plugin-bound credentials and show their plugin identity;
   * `language` rows are plugin-less (adapter + API key) credentials and show
   * which models consume them.
   */
  variant: 'media' | 'language'
  /** Model display names keyed by the credential id they are bound to. */
  linkedModels?: Record<string, string[]>
  /** First-use copy: what is missing and how to create it. */
  emptyText: string
  /** List request failed — renders the `error` empty state instead of first-use. */
  error?: ReactNode
  /** Retry handler for the `error` state; wired to the caller's existing `refetch`. */
  onRetry?: () => void
}

const TEST_STATUS_LABEL: Record<ProviderTestStatus, string> = {
  success: '测试通过',
  failed: '测试失败',
  not_tested: '未测试',
}

const COLUMN_COUNT = 6

// Shared credential console merged out of the former 供应商凭据 page: list,
// enable/disable, connectivity test and delete. Creation lives in each page's
// dialog because the payload shape differs per scope.
export function AdminCredentialTable({
  credentials,
  isLoading,
  variant,
  linkedModels = {},
  emptyText,
  error,
  onRetry,
}: AdminCredentialTableProps) {
  const queryClient = useQueryClient()
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null)
  const [actionError, setActionError] = useState('')

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api(API_ENDPOINTS.admin.providerCredential(id), { method: 'DELETE' })
      if (!res.success) throw new Error(res.error?.message || '删除凭据失败')
      return res.data
    },
    onSuccess: () => {
      setActionError('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'provider-credentials'] })
    },
    onError: (err: Error) => {
      setActionError(err.message || '删除凭据失败')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await api(API_ENDPOINTS.admin.providerCredential(id), { method: 'PATCH', body: { enabled } })
      if (!res.success) throw new Error(res.error?.message || '更新凭据状态失败')
      return res.data
    },
    onSuccess: () => {
      setActionError('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'provider-credentials'] })
    },
    onError: (err: Error) => {
      setActionError(err.message || '更新凭据状态失败')
    },
  })

  async function handleTest(id: string) {
    setTestingId(id)
    setTestResult(null)
    try {
      const res = await api<{ tested: boolean; status: string }>(API_ENDPOINTS.admin.providerCredentialTest(id), {
        method: 'POST',
      })
      if (res.success && res.data?.tested && res.data.status === 'success') {
        setTestResult({ id, success: true, msg: '连通性测试通过' })
      } else {
        setTestResult({ id, success: false, msg: res.error?.message || '连通性测试未通过' })
      }
    } catch {
      setTestResult({ id, success: false, msg: '测试请求失败' })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {actionError && (
        <Alert tone="danger" role="alert" title="凭据操作未完成">
          {actionError}。请修正后重试；若多次失败，请确认服务端凭据配置后刷新列表。
        </Alert>
      )}

      <Card density="compact" className="gap-0 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {variant === 'media' ? '媒体供应商凭据列表' : '语言模型供应商凭据列表'}
            </caption>
            <thead className="bg-tonal text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 text-sm font-medium">
                  凭据名称
                </th>
                <th scope="col" className="px-4 py-3 text-sm font-medium">
                  {variant === 'media' ? '绑定插件' : '适配协议'}
                </th>
                <th scope="col" className="px-4 py-3 text-sm font-medium">
                  {variant === 'media' ? '供应商 / 适配器' : '关联模型'}
                </th>
                <th scope="col" className="px-4 py-3 text-sm font-medium">
                  API Key 状态
                </th>
                <th scope="col" className="px-4 py-3 text-sm font-medium">
                  状态
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border" aria-busy={isLoading || undefined}>
              {isLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <tr key={index}>
                    <td colSpan={COLUMN_COUNT} className="px-4 py-2">
                      <SkeletonRow cells={COLUMN_COUNT} className="py-1.5" />
                    </td>
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={COLUMN_COUNT}>
                    <EmptyState
                      variant="error"
                      density="compact"
                      objectName={variant === 'media' ? '媒体凭据' : '语言模型凭据'}
                      title="无法加载凭据列表"
                      description={
                        typeof error === 'string'
                          ? `${error}。请检查后端服务状态后重试。`
                          : '加载凭据数据时出现问题，可能是服务暂时不可用。请稍后重试。'
                      }
                      action={onRetry ? <Button variant="secondary" onClick={onRetry}>刷新重试</Button> : undefined}
                    />
                  </td>
                </tr>
              ) : credentials.length > 0 ? (
                credentials.map((c) => {
                  const pluginKey = credentialPluginKey(c)
                  const linked = linkedModels[c.id] || []
                  const hasSecret = Boolean(c.hasApiKey || c.hasCredential)
                  return (
                    <tr
                      key={c.id}
                      className="transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div>{c.displayName}</div>
                        {c.baseUrl && (
                          <div className="break-all font-mono text-xs font-normal text-muted-foreground">{c.baseUrl}</div>
                        )}
                        <div className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                          最近测试：{TEST_STATUS_LABEL[c.lastTestStatus] || c.lastTestStatus}
                          {c.lastTestErrorCode ? `（${c.lastTestErrorCode}）` : ''}
                        </div>
                      </td>
                      {variant === 'media' ? (
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{pluginKey || '-'}</td>
                      ) : (
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.adapter || '-'}</td>
                      )}
                      {variant === 'media' ? (
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          <div>{c.providerId || '-'}</div>
                          <div>{c.adapter || '-'}</div>
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-muted-foreground">
                          {linked.length > 0 ? (
                            <span className="text-foreground">{linked.join('、')}</span>
                          ) : (
                            <span>未关联模型</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Badge tone={hasSecret ? 'success' : 'danger'}>{hasSecret ? '已配置密钥' : '未设置密钥'}</Badge>
                      </td>
                      {/* Immediate setting: `Switch` reverts itself when the PATCH rejects,
                          and the failure message above surfaces the reason. */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={c.enabled}
                            onCheckedChange={(enabled) => toggleMutation.mutateAsync({ id: c.id, enabled })}
                            aria-label={`凭据 ${c.displayName} 启用状态`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {c.enabled ? '已启用' : '已停用'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {testResult && testResult.id === c.id && (
                            <span
                              className={`text-xs ${testResult.success ? 'text-success' : 'text-danger'}`}
                              role="status"
                            >
                              {testResult.msg}
                            </span>
                          )}
                          {/* `loading` keeps the label and the measured idle width, so the
                              row never reflows mid-test. */}
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={testingId === c.id}
                            onClick={() => handleTest(c.id)}
                            aria-label={`连通测试凭据 ${c.displayName}`}
                          >
                            连通测试
                          </Button>
                          <IconButton
                            variant="danger-ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`确认删除凭据 ${c.displayName}？`)) {
                                deleteMutation.mutate(c.id)
                              }
                            }}
                            aria-label={`删除凭据 ${c.displayName}`}
                            icon={<Trash2 aria-hidden="true" />}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={COLUMN_COUNT}>
                    <EmptyState
                      variant="first-use"
                      density="compact"
                      objectName={variant === 'media' ? '媒体凭据' : '语言模型凭据'}
                      title={variant === 'media' ? '还没有媒体凭据' : '还没有语言模型凭据'}
                      description={emptyText}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
