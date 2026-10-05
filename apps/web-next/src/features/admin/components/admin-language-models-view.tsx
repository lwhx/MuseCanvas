'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { AdminModel, ModelPreset, ProviderCredential, ReasoningEffort } from '@/shared/types'
import { credentialsForPreset, isCustomCredential } from '../lib/provider-templates'
import { AdminCredentialTable } from './admin-credential-table'
import { AdminProviderCredentialDialog } from './admin-provider-credential-dialog'
import { AdminInstalledPlugins } from './admin-installed-plugins'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FieldGroup,
  FormField,
  IconButton,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  SkeletonText,
  SkeletonTile,
  Switch,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeletonRow,
  TableStateRow,
} from '@/shared/components/ui'

const REASONING_EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: '不思考（none）' },
  { value: 'low', label: '低（low）' },
  { value: 'medium', label: '中（medium）' },
  { value: 'high', label: '高（high）' },
  { value: 'xhigh', label: '极高（xhigh）' },
]

const REASONING_EFFORT_LABEL: Record<string, string> = {
  none: '不思考',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

export function AdminLanguageModelsView() {
  const queryClient = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [concurrencyLimit, setConcurrencyLimit] = useState(2)
  const [actionError, setActionError] = useState('')

  const {
    data: allModels = [],
    isLoading: modelsLoading,
    isError: modelsError,
    error: modelsQueryError,
    refetch: refetchModels,
  } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: async () => {
      const res = await api<AdminModel[]>(API_ENDPOINTS.admin.models)
      return res.data || []
    },
  })

  const { data: allPresets = [] } = useQuery({
    queryKey: ['admin', 'model-presets'],
    queryFn: async () => {
      const res = await api<ModelPreset[]>(API_ENDPOINTS.admin.modelPresets)
      return res.data || []
    },
  })

  const {
    data: allCredentials = [],
    isLoading: credentialsLoading,
    isError: credentialsError,
    error: credentialsQueryError,
    refetch: refetchCredentials,
  } = useQuery({
    queryKey: ['admin', 'provider-credentials'],
    queryFn: async () => {
      const res = await api<ProviderCredential[]>(API_ENDPOINTS.admin.providerCredentials)
      return res.data || []
    },
    // Connectivity tests settle in the worker; poll only while one is open.
    refetchInterval: (query) => (query.state.data?.some((c) => c.lastTestStatus === 'pending') ? 2000 : false),
  })

  // This page is language-model only: rows and presets are scoped by kind, and
  // credentials are scoped to the plugin-less (adapter + API key) shape that
  // language presets bind through `credentialsForPreset`.
  const models = allModels.filter((m) => m.modelKind === 'language')
  const presets = allPresets.filter((p) => p.modelKind === 'language')
  const credentials = allCredentials.filter(isCustomCredential)

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null
  const matchingCredentials = credentialsForPreset(credentials, selectedPreset)
  const selectedCredentialMissing = !selectedCredentialId

  // Credential usage across every model kind: a plugin-less credential may also
  // back a legacy image/video row, so the table reports all bindings.
  const linkedModelsByCredential: Record<string, string[]> = {}
  for (const m of allModels) {
    if (!m.providerCredentialId) continue
    const list = linkedModelsByCredential[m.providerCredentialId] || []
    list.push(m.displayName)
    linkedModelsByCredential[m.providerCredentialId] = list
  }

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await api(API_ENDPOINTS.admin.model(id), {
        method: 'PATCH',
        body: { enabled },
      })
      if (!res.success) throw new Error(res.error?.message || '更新状态失败')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'models'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api(API_ENDPOINTS.admin.model(id), { method: 'DELETE' })
      if (!res.success) throw new Error(res.error?.message || '删除模型失败')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'models'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPresetId) throw new Error('请选择语言模型预设')
      // The API rejects a language model without a credential
      // (LANGUAGE_MODEL_CONFIG_INVALID), so the picker is mandatory here.
      if (!selectedCredentialId) throw new Error('语言模型必须关联供应商凭据')
      const res = await api<AdminModel>(API_ENDPOINTS.admin.models, {
        method: 'POST',
        body: {
          presetId: selectedPresetId,
          providerCredentialId: selectedCredentialId,
          concurrencyLimit,
          reasoningEffort,
          enabled: true,
        },
      })
      if (!res.success) throw new Error(res.error?.message || '创建模型失败')
      return res.data
    },
    onSuccess: () => {
      setCreateModalOpen(false)
      setSelectedPresetId('')
      setSelectedCredentialId('')
      setActionError('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'models'] })
    },
    onError: (err: Error) => {
      setActionError(err.message || '创建模型失败')
    },
  })

  function openCreateModal() {
    setActionError('')
    setSelectedPresetId('')
    setSelectedCredentialId('')
    setReasoningEffort('medium')
    setCreateModalOpen(true)
  }

  function pickPreset(presetId: string) {
    setSelectedPresetId(presetId)
    setSelectedCredentialId('')
    const preset = presets.find((p) => p.id === presetId)
    if (preset?.reasoningEffort) setReasoningEffort(preset.reasoningEffort)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="语言模型"
        description="配置语言模型与推理参数。"
        actions={
          <>
            <Button onClick={openCreateModal} icon={<Plus aria-hidden="true" />}>
              创建语言模型
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                refetchModels()
                refetchCredentials()
              }}
              icon={<RefreshCw aria-hidden="true" className={modelsLoading ? 'motion-spin' : undefined} />}
            >
              刷新
            </Button>
          </>
        }
      />

      {deleteMutation.isError && (
        <Alert tone="danger" role="alert" title="无法删除语言模型">
          {deleteMutation.error?.message || '删除模型失败'}。请确认该模型未被提示词模板或任务引用后重试。
        </Alert>
      )}
      {toggleMutation.isError && (
        <Alert tone="danger" role="alert" title="无法更新模型状态">
          {toggleMutation.error?.message || '更新状态失败'}。开关已恢复原状态，请稍后重试。
        </Alert>
      )}

      <DataTable caption="语言模型列表" columns={7}>
        <TableHead>
          <TableHeadCell>模型名称</TableHeadCell>
          <TableHeadCell>协议</TableHeadCell>
          <TableHeadCell>推理参数</TableHeadCell>
          <TableHeadCell>关联凭据</TableHeadCell>
          <TableHeadCell align="right">并发上限</TableHeadCell>
          <TableHeadCell>状态</TableHeadCell>
          <TableHeadCell align="right">操作</TableHeadCell>
        </TableHead>
        <TableBody busy={modelsLoading}>
          {modelsLoading ? (
            Array.from({ length: 3 }, (_, index) => (
              <TableSkeletonRow
                key={index}
                cells={[
                  <div key="name" className="flex flex-col gap-1"><SkeletonText width="9rem" /><SkeletonText width="6rem" /></div>,
                  <SkeletonText key="protocol" width="6rem" />,
                  <div key="params" className="flex flex-col gap-1"><SkeletonText width="7rem" /><SkeletonText width="5rem" /><SkeletonText width="4rem" /></div>,
                  <SkeletonText key="credential" width="8rem" />,
                  { align: 'right', content: <SkeletonText width="3rem" /> },
                  <div key="status" className="flex items-center gap-2"><SkeletonTile className="aspect-auto h-5 w-9 rounded-pill" /><SkeletonText width="3rem" /></div>,
                  { align: 'right', content: <SkeletonTile className="aspect-auto h-8 w-8 rounded-control" /> },
                ]}
              />
            ))
          ) : modelsError ? (
            <TableStateRow>
              <EmptyState
                variant="error"
                density="compact"
                objectName="语言模型"
                title="无法加载语言模型"
                description={`${modelsQueryError?.message || '加载模型列表时出现问题'}。请检查后端服务状态后重试。`}
                action={<Button variant="secondary" onClick={() => refetchModels()}>刷新重试</Button>}
              />
            </TableStateRow>
          ) : models.length > 0 ? (
            models.map((m) => (
              <TableRow key={m.id}>
                <TableCell tone="strong">
                  <div>{m.displayName}</div>
                  <div className="font-mono text-xs font-normal text-muted-foreground">
                    {m.vendorModelId || m.name || '-'}
                  </div>
                </TableCell>
                <TableCell mono textSize="xs" tone="muted">
                  {m.languageProtocol || '-'}
                </TableCell>
                <TableCell>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground">输出上限</dt>
                    <dd className="text-right font-mono tabular-nums">{m.maxOutputTokens ?? '-'}</dd>
                    <dt className="text-muted-foreground">思考等级</dt>
                    <dd className="text-right">
                      {m.reasoningEffort ? (REASONING_EFFORT_LABEL[m.reasoningEffort] ?? m.reasoningEffort) : '-'}
                    </dd>
                    <dt className="text-muted-foreground">温度</dt>
                    <dd className="text-right font-mono tabular-nums">{m.temperature ?? '-'}</dd>
                  </dl>
                </TableCell>
                <TableCell>
                  {m.providerCredentialName ? (
                    <span>{m.providerCredentialName}</span>
                  ) : (
                    <Badge tone="danger">未关联凭据</Badge>
                  )}
                </TableCell>
                <TableCell align="right" mono tabular>{m.concurrencyLimit}</TableCell>
                {/* Immediate setting: the Switch reverts itself when the PATCH rejects,
                    and the banner above states the reason. */}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutateAsync({ id: m.id, enabled })}
                      aria-label={`语言模型 ${m.displayName} 启用状态`}
                    />
                    <span className="text-xs text-muted-foreground">{m.enabled ? '已启用' : '已停用'}</span>
                  </div>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确认删除语言模型 ${m.displayName}？`)) {
                        deleteMutation.mutate(m.id)
                      }
                    }}
                    aria-label={`删除语言模型 ${m.displayName}`}
                    icon={<Trash2 aria-hidden="true" />}
                  />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableStateRow>
              <EmptyState
                variant="first-use"
                density="compact"
                objectName="语言模型"
                title="还没有配置语言模型"
                description="在这里你可以创建、编辑和管理语言模型与推理参数。请先在下方创建凭据，再点击「创建语言模型」。"
                action={
                  <Button onClick={openCreateModal}>创建第一个语言模型</Button>
                }
              />
            </TableStateRow>
          )}
        </TableBody>
      </DataTable>

      <section className="flex flex-col gap-4" aria-labelledby="language-credentials-heading">
        <SectionHeader
          id="language-credentials-heading"
          title="语言模型凭据"
          description="语言模型使用供应商账号凭据（openai / anthropic + API Key，可填写兼容端点）。图像与视频凭据从插件模板创建，请在「媒体模型」页配置；未经插件模板创建的自定义媒体凭据同样列在此处。"
          actions={
            <Button variant="secondary" onClick={() => setCredentialDialogOpen(true)} icon={<Plus aria-hidden="true" />}>
              创建凭据
            </Button>
          }
        />

        <AdminCredentialTable
          credentials={credentials}
          isLoading={credentialsLoading}
          variant="language"
          linkedModels={linkedModelsByCredential}
          emptyText="在这里你可以创建、编辑和管理语言模型凭据。点击右上角「创建凭据」开始。"
          error={credentialsError ? credentialsQueryError?.message || '加载凭据列表失败' : null}
          onRetry={() => refetchCredentials()}
        />
      </section>

      <AdminInstalledPlugins kind="language" />

      <Dialog
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="创建新语言模型"
        panelClassName="max-w-form"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>
              取消
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!selectedPresetId || selectedCredentialMissing}
              onClick={() => createMutation.mutate()}
            >
              创建模型
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          {actionError && (
            <Alert tone="danger" role="alert" title="无法创建语言模型">
              {actionError}。请选择预设并关联可用凭据后重试。
            </Alert>
          )}

          <FieldGroup>
            <FormField
              label="选择语言模型预设"
              required
              hint={presets.length === 0 ? '当前没有可用的语言模型预设。' : '预设由服务端注册，决定输出上限与温度。'}
            >
              <Select value={selectedPresetId} onChange={(e) => pickPreset(e.target.value)}>
                <option value="">请选择预设</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} ({p.vendorModelId})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="关联供应商凭据"
              required
              hint={
                selectedPreset ? (
                  <>
                    按供应商 <span className="font-mono text-foreground">{selectedPreset.adapter || '-'}</span> 匹配凭据
                    {matchingCredentials.length === 0 ? '，当前无可用凭据，请在下方「语言模型凭据」区创建凭据' : ''}
                  </>
                ) : undefined
              }
            >
              <Select
                value={selectedCredentialId}
                onChange={(e) => setSelectedCredentialId(e.target.value)}
                disabled={!selectedPreset}
              >
                <option value="">{selectedPreset ? '请选择凭据' : '请先选择预设'}</option>
                {matchingCredentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.providerId || c.adapter})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="思考等级"
              hint={
                <>
                  预设默认值：
                  {selectedPreset?.reasoningEffort
                    ? REASONING_EFFORT_LABEL[selectedPreset.reasoningEffort] ?? selectedPreset.reasoningEffort
                    : 'medium'}
                  ；输出上限与温度由预设决定。
                </>
              }
            >
              <Select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
              >
                {REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="并发执行限制" hint="同时运行的该模型任务数量上限，取值范围 1–50。">
              <Input
                type="number"
                min="1"
                max="50"
                value={concurrencyLimit}
                onChange={(e) => setConcurrencyLimit(parseInt(e.target.value, 10) || 1)}
              />
            </FormField>
          </FieldGroup>
        </div>
      </Dialog>

      <AdminProviderCredentialDialog
        open={credentialDialogOpen}
        onClose={() => setCredentialDialogOpen(false)}
        scope="language"
      />
    </div>
  )
}
