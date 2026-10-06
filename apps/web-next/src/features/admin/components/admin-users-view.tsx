'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { AdminUser, Invitation, PaginatedResponse, UserRole } from '@/shared/types'
import { invitationStatus, requireAdminData } from '../lib/admin-query'
import { AdminQueryFeedback } from './admin-query-feedback'
import { AdminMobileRecords, AdminRecordDetailDialog, AdminRecordFields } from './admin-record-detail-dialog'
import { AdminCursorControls, useAdminCursor } from './admin-cursor-controls'
import { AdminFilterPanel } from './admin-filter-panel'
import { searchAdminInvitations } from '../lib/admin-list-state'
import { AdminCopyValue } from './admin-copy-value'
import { formatLocalizedDate } from '@/shared/lib/format'
import { ArrowClockwiseIcon as RefreshCw, UserPlusIcon as UserPlus } from '@phosphor-icons/react'
import {
  Alert,
  Badge,
  Card,
  useToast,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Select,
  PageHeader,
  SkeletonText,
  SkeletonTile,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeletonRow,
  TableStateRow,
  Tabs,
} from '@/shared/components/ui'
import type { BadgeTone, TabItem } from '@/shared/components/ui'

const ROLE_META: Record<UserRole, { label: string; tone: BadgeTone }> = {
  admin: { label: '管理员', tone: 'accent' },
  user: { label: '普通用户', tone: 'neutral' },
}

type AdminUsersTab = 'users' | 'invitations'

