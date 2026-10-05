'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { AdminJob, JobStatus } from '@/shared/types'
import { formatLocalizedDateTime } from '@/shared/lib/format'
import { jobStatusMeta } from '@/shared/lib/job-status'
import { ArrowUpDown, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  PageHeader,
  Select,
  SkeletonText,
  TableBody,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeletonRow,
  TableStateRow,
  TableCell,
} from '@/shared/components/ui'

/** The monitor keeps its fixed window: newest N jobs, no pagination. */
const JOB_PAGE_LIMIT = 50

/** Values accepted by `GET /api/admin/jobs?status=`; labels ride `jobStatusMeta`. */
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '所有状态' },
  ...(
    ['queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled'] as JobStatus[]
  ).map((status) => ({ value: status, label: jobStatusMeta(status).label })),
]

export function AdminJobsView() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeSort, setTimeSort] = useState<'desc' | 'asc'>('desc')

  const {
    data: jobs = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin', 'jobs', { status: statusFilter }],
    queryFn: async () => {
      const res = await api<{ items: AdminJob[] }>(API_ENDPOINTS.admin.jobs, {
        params: {
          ...(statusFilter === 'all' ? {} : { status: statusFilter }),
          limit: JOB_PAGE_LIMIT,
        },
      })
      return res.data?.items || []
    },
  })

  // Client-side sort over the fetched page: the monitor's natural order is
  // newest-first, flipping stays cheap and keeps the filter server-driven.
  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) => {
        const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        return timeSort === 'desc' ? -delta : delta
      }),
    [jobs, timeSort],
  )

  const filterActive = statusFilter !== 'all'
  const clearFilter = () => setStatusFilter('all')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="任务监控"
        description="全系统生成任务队列状态、错误日志与进度监控。"
        actions={
          <Button
            variant="secondary"
            onClick={() => refetch()}
            loading={isFetching}
            icon={<RefreshCw aria-hidden="true" />}
          >
            刷新
          </Button>
        }
      />

      {/* Filter bar above the table (components.md 数据表格页) */}
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="任务状态" hint="按状态筛选最近的生成任务。" className="w-full sm:w-64">
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <DataTable caption="任务监控列表" columns={6}>
        <TableHead>
          <TableHeadCell>任务 ID</TableHeadCell>
          <TableHeadCell>用户</TableHeadCell>
          <TableHeadCell>模型</TableHeadCell>
          <TableHeadCell>状态</TableHeadCell>
          <TableHeadCell>错误信息</TableHeadCell>
          <TableHeadCell
            align="right"
            sort={timeSort === 'desc' ? 'descending' : 'ascending'}
          >
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 text-inherit"
              onClick={() => setTimeSort((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              icon={<ArrowUpDown aria-hidden="true" />}
            >
              提交时间
            </Button>
          </TableHeadCell>
        </TableHead>
        <TableBody busy={isLoading}>
          {isLoading ? (
            Array.from({ length: 6 }, (_, index) => (
              <TableSkeletonRow
                key={index}
                cells={[
                  <SkeletonText key="id" width="7rem" />,
                  <SkeletonText key="user" width="9rem" />,
                  <SkeletonText key="model" width="8rem" />,
                  <SkeletonText key="status" width="5rem" />,
                  <SkeletonText key="error" width="10rem" />,
                  { align: 'right', content: <SkeletonText width="8rem" className="ml-auto" /> },
                ]}
              />
            ))
          ) : isError ? (
            <TableStateRow>
              <EmptyState
                variant="error"
                objectName="任务列表"
                title="无法加载任务列表"
                description="请求任务数据时出现问题，可能是服务暂时不可用。请稍后重试，或检查后端服务状态。"
                actionLabel="刷新重试"
                onAction={() => refetch()}
              />
            </TableStateRow>
          ) : sortedJobs.length > 0 ? (
            sortedJobs.map((job) => {
              const status = jobStatusMeta(job.status)
              return (
                <TableRow key={job.id}>
                  <TableCell mono tone="muted">{job.id.slice(0, 8)}…</TableCell>
                  <TableCell tone="foreground">{job.userEmail || job.userId?.slice(0, 8) || '—'}</TableCell>
                  <TableCell tone="strong">{job.modelName || '未知模型'}</TableCell>
                  <TableCell>
                    {/* Colour + the state in words: never colour alone. */}
                    <Badge className={status.badge}>{status.label}</Badge>
                  </TableCell>
                  <TableCell tone="muted">
                    {job.errorMessage ? (
                      <span className="block max-w-60 truncate text-danger" title={job.errorMessage}>
                        {job.errorMessage}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell align="right" mono tabular tone="muted">
                    {formatLocalizedDateTime(job.createdAt)}
                  </TableCell>
                </TableRow>
              )
            })
          ) : filterActive ? (
            <TableStateRow>
              <EmptyState
                variant="no-results"
                objectName="任务"
                density="compact"
                onAction={clearFilter}
              />
            </TableStateRow>
          ) : (
            <TableStateRow>
              <EmptyState
                variant="first-use"
                objectName="生成任务"
                density="compact"
                title="还没有生成任务"
                description="用户发起生成后，任务会按时间倒序出现在这里。"
              />
            </TableStateRow>
          )}
        </TableBody>
      </DataTable>

      <p className="text-sm text-muted-foreground">仅显示最近 {JOB_PAGE_LIMIT} 条任务。</p>
    </div>
  )
}
