'use client'

import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import Link from 'next/link'
import { api } from '@/shared/services/api'
import type { AdminJob } from '@/shared/types'
import { formatLocalizedDateTime } from '@/shared/lib/format'
import { jobStatusMeta } from '@/shared/lib/job-status'
import { RefreshCw } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonText,
  StatCard,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeletonRow,
  TableStateRow,
  buttonVariants,
} from '@/shared/components/ui'

interface DashboardMetrics {
  totalUsers: number
  totalJobs: number
  successRate7d: number
  failedJobs7d: number
}

interface AdminDashboardViewProps {
  initialMetrics?: DashboardMetrics | null
  initialJobs?: AdminJob[]
}

const RECENT_JOB_LIMIT = 10

export function AdminDashboardView({ initialMetrics, initialJobs = [] }: AdminDashboardViewProps) {
  const {
    data: metrics,
    refetch: refetchMetrics,
    isFetching: isFetchingMetrics,
    isError: isMetricsError,
    error: metricsError,
  } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const res = await api<DashboardMetrics>(API_ENDPOINTS.admin.dashboard)
      return res.data || null
    },
    initialData: initialMetrics,
  })

  const {
    data: jobs,
    refetch: refetchJobs,
    isFetching: isFetchingJobs,
    isLoading: jobsLoading,
    isError: isJobsError,
  } = useQuery({
    queryKey: ['admin', 'jobs', { limit: RECENT_JOB_LIMIT }],
    queryFn: async () => {
      const res = await api<{ items: AdminJob[] }>(API_ENDPOINTS.admin.jobs, {
        params: { limit: RECENT_JOB_LIMIT },
      })
      return res.data?.items || []
    },
    initialData: initialJobs.length ? initialJobs : undefined,
  })

  const refreshing = isFetchingMetrics || isFetchingJobs
  // Skeleton only while there is nothing to show; a background refresh must not
  // wipe the numbers the reader is looking at.
  const metricsPending = metrics == null && isFetchingMetrics
  const jobsPending = jobsLoading

  function handleRefresh() {
    refetchMetrics()
    refetchJobs()
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="系统概览"
        description="查看系统汇总指标和最近任务状态。"
        actions={
          <Button
            variant="secondary"
            loading={refreshing}
            onClick={handleRefresh}
            icon={<RefreshCw aria-hidden="true" />}
          >
            刷新数据
          </Button>
        }
      />

      {isMetricsError ? (
        <Alert
          tone="danger"
          title="无法加载汇总指标"
          action={
            <Button variant="secondary" size="sm" onClick={() => refetchMetrics()}>
              刷新重试
            </Button>
          }
        >
          {metricsError?.message ? `${metricsError.message}。` : '服务未返回统计数据。'}
          请检查网络连接，或稍后重试。
        </Alert>
      ) : null}

      {/* KPI grid — 4 columns (desktop) → 2 (tablet, ≥640px) → 1 (phone), gap 24px */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="用户总数" value={metrics?.totalUsers ?? '—'} loading={metricsPending} />
        <StatCard label="任务总数" value={metrics?.totalJobs ?? '—'} loading={metricsPending} />
        <StatCard
          label="7 天成功率"
          value={metrics?.successRate7d != null ? `${metrics.successRate7d}%` : '—'}
          loading={metricsPending}
          className="text-success"
        />
        <StatCard
          label="7 天失败任务数"
          value={metrics?.failedJobs7d ?? '—'}
          loading={metricsPending}
          className="text-danger"
        />
      </div>

      {/* Recent jobs */}
      <section className="flex flex-col gap-4">
        <h2 className="text-subtitle font-normal text-foreground">最近任务</h2>
        <DataTable caption={`最近 ${RECENT_JOB_LIMIT} 条生成任务`} columns={4}>
          <TableHead>
            <TableHeadCell>任务 ID</TableHeadCell>
            <TableHeadCell>模型</TableHeadCell>
            <TableHeadCell>状态</TableHeadCell>
            <TableHeadCell align="right">创建时间</TableHeadCell>
          </TableHead>
          <TableBody busy={jobsPending}>
            {jobsPending ? (
              Array.from({ length: 5 }, (_, index) => (
                <TableSkeletonRow
                  key={index}
                  cells={[
                    <SkeletonText key="id" width="7rem" />,
                    <SkeletonText key="model" width="9rem" />,
                    <SkeletonText key="status" width="5rem" />,
                    { align: 'right', content: <SkeletonText width="8rem" className="ml-auto" /> },
                  ]}
                />
              ))
            ) : isJobsError ? (
              <TableStateRow>
                <EmptyState
                  variant="error"
                  objectName="最近任务"
                  density="compact"
                  actionLabel="刷新重试"
                  onAction={() => refetchJobs()}
                />
              </TableStateRow>
            ) : jobs && jobs.length > 0 ? (
              jobs.map((job) => {
                const status = jobStatusMeta(job.status)
                return (
                  <TableRow key={job.id}>
                    <TableCell mono tone="muted">{job.id.slice(0, 8)}…</TableCell>
                    <TableCell tone="strong">
                      {job.modelName || '未知模型'}
                    </TableCell>
                    <TableCell>
                      <Badge className={status.badge}>{status.label}</Badge>
                    </TableCell>
                    <TableCell align="right" mono tabular tone="muted">
                      {formatLocalizedDateTime(job.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableStateRow>
                <EmptyState
                  variant="first-use"
                  objectName="生成任务"
                  density="compact"
                  title="还没有生成任务"
                  description="用户开始创作后，最近的任务会出现在这里。"
                  action={
                    <Link href="/admin/jobs" className={buttonVariants({ variant: 'secondary' })}>
                      查看全部任务
                    </Link>
                  }
                />
              </TableStateRow>
            )}
          </TableBody>
        </DataTable>
      </section>
    </div>
  )
}