export function AdminUsersView() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [createdInvitation, setCreatedInvitation] = useState<Invitation | null | undefined>(undefined)
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null)
  const [detailInvitation, setDetailInvitation] = useState<Invitation | null>(null)
  const [activeTab, setActiveTab] = useState<AdminUsersTab>('users')
  const [emailDraft, setEmailDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState('all')
  const [userFilters, setUserFilters] = useState({ email: '', status: 'all' })
  const [invitationSearch, setInvitationSearch] = useState('')
  const userCursor = useAdminCursor()
  const userParams = { email: userFilters.email || undefined, status: userFilters.status === 'all' ? undefined : userFilters.status, limit: 50, cursor: userCursor.cursor }

  function applyUserFilters(email: string, status: string) {
    setUserFilters({ email: email.trim(), status })
    userCursor.reset()
  }


  const [actionError, setActionError] = useState<string>('')

  // Create invitation modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false)

  const {
    data: usersPage,
    isLoading: usersLoading,
    isError: usersError,
    error: usersQueryError,
    isFetching: usersFetching,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin', 'users', userParams],
    queryFn: async () => {
      const res = await api<PaginatedResponse<AdminUser>>(API_ENDPOINTS.admin.users, { params: userParams })
      return requireAdminData(res, '加载用户列表失败')
    },
  })

  const {
    data: invitationsData,
    isLoading: invitesLoading,
    isError: invitesError,
    error: invitesQueryError,
    isFetching: invitesFetching,
    refetch: refetchInvites,
  } = useQuery({
    queryKey: ['admin', 'invitations'],
    queryFn: async () => {
      const res = await api<{ items: Invitation[] }>(API_ENDPOINTS.admin.invitations)
      // Rows carry the admin-decryptable plaintext code (undefined for pre-encryption legacy rows).
      return requireAdminData(res, '加载邀请码列表失败').items
    },
  })

  // Create invitation mutation
  const createInviteMutation = useMutation({
    mutationFn: async () => {
      const res = await api<Invitation>(API_ENDPOINTS.admin.invitations, {
        method: 'POST',
        body: {},
      })
      if (!res.success) {
        throw new Error(res.error?.message || '服务端拒绝了创建请求')
      }
      return res.data
    },
    onSuccess: (invitation) => {
      setCreatedInvitation(invitation ?? null)
      toast.push({ variant: 'success', title: invitation?.code ? '邀请码已创建' : '创建请求已完成' })
      queryClient.invalidateQueries({ queryKey: ['admin', 'invitations'] })
    },
    onError: (err: unknown) => {
      const reason = err instanceof Error && err.message ? err.message : '网络请求未完成'
      setActionError(`${reason}。请稍后再次创建。`)
    },
  })

  const users = usersPage?.items ?? []
  const invitations = searchAdminInvitations(invitationsData ?? [], invitationSearch)

  const refreshing = activeTab === 'users' ? usersFetching : invitesFetching
  function handleRefresh() {
    if (activeTab === 'users') refetchUsers()
    else refetchInvites()
  }

  function openInviteDialog() {
    setActionError('')
    if (!createInviteMutation.isPending) createInviteMutation.reset()
    setInviteModalOpen(true)
  }

  const tabs: TabItem[] = [
    {
      id: 'users',
      label: `注册用户 (${usersPage?.total ?? '—'})`,
      content: (
        <div className="flex min-w-0 flex-col gap-4">
        <AdminFilterPanel activeCount={Number(!!userFilters.email) + Number(userFilters.status !== 'all')} summary={[userFilters.email && `邮箱包含 ${userFilters.email}`, userFilters.status !== 'all' && (userFilters.status === 'active' ? '正常' : '已停用')].filter(Boolean).join(' · ')}>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); applyUserFilters(emailDraft, statusDraft) }}>
            <FormField label="邮箱包含" className="w-full sm:w-64"><Input value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} placeholder="搜索所有注册用户" /></FormField>
            <FormField label="用户状态" className="w-full sm:w-48"><Select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
              <option value="all">所有状态</option><option value="active">正常</option><option value="disabled">已停用</option>
            </Select></FormField>
            <Button type="submit">应用筛选</Button>
            <Button variant="ghost" onClick={() => { setEmailDraft(''); setStatusDraft('all'); applyUserFilters('', 'all') }}>清除筛选</Button>
          </form>
        </AdminFilterPanel>
        <AdminMobileRecords records={users} loading={usersLoading}
          error={usersError && !usersPage ? usersQueryError?.message || '加载用户失败' : null}
          onRetry={() => { void refetchUsers() }} empty={userFilters.email || userFilters.status !== 'all' ? '没有匹配的注册用户，请调整或清除筛选条件。' : '用户通过登录或邀请码注册后，会显示在这里。'}
          title={(user) => user.email}
          status={(user) => <Badge tone={(ROLE_META[user.role] ?? ROLE_META.user).tone}>{(ROLE_META[user.role] ?? ROLE_META.user).label}</Badge>}
          summary={(user) => <>{user.status === 'disabled' ? '已停用' : '正常'} · {formatLocalizedDate(user.createdAt)}</>}
          onDetails={setDetailUser}
        />
        <DataTable cardClassName="hidden md:block" caption="注册用户列表" columns={4}>
          <TableHead>
            <TableHeadCell>邮箱</TableHeadCell>
            <TableHeadCell>角色</TableHeadCell>
            <TableHeadCell>状态</TableHeadCell>
            <TableHeadCell align="right">注册时间</TableHeadCell>
          </TableHead>
          <TableBody busy={usersLoading}>
            {usersLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <TableSkeletonRow
                  key={index}
                  cells={[
                    <SkeletonText key="email" width="14rem" />,
                    <SkeletonTile key="role" className="aspect-auto h-6 w-16 rounded-pill" />,
                    <SkeletonText key="status" width="4rem" />,
                    { align: 'right', content: <SkeletonText width="7rem" /> },
                  ]}
                />
              ))
            ) : usersError && !usersPage ? (
              <TableStateRow>
                <EmptyState
                  variant="error"
                  objectName="用户列表"
                  title="无法加载用户列表"
                  description="请求用户数据时出现问题，可能是服务暂时不可用。请稍后重试，或检查后端服务状态。"
                  actionLabel="刷新重试"
                  onAction={() => refetchUsers()}
                />
              </TableStateRow>
            ) : users.length > 0 ? (
              users.map((u) => {
                const role = ROLE_META[u.role] ?? ROLE_META.user
                return (
                  <TableRow key={u.id}>
                    <TableCell tone="strong">{u.email}</TableCell>
                    <TableCell>
                      <Badge tone={role.tone}>{role.label}</Badge>
                    </TableCell>
                    <TableCell><Badge tone={u.status === 'disabled' ? 'neutral' : 'success'}>{u.status === 'disabled' ? '已停用' : '正常'}</Badge></TableCell>
                    <TableCell align="right" mono tabular tone="muted">
                      {formatLocalizedDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableStateRow>
                <EmptyState
                  variant="first-use"
                  objectName="注册用户"
                  density="compact"
                  title={userFilters.email || userFilters.status !== 'all' ? '没有匹配的注册用户' : '还没有注册用户'}
                  description={userFilters.email || userFilters.status !== 'all' ? '请调整或清除筛选条件。' : '用户通过登录或邀请码注册后，会显示在这里。'}
                />
              </TableStateRow>
            )}
          </TableBody>
        </DataTable>
        <AdminCursorControls batch={userCursor.batch} count={users.length} total={usersPage?.total} hasMore={!usersQueryError && usersPage?.hasMore} nextCursor={usersPage?.nextCursor}
          busy={usersFetching} onPrevious={() => { if (!usersFetching) userCursor.previous() }} onNext={() => { if (!usersFetching && !usersQueryError) userCursor.next(usersPage?.nextCursor) }} />

        </div>
      ),
    },
    {
      id: 'invitations',
      label: `邀请码（本窗口 ${invitationsData?.length ?? '—'} 条）`,
      content: (
        <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">仅展示最近最多 100 条邀请码；以下搜索只在此窗口内匹配，不是全量搜索。</p>
        <AdminFilterPanel activeCount={Number(!!invitationSearch.trim())} summary={`当前窗口搜索 ${invitationSearch.trim()}`}>
          <FormField label="搜索当前邀请码窗口" hint="按邀请码或记录 ID 搜索最近最多 100 条。">
            <Input value={invitationSearch} onChange={(event) => setInvitationSearch(event.target.value)} placeholder="当前窗口内搜索" />
          </FormField>
        </AdminFilterPanel>
        <AdminMobileRecords records={invitations} loading={invitesLoading}
          error={invitesError && invitationsData === undefined ? invitesQueryError?.message || '加载邀请码失败' : null}
          onRetry={() => { void refetchInvites() }} empty={<>{invitationSearch.trim() ? '当前窗口内没有匹配邀请码，请调整搜索词。' : '创建邀请码后，把它发给需要注册的用户即可。'}<Button variant="secondary" onClick={openInviteDialog}>创建邀请码</Button></>}
          title={(invitation) => <span className="font-mono">{invitation.code || '明文不可用'}</span>}
          status={(invitation) => <Badge tone={invitationStatus(invitation).tone}>{invitationStatus(invitation).label}</Badge>}
          summary={(invitation) => formatLocalizedDate(invitation.createdAt)}
          onDetails={setDetailInvitation}
        />
        <DataTable cardClassName="hidden md:block" caption="邀请码列表" columns={3}>
          <TableHead>
            <TableHeadCell>邀请码标识</TableHeadCell>
            <TableHeadCell>状态</TableHeadCell>
            <TableHeadCell align="right">创建时间</TableHeadCell>
          </TableHead>
          <TableBody busy={invitesLoading}>
            {invitesLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <TableSkeletonRow
                  key={index}
                  cells={[
                    <SkeletonText key="code" width="12rem" />,
                    <SkeletonTile key="status" className="aspect-auto h-6 w-16 rounded-pill" />,
                    { align: 'right', content: <SkeletonText width="7rem" /> },
                  ]}
                />
              ))
            ) : invitesError && invitationsData === undefined ? (
              <TableStateRow>
                <EmptyState
                  variant="error"
                  objectName="邀请码列表"
                  title="无法加载邀请码列表"
                  description="请求邀请码数据时出现问题，可能是服务暂时不可用。请稍后重试，或检查后端服务状态。"
                  actionLabel="刷新重试"
                  onAction={() => refetchInvites()}
                />
              </TableStateRow>
            ) : invitations.length > 0 ? (
              invitations.map((inv) => {
                const status = invitationStatus(inv)
                return (
                  <TableRow key={inv.id}>
                    <TableCell mono tabular tone="foreground"><AdminCopyValue value={inv.code} label="邀请码" /></TableCell>
                    <TableCell>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TableCell>
                    <TableCell align="right" mono tabular tone="muted">
                      {formatLocalizedDate(inv.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableStateRow>
                <EmptyState
                  variant="first-use"
                  objectName="邀请码"
                  density="compact"
                  title={invitationSearch.trim() ? '当前窗口内没有匹配邀请码' : '还没有邀请码'}
                  description={invitationSearch.trim() ? '请调整搜索词；只搜索最近最多 100 条记录。' : '创建邀请码后，把它发给需要注册的用户即可。'}
                  onAction={openInviteDialog}
                />
              </TableStateRow>
            )}
          </TableBody>
        </DataTable>
        </div>
      ),
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        className="min-w-0 [overflow-wrap:anywhere]"
        actionsClassName="max-w-full min-w-0 max-md:[&_button]:min-h-[var(--control-lg)] max-md:[&_a]:min-h-[var(--control-lg)]"
        title="用户与邀请管理"
        description="查看注册用户、角色与账号状态，创建和查看邀请码；本页不修改用户角色或账号状态。"
        actions={
          <>
            {activeTab === 'invitations' && (
              <Button onClick={openInviteDialog} icon={<UserPlus weight="bold" aria-hidden="true" />}>
                创建邀请码
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleRefresh}
              loading={refreshing}
              icon={<RefreshCw weight="bold" aria-hidden="true" />}
            >
              刷新
            </Button>
          </>
        }
      />

      {activeTab === 'users' && usersPage && (
        <AdminQueryFeedback error={usersQueryError} hasData label="用户列表" onRetry={() => refetchUsers()} />
      )}
      {activeTab === 'invitations' && invitationsData !== undefined && (
        <AdminQueryFeedback error={invitesQueryError} hasData label="邀请码列表" onRetry={() => refetchInvites()} />
      )}

      {activeTab === 'invitations' && createdInvitation !== undefined && <Card className="min-w-0 gap-3">
        <h2 className="text-module">最近一次创建结果</h2>
        <p className="text-sm text-muted-foreground">结果会保留到下一次成功创建。请仅将邀请码分享给需要注册的用户。</p>
        <AdminCopyValue value={createdInvitation?.code} label="新邀请码" unavailable="创建请求已完成，但响应没有邀请码明文。请刷新列表核对；记录 ID 不是邀请码，不能用于注册。" />
      </Card>}

      <Tabs
        tabs={tabs}
        value={activeTab}
        onValueChange={(id) => setActiveTab(id as AdminUsersTab)}
        aria-label="用户与邀请"
      />

      <AdminRecordDetailDialog open={detailUser !== null} onClose={() => setDetailUser(null)} title="用户详情">
        {detailUser && <AdminRecordFields fields={[
          { label: '邮箱', value: detailUser.email },
          { label: '用户 ID', value: <span className="font-mono">{detailUser.id}</span> },
          { label: '角色', value: (ROLE_META[detailUser.role] ?? ROLE_META.user).label },
          { label: '状态', value: detailUser.status === 'disabled' ? '已停用' : '正常' },
          { label: '注册时间', value: formatLocalizedDate(detailUser.createdAt) },
        ]} />}
      </AdminRecordDetailDialog>
      <AdminRecordDetailDialog open={detailInvitation !== null} onClose={() => setDetailInvitation(null)} title="邀请码详情">
        {detailInvitation && <AdminRecordFields fields={[
          { label: '邀请码', value: <AdminCopyValue value={detailInvitation.code} label="邀请码" /> },
          { label: '记录 ID（不是邀请码）', value: <span className="font-mono">{detailInvitation.id}</span> },
          { label: '状态', value: invitationStatus(detailInvitation).label },
          { label: '创建时间', value: formatLocalizedDate(detailInvitation.createdAt) },
        ]} />}
      </AdminRecordDetailDialog>

      {/* Create Invite Modal */}
      <Dialog open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="创建邀请码" panelClassName="max-h-[90dvh] max-md:[&_button]:min-h-[var(--control-lg)] max-md:[&_button]:min-w-[var(--control-lg)]">
        {createInviteMutation.isSuccess ? <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm">创建请求已完成，下方仅展示接口实际返回的邀请码明文。</p>
          <AdminCopyValue value={createdInvitation?.code} label="新邀请码" unavailable="响应未返回邀请码明文，请刷新列表核对。不要使用记录 ID 代替邀请码。" />
          <Button variant="secondary" onClick={() => setInviteModalOpen(false)}>完成</Button>
        </div> : <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!createInviteMutation.isPending) createInviteMutation.mutate()
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

          <p className="text-sm text-muted-foreground">邀请码不限定邮箱。创建后可分享给需要注册的用户。</p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviteModalOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              loading={createInviteMutation.isPending}
              icon={<UserPlus weight="bold" aria-hidden="true" />}
            >
              创建邀请码
            </Button>
          </div>
        </form>}
      </Dialog>
    </div>
  )
}
