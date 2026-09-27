'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS, type PromptTemplateSetDetailDto } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import { Dialog } from '@/shared/components/ui/dialog'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardTitle,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageHeader,
  SkeletonText,
  SkeletonTile,
  Textarea,
  buttonVariants,
} from '@/shared/components/ui'
import { Download, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react'

export function AdminPromptTemplatesView() {
  const queryClient = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [actionError, setActionError] = useState('')

  const {
    data: activeSet,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery<PromptTemplateSetDetailDto | null>({
    queryKey: ['admin', 'prompt-templates'],
    queryFn: async () => {
      const res = await api<PromptTemplateSetDetailDto | null>(API_ENDPOINTS.admin.promptTemplates)
      if (!res.success) throw new Error(res.error?.message || '加载提示词模板失败')
      return res.data ?? null
    },
  })

  const entries = activeSet?.entries ?? []

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeSet) throw new Error('当前没有激活的模板集，请先通过初始化向导导入模板集')
      if (!name.trim() || !instruction.trim()) throw new Error('请完整填写名称与提示词内容')
      const res = await api(API_ENDPOINTS.admin.promptTemplateSetEntries(activeSet.id), {
        method: 'POST',
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          instruction: instruction.trim(),
        },
      })
      if (!res.success) throw new Error(res.error?.message || '创建模板失败')
      return res.data
    },
    onSuccess: () => {
      setCreateModalOpen(false)
      setName('')
      setDescription('')
      setInstruction('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompt-templates'] })
    },
    onError: (err: any) => {
      setActionError(err.message || '创建模板失败')
    },
  })

  // Deleting an entry forks a new set version on the backend, so the whole
  // active-set query must be refetched rather than patched locally.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api(API_ENDPOINTS.admin.promptTemplateEntry(id), { method: 'DELETE' })
      if (!res.success) throw new Error(res.error?.message || '删除模板失败')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'prompt-templates'] })
    },
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="提示词模板"
        description={
          activeSet
            ? `当前激活模板集：${activeSet.name}（第 ${activeSet.version} 版，${activeSet.entryCount} 个条目），供创作台快捷调用。`
            : '管理系统预置与分类提示词模板，供用户在创作台快捷调用。'
        }
        actions={
          <>
            {activeSet ? (
              <a
                href={`${API_ENDPOINTS.admin.promptTemplatesExport}?setId=${encodeURIComponent(activeSet.id)}`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                <Download aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />
                导出模板集
              </a>
            ) : null}
            <Button
              onClick={() => {
                setActionError('')
                setCreateModalOpen(true)
              }}
              disabled={!activeSet}
              title={activeSet ? undefined : '请先导入并激活模板集'}
              icon={<Plus aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />}
            >
              创建模板
            </Button>
            <Button
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
              icon={<RefreshCw aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />}
            >
              刷新
            </Button>
          </>
        }
      />

      {isError ? (
        <Alert
          tone="danger"
          role="alert"
          title="无法加载提示词模板"
          action={
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
              刷新重试
            </Button>
          }
        >
          {error instanceof Error ? `${error.message}。请确认管理后台会话仍然有效。` : '加载数据时出现问题，请稍后重试。'}
        </Alert>
      ) : null}

      {!isLoading && !isError && !activeSet ? (
        <Alert tone="info" role="status" title="当前没有激活的模板集">
          <span className="flex items-start gap-2">
            <FileText aria-hidden="true" className="mt-0.5 h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0" />
            模板集通过初始化向导（/setup）导入，条目管理在激活集上进行；激活模板集后即可创建模板。
          </span>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
          <span className="sr-only">正在加载提示词模板</span>
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} aria-hidden="true" density="compact">
              <div className="flex items-start justify-between gap-3">
                <SkeletonTile className="aspect-auto h-6 w-24 rounded-pill" />
                <SkeletonTile className="aspect-auto h-[var(--control-sm)] w-[var(--control-sm)] rounded-control" />
              </div>
              <SkeletonText width={index % 2 === 0 ? '11rem' : '9rem'} />
              <SkeletonText lines={3} />
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && !isError && activeSet ? (
        entries.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entries.map((t) => (
              <Card key={t.id} density="compact">
                <CardBody className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <Badge tone="neutral">{t.description || '通用模板'}</Badge>
                    <IconButton
                      variant="danger-ghost"
                      size="sm"
                      aria-label={`删除提示词模板：${t.name}`}
                      loading={deleteMutation.isPending && deleteMutation.variables === t.id}
                      onClick={() => {
                        if (confirm(`确认删除模板 ${t.name}？`)) {
                          deleteMutation.mutate(t.id)
                        }
                      }}
                      icon={<Trash2 aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />}
                    />
                  </div>
                  <CardTitle level={3}>{t.name}</CardTitle>
                  <CardDescription className="line-clamp-3">{t.instruction}</CardDescription>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              variant="first-use"
              objectName="提示词模板"
              actionLabel="创建第一个模板"
              onAction={() => {
                setActionError('')
                setCreateModalOpen(true)
              }}
            />
          </Card>
        )
      ) : null}

      {/* Create Modal */}
      <Dialog
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="创建提示词模板"
        size="narrow"
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          {actionError ? (
            <Alert tone="danger" role="alert">
              {actionError}
            </Alert>
          ) : null}

          <FormField label="模板名称" required>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：赛博朋克都市风格"
            />
          </FormField>

          <FormField label="说明描述" hint="用于创作台的标签位置，留空时显示为通用模板。">
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：增强色彩对比与霓虹光效"
            />
          </FormField>

          <FormField
            label="模板指令内容（Instruction）"
            required
            hint="发送给模型的正文模板，支持 {{input_prompt}} 插值。"
          >
            <Textarea
              rows={4}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="输入详细的提示词引导模板…"
            />
          </FormField>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateModalOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim() || !instruction.trim()} loading={createMutation.isPending}>
              创建模板
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
