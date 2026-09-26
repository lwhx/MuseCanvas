'use client'

import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import Link from 'next/link'
import { api } from '@/shared/services/api'
import type { AdminJob } from '@/shared/types'
import { jobStatusMeta } from '@/shared/lib/job-status'
import { RefreshCw } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRow,
  StatCard,
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
  const metricsPending = !metrics && isFetchingMetrics
  const jobsPending = !jobs && isFetchingJobs

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
        <Card className="gap-0 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">最近 {RECENT_JOB_LIMIT} 条生成任务</caption>
              <thead className="bg-tonal text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    任务 ID
                  </th>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    模型
                  </th>
                  <th scope="col" className="px-4 py-3 text-sm font-medium">
                    状态
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium">
                    创建时间
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border" aria-busy={jobsPending || undefined}>
                {jobsPending ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={index}>
                      <td colSpan={4} className="px-4 py-2">
                        <SkeletonRow cells={4} className="py-1.5" />
                      </td>
                    </tr>
                  ))
                ) : isJobsError ? (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        variant="error"
                        objectName="最近任务"
                        density="compact"
                        actionLabel="刷新重试"
                        onAction={() => refetchJobs()}
                      />
                    </td>
                  </tr>
                ) : jobs && jobs.length > 0 ? (
                  jobs.map((job) => {
                    const status = jobStatusMeta(job.status)
                    return (
                      <tr
                        key={job.id}
                        className="transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface-hover"
                      >
                        <td className="px-4 py-3 font-mono text-muted-foreground">{job.id.slice(0, 8)}…</td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {job.modelName || '未知模型'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={status.badge}>{status.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={4}>
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
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  )
}
