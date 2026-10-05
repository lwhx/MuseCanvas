'use client'

import {
  useState } from 'react'
import { useQuery,
  useMutation,
  useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type {
  AdminModel,
  BuiltinProviderTemplate,
  ModelPreset,
  ProviderCredential,
  } from '@/shared/types'
import {
  credentialsForPreset,
  isCustomCredential,
  isPluginBoundCredential,
  presetPluginKey,
  templateConfiguredCount,
  } from '../lib/provider-templates'
import { AdminCredentialTable } from './admin-credential-table'
import { AdminProviderCredentialDialog } from './admin-provider-credential-dialog'
import { AdminInstalledPlugins } from './admin-installed-plugins'
import { Blocks,
  Plus,
  RefreshCw,
  Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
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
  iconSize,
} from '@/shared/components/ui'

const MEDIA_KIND_LABEL: Record<'image' | 'video', string> = {
  image: '图像',
  video: '视频',
}

export function AdminMediaModelsView() {
  const queryClient = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false)
  const [lockedTemplate, setLockedTemplate] = useState<BuiltinProviderTemplate | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [concurrencyLimit, setConcurrencyLimit] = useState(1)
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

  const {
    data: templates = [],
    isLoading: templatesLoading,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ['admin', 'provider-templates'],
    queryFn: async () => {
      const res = await api<{ templates: BuiltinProviderTemplate[] }>(API_ENDPOINTS.admin.providerTemplates)
      if (!res.success) throw new Error(res.error?.message || '加载供应商插件失败')
      return res.data?.templates || []
    },
  })

  // This page owns everything media-shaped: image/video model rows, the plugin
  // directory that signs media credentials, and the plugin-bound credentials.
  const models = allModels.filter((m) => m.modelKind !== 'language')
  const presets = allPresets.filter((p) => p.modelKind !== 'language')
  const mediaCredentials = allCredentials.filter(isPluginBoundCredential)

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null
  const selectedPresetPluginKey = presetPluginKey(selectedPreset)
  // The template carries the plugin's endpoint policy, so the picker never offers
  // a credential the API would refuse to bind.
  const selectedTemplate = templates.find(
    (t) => t.pluginId === selectedPreset?.pluginId && t.pluginVersion === selectedPreset?.pluginVersion,
  ) ?? null
  const matchingCredentials = credentialsForPreset(allCredentials, selectedPreset, selectedTemplate)

  const linkedModelsByCredential: Record<string, string[]> = {}
  for (const m of models) {
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
      if (!selectedPresetId) throw new Error('请选择模型预设')
      const res = await api<AdminModel>(API_ENDPOINTS.admin.models, {
        method: 'POST',
        body: {
          presetId: selectedPresetId,
          providerCredentialId: selectedCredentialId || undefined,
          concurrencyLimit,
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

  function openCreateDialog(template: BuiltinProviderTemplate | null) {
    setLockedTemplate(template)
    setCredentialDialogOpen(true)
  }

  function mediaKind(model: AdminModel): 'image' | 'video' {
    return model.modelKind === 'video' ? 'video' : 'image'
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="媒体模型"
        description="配置图像与视频模型、供应商插件目录与媒体凭据；语言模型请在「语言模型」页配置。"
        actions={
          <>
            <Button
              onClick={() => {
                setActionError('')
                setCreateModalOpen(true)
              }}
              icon={<Plus aria-hidden="true" />}
            >
              创建模型
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                refetchModels()
                refetchCredentials()
                refetchTemplates()
              }}
              icon={<RefreshCw aria-hidden="true" className={modelsLoading ? 'motion-spin' : undefined} />}
            >
              刷新
            </Button>
          </>
        }
      />

      {deleteMutation.isError && (
        <Alert tone="danger" role="alert" title="无法删除模型">
          {deleteMutation.error?.message || '删除模型失败'}。请确认该模型未被任务引用后重试。
        </Alert>
      )}
      {toggleMutation.isError && (
        <Alert tone="danger" role="alert" title="无法更新模型状态">
          {toggleMutation.error?.message || '更新状态失败'}。开关已恢复原状态，请稍后重试。
        </Alert>
      )}

      <DataTable caption="图像与视频模型列表" columns={7}>
        <TableHead>
          <TableHeadCell>模型名称</TableHeadCell>
          <TableHeadCell>类型</TableHeadCell>
          <TableHeadCell>绑定插件</TableHeadCell>
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
                  <SkeletonTile key="kind" className="aspect-auto h-6 w-12 rounded-pill" />,
                  <SkeletonText key="plugin" width="8rem" />,
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
                objectName="媒体模型"
                title="无法加载媒体模型"
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
                <TableCell>
                  <Badge tone="neutral">{MEDIA_KIND_LABEL[mediaKind(m)]}</Badge>
                </TableCell>
                <TableCell mono textSize="xs" tone="muted">
                  {m.pluginId && m.pluginVersion ? `${m.pluginId}@${m.pluginVersion}` : '-'}
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
                      aria-label={`模型 ${m.displayName} 启用状态`}
                    />
                    <span className="text-xs text-muted-foreground">{m.enabled ? '已启用' : '已停用'}</span>
                  </div>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确认删除模型 ${m.displayName}？`)) {
                        deleteMutation.mutate(m.id)
                      }
                    }}
                    aria-label={`删除模型 ${m.displayName}`}
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
                objectName="媒体模型"
                title="还没有配置媒体模型"
                description="在这里你可以创建、编辑和管理图像与视频模型。点击右上角「创建模型」开始。"
                action={
                  <Button
                    onClick={() => {
                      setActionError('')
                      setCreateModalOpen(true)
                    }}
                  >
                    创建第一个模型
                  </Button>
                }
              />
            </TableStateRow>
          )}
        </TableBody>
      </DataTable>

      <section className="flex flex-col gap-4" aria-labelledby="plugin-directory-heading">
        <SectionHeader
          id="plugin-directory-heading"
          title="供应商插件目录"
          description="由 provider registry 提供的内置图像 / 视频插件。凭据属于供应商账号：从卡片「创建凭据」时按该插件声明的格式与端点校验，同一账号下的其它插件也可以使用。"
        />

        {templatesLoading ? (
          <div className="grid gap-4 lg:grid-cols-2" role="status" aria-busy="true">
            <span className="sr-only">正在加载供应商插件目录</span>
            {Array.from({ length: 2 }, (_, index) => (
              <Card key={index} density="compact" aria-hidden="true" className="h-full gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2"><SkeletonText width="10rem" /><SkeletonText width="7rem" /></div>
                  <div className="flex flex-col items-end gap-2"><SkeletonTile className="aspect-auto h-6 w-12 rounded-pill" /><SkeletonTile className="aspect-auto h-6 w-24 rounded-pill" /></div>
                </div>
                <SkeletonText lines={2} />
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2"><SkeletonText width="5rem" /><SkeletonText width="9rem" /><SkeletonText width="5rem" /><SkeletonText width="7rem" /><SkeletonText width="5rem" /><SkeletonText width="10rem" /></div>
                <SkeletonText width="8rem" />
                <div className="flex gap-2"><SkeletonTile className="aspect-auto h-6 w-20 rounded-pill" /><SkeletonTile className="aspect-auto h-6 w-24 rounded-pill" /></div>
                <SkeletonTile className="mt-auto aspect-auto h-[var(--control-md)] w-full rounded-control" />
              </Card>
            ))}
          </div>
        ) : templatesError ? (
          <Alert
            tone="danger"
            role="alert"
            title="无法加载供应商插件"
            action={
              <Button variant="secondary" size="sm" onClick={() => refetchTemplates()}>
                刷新重试
              </Button>
            }
          >
            {templatesError.message || '加载供应商插件失败'}。请检查后端服务状态后重试。
          </Alert>
        ) : templates.length === 0 ? (
          <Card density="compact">
            <EmptyState
              variant="first-use"
              density="compact"
              objectName="供应商插件"
              title="暂无已注册的供应商插件"
              description="内置插件由服务端 provider registry 注册；如需扩展，请在下方「已安装媒体插件」上传自定义插件。"
            />
          </Card>
        ) : (
          // `md` is 960px in this token layer: two plugin cards only fit side by side
          // from `lg` once the sidebar and page padding are removed.
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.map((t) => {
              const configured = templateConfiguredCount(allCredentials, t)
              return (
                <Card key={t.key} density="compact" className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Blocks aria-hidden="true" className={`${iconSize.sm} shrink-0 text-muted-foreground`} />
                        <h3 className="truncate text-sm font-medium">{t.displayName}</h3>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {t.pluginId}@{t.pluginVersion}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone="neutral">{t.modality === 'video' ? '视频' : '图像'}</Badge>
                      <Badge tone={configured > 0 ? 'success' : 'danger'}>
                        {configured > 0 ? `已配置 ${configured} 个凭据` : '未配置凭据'}
                      </Badge>
                    </div>
                  </div>

                  {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">供应商</dt>
                    <dd className="font-mono">{t.providerId}</dd>
                    <dt className="text-muted-foreground">Base URL</dt>
                    <dd className="break-all font-mono">{t.baseUrl}</dd>
                    <dt className="text-muted-foreground">凭据</dt>
                    <dd>
                      {t.credential.label}
                      <span className="ml-1 font-mono text-muted-foreground">
                        {t.credential.schemaId}@{t.credential.schemaVersion}
                      </span>
                    </dd>
                  </dl>

                  <div className="flex flex-col gap-1">
                    <p className="text-overline text-muted-foreground">
                      支持模型（<span className="font-mono tabular-nums">{t.models.length}</span>）
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {t.models.map((model) => (
                        <Badge key={model.id} tone="neutral" className="max-w-full font-mono" title={model.name}>
                          {model.id}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {t.presetIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      关联预设：<span className="font-mono">{t.presetIds.join(', ')}</span>
                    </p>
                  )}

                  <Button
                    variant="secondary"
                    fullWidth
                    className="mt-auto"
                    onClick={() => openCreateDialog(t)}
                    icon={<Plus aria-hidden="true" />}
                  >
                    创建凭据
                  </Button>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <AdminInstalledPlugins kind="media" />

      <section className="flex flex-col gap-4" aria-labelledby="media-credentials-heading">
        <SectionHeader
          id="media-credentials-heading"
          title="媒体凭据"
          description="从插件模板创建的图像 / 视频凭据。语言模型与自定义凭据在「语言模型」页配置。"
          actions={
            <Button
              variant="secondary"
              onClick={() => openCreateDialog(null)}
              icon={<Plus aria-hidden="true" />}
            >
              创建凭据
            </Button>
          }
        />

        <AdminCredentialTable
          credentials={mediaCredentials}
          isLoading={credentialsLoading}
          variant="media"
          linkedModels={linkedModelsByCredential}
          emptyText="在这里你可以创建、编辑和管理媒体凭据。请从上方插件目录为指定插件创建凭据。"
          error={credentialsError ? credentialsQueryError?.message || '加载凭据列表失败' : null}
          onRetry={() => refetchCredentials()}
        />
        {allCredentials.some(isCustomCredential) && (
          <p className="text-xs text-muted-foreground">
            另有 <span className="font-mono tabular-nums">{allCredentials.filter(isCustomCredential).length}</span>{' '}
            个未经插件模板创建的自定义 / 语言模型凭据，由「语言模型」页管理。
          </p>
        )}
      </section>

      <Dialog
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="创建媒体模型"
        panelClassName="max-w-form"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              loading={createMutation.isPending}
              disabled={!selectedPresetId}
              onClick={() => createMutation.mutate()}
            >
              创建模型
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          {actionError && (
            <Alert tone="danger" role="alert" title="无法创建模型">
              {actionError}。请选择预设并确认凭据可用后重试。
            </Alert>
          )}

          <FieldGroup>
            <FormField
              label="选择预设"
              required
              hint={presets.length === 0 ? '当前没有可用的图像或视频预设。' : '预设由服务端注册，决定可调用的模型标识与参数。'}
            >
              <Select
                value={selectedPresetId}
                onChange={(e) => {
                  setSelectedPresetId(e.target.value)
                  setSelectedCredentialId('')
                }}
              >
                <option value="">请选择预设</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} ({p.vendorModelId}) · {p.modelKind === 'video' ? '视频' : '图像'}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="关联供应商凭据"
              hint={
                selectedPreset ? (
                  <>
                    {selectedPresetPluginKey ? (
                      <>需要供应商 <span className="font-mono text-foreground">{selectedPreset.providerId || '-'}</span> 的凭据（插件 <span className="font-mono text-foreground">{selectedPresetPluginKey}</span>）</>
                    ) : (
                      <>按适配协议 <span className="font-mono text-foreground">{selectedPreset.adapter || '-'}</span> 匹配凭据</>
                    )}
                    {matchingCredentials.length === 0
                      ? '，当前无可用凭据，请在下方「供应商插件目录」创建凭据'
                      : ''}
                  </>
                ) : undefined
              }
            >
              <Select
                value={selectedCredentialId}
                onChange={(e) => setSelectedCredentialId(e.target.value)}
                disabled={!selectedPreset}
              >
                <option value="">{selectedPreset ? '未关联（任务将因缺少凭据失败）' : '请先选择预设'}</option>
                {matchingCredentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.providerId || c.adapter})
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="并发执行限制"
              hint="同时运行的该模型任务数量上限，取值范围 1–50。"
            >
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
        templates={templates}
        lockedTemplate={lockedTemplate}
        scope="media"
      />
    </div>
  )
}
