'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { AdminUser, Invitation, UserRole } from '@/shared/types'
import { RefreshCw, UserPlus } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SkeletonText,
  SkeletonTile,
  Tabs,
} from '@/shared/components/ui'
import type { BadgeTone, TabItem } from '@/shared/components/ui'

const ROLE_META: Record<UserRole, { label: string; tone: BadgeTone }> = {
  admin: { label: '管理员', tone: 'accent' },
  user: { label: '普通用户', tone: 'neutral' },
}

function invitationStatus(invitation: Invitation): { label: string; tone: BadgeTone } {
  if (invitation.used) return { label: '已使用', tone: 'danger' }
  if (invitation.revoked) return { label: '已撤销', tone: 'neutral' }
  return { label: '有效', tone: 'success' }
}

type AdminUsersTab = 'users' | 'invitations'

export function AdminUsersView() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<AdminUsersTab>('users')

  const [actionError, setActionError] = useState<string>('')

  // Create invitation modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')

  const {
    data: users = [],
    isLoading: usersLoading,
    isError: usersError,
    isFetching: usersFetching,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await api<{ items: AdminUser[] }>(API_ENDPOINTS.admin.users)
      return res.data?.items || []
    },
  })

  const {
    data: invitations = [],
    isLoading: invitesLoading,
    isError: invitesError,
    isFetching: invitesFetching,
    refetch: refetchInvites,
  } = useQuery({
    queryKey: ['admin', 'invitations'],
    queryFn: async () => {
      const res = await api<{ items: Invitation[] }>(API_ENDPOINTS.admin.invitations)
      // Rows carry the admin-decryptable plaintext code (undefined for pre-encryption legacy rows).
      return res.data?.items || []
    },
  })

  // Create invitation mutation
  const createInviteMutation = useMutation({
    mutationFn: async () => {
      const res = await api<Invitation>(API_ENDPOINTS.admin.invitations, {
        method: 'POST',
        body: { email: inviteEmail.trim() || undefined },
      })
      if (!res.success) {
        throw new Error(res.error?.message || '服务端拒绝了创建请求')
      }
      return res.data
    },
    onSuccess: () => {
      setInviteModalOpen(false)
      setInviteEmail('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'invitations'] })
    },
    onError: (err: unknown) => {
      const reason = err instanceof Error && err.message ? err.message : '网络请求未完成'
      setActionError(`${reason}。请检查限定邮箱格式后重试；若邮箱无误，请稍后再次创建。`)
    },
  })

  const refreshing = activeTab === 'users' ? usersFetching : invitesFetching
  function handleRefresh() {
    if (activeTab === 'users') refetchUsers()
    else refetchInvites()
  }

  function openInviteDialog() {
    setActionError('')
    createInviteMutation.reset()
    setInviteModalOpen(true)
  }

  const tabs: TabItem[] = [
    {
      id: 'users',
      label: `注册用户 (${users.length})`,
      content: (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">注册用户列表</caption>
              <thead className="bg-tonal text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    邮箱
                  </th>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    角色
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                    注册时间
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border" aria-busy={usersLoading || undefined}>
                {usersLoading ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3"><SkeletonText width="14rem" /></td>
                      <td className="px-4 py-3"><SkeletonTile className="aspect-auto h-6 w-16 rounded-pill" /></td>
                      <td className="px-4 py-3 text-right"><SkeletonText width="7rem" /></td>
                    </tr>
                  ))
                ) : usersError ? (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        variant="error"
                        objectName="用户列表"
                        title="无法加载用户列表"
                        description="请求用户数据时出现问题，可能是服务暂时不可用。请稍后重试，或检查后端服务状态。"
                        actionLabel="刷新重试"
                        onAction={() => refetchUsers()}
                      />
                    </td>
                  </tr>
                ) : users.length > 0 ? (
                  users.map((u) => {
                    const role = ROLE_META[u.role] ?? ROLE_META.user
                    return (
                      <tr
                        key={u.id}
                        className="transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface-hover"
                      >
                        <td className="px-4 py-3 font-medium text-foreground">{u.email}</td>
                        <td className="px-4 py-3">
                          <Badge tone={role.tone}>{role.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        variant="first-use"
                        objectName="注册用户"
                        density="compact"
                        title="还没有注册用户"
                        description="用户通过登录或邀请码注册后，会显示在这里。"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ),
    },
    {
      id: 'invitations',
      label: `邀请码 (${invitations.length})`,
      content: (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">邀请码列表</caption>
              <thead className="bg-tonal text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    邀请码标识
                  </th>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    状态
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                    创建时间
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border" aria-busy={invitesLoading || undefined}>
                {invitesLoading ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3"><SkeletonText width="12rem" /></td>
                      <td className="px-4 py-3"><SkeletonTile className="aspect-auto h-6 w-16 rounded-pill" /></td>
                      <td className="px-4 py-3 text-right"><SkeletonText width="7rem" /></td>
                    </tr>
                  ))
                ) : invitesError ? (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        variant="error"
                        objectName="邀请码列表"
                        title="无法加载邀请码列表"
                        description="请求邀请码数据时出现问题，可能是服务暂时不可用。请稍后重试，或检查后端服务状态。"
                        actionLabel="刷新重试"
                        onAction={() => refetchInvites()}
                      />
                    </td>
                  </tr>
                ) : invitations.length > 0 ? (
                  invitations.map((inv) => {
                    const status = invitationStatus(inv)
                    return (
                      <tr
                        key={inv.id}
                        className="transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface-hover"
                      >
                        <td className="px-4 py-3 font-mono tabular-nums text-foreground">{inv.code || inv.id}</td>
                        <td className="px-4 py-3">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {new Date(inv.createdAt).toLocaleDateString('zh-CN')}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <EmptyState
                        variant="first-use"
                        objectName="邀请码"
                        density="compact"
                        title="还没有邀请码"
                        description="创建邀请码后，把它发给需要注册的用户即可。"
                        onAction={openInviteDialog}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="用户与邀请管理"
        description="管理注册用户、角色权限与测试邀请码。"
        actions={
          <>
            {activeTab === 'invitations' && (
              <Button onClick={openInviteDialog} icon={<UserPlus aria-hidden="true" />}>
                创建邀请码
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleRefresh}
              loading={refreshing}
              icon={<RefreshCw aria-hidden="true" />}
            >
              刷新
            </Button>
          </>
        }
      />

      <Tabs
        tabs={tabs}
        value={activeTab}
        onValueChange={(id) => setActiveTab(id as AdminUsersTab)}
        aria-label="用户与邀请"
      />

      {/* Create Invite Modal */}
      <Dialog open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="创建邀请码">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            createInviteMutation.mutate()
          }}
        >
          {actionError ? (
            // The 4px bar is `Alert`'s `danger` tone — a soft red is never a border colour.
            <div id="invite-error">
              <Alert tone="danger" role="alert" title="无法创建邀请码">
                {actionError}
              </Alert>
            </div>
          ) : null}

          <FormField
            id="invite-email"
            label="限定邮箱"
            hint="可选。留空则任意邮箱均可使用该邀请码。"
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="user@example.com"
              invalid={Boolean(actionError)}
              aria-describedby={
                actionError ? 'invite-email-hint invite-error' : 'invite-email-hint'
              }
            />
          </FormField>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviteModalOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              loading={createInviteMutation.isPending}
              icon={<UserPlus aria-hidden="true" />}
            >
              创建邀请码
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
