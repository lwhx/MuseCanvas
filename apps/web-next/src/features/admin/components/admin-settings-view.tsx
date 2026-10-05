'use client'

import {
  useState } from 'react'
import { useMutation,
  useQuery,
  useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type {
  RuntimeSettingsDto,
  RuntimeSettingsInput,
  SetupConfigResponse,
  SetupSmtpTestResult,
  SetupStorageTestResult,
  SiteSettingsDto,
  SiteSettingsInput,
  SmtpConnectionStatus,
  SmtpSettingsDto,
  SmtpSettingsInput,
  SmtpTlsMode,
  StorageConnectionStatus,
  StorageSettingsDto,
  StorageSettingsInput,
  } from '@/shared/types'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldGroup,
  FormField,
  Input,
  PageHeader,
  Select,
  SkeletonRow,
  SkeletonText,
  SkeletonTile,
  Tabs,
  iconSize,
} from '@/shared/components/ui'
import type { BadgeTone } from '@/shared/components/ui'
import { cn } from '@/shared/lib/cn'
import { Database, Globe, Mail, RefreshCw, SlidersHorizontal } from 'lucide-react'

const settingsQueryKey = ['admin', 'settings'] as const

interface Feedback {
  ok: boolean
  msg: string
}

/**
 * 设置页 layout (components.md 场景模式 → 设置页): a 240px group nav on the left and
 * one segmented panel on the right, with the save bar sticky at the bottom.
 *
 * The rail is `--container-settings-nav` (240px), which is its own token rather
 * than `--container-sidebar` (260px): the spec's settings nav lists section names,
 * not the admin sidebar's icon+label rows. It only applies from `md` (960px) up;
 * below that the same selection collapses to `Tabs variant="segment"`.
 */
type SectionId = 'site' | 'smtp' | 'storage' | 'runtime'

const sectionGroups: Array<{
  title: string
  items: Array<{ id: SectionId; label: string; icon: typeof Globe }>
}> = [
  { title: '站点', items: [{ id: 'site', label: '站点信息', icon: Globe }] },
  {
    title: '外部服务',
    items: [
      { id: 'smtp', label: 'SMTP 邮件服务', icon: Mail },
      { id: 'storage', label: '对象存储', icon: Database },
    ],
  },
  { title: '运行参数', items: [{ id: 'runtime', label: '运行时限制', icon: SlidersHorizontal }] },
]

const connectionStatusTone: Record<SmtpConnectionStatus | StorageConnectionStatus, BadgeTone> = {
  not_configured: 'neutral',
  configured: 'warning',
  verified: 'success',
  error: 'danger',
}

const connectionStatusLabel: Record<SmtpConnectionStatus | StorageConnectionStatus, string> = {
  not_configured: '未配置',
  configured: '已保存待验证',
  verified: '已验证',
  error: '连接异常',
}

// Empty inputs are omitted so the server keeps the stored value instead of clearing it.
function keepIfEmpty(raw: string): string | undefined {
  return raw.trim() === '' ? undefined : raw.trim()
}

function keepIfEmptyNumber(raw: string): number | undefined {
  return raw.trim() === '' ? undefined : Number(raw)
}

function ConnectionBadge({ status }: { status: SmtpConnectionStatus | StorageConnectionStatus }) {
  return <Badge tone={connectionStatusTone[status]}>{connectionStatusLabel[status]}</Badge>
}

/** Section header: title + description on the left, status metadata on the right. */
function SectionHeader({
  title,
  description,
  status,
}: {
  title: string
  description: string
  status?: React.ReactNode
}) {
  return (
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle level={2}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {status ? <div className="flex shrink-0 items-center gap-2">{status}</div> : null}
    </CardHeader>
  )
}

/**
 * 危险操作区 (components.md 场景模式 → 设置页): its own block at the bottom of the
 * segment — a 4px danger bar on the `danger-soft` surface. It sits between cards,
 * never inside one, so no divider rule is needed.
 */
function DangerZone({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <section
      aria-label="危险操作"
      className="flex flex-col gap-4 rounded-card border border-danger-border bg-danger-soft p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-module text-danger">危险操作</h3>
        <p className="max-w-reading text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

/**
 * Sticky save bar (设置页 footer): 取消 ghost + 保存 primary. The buttons submit the
 * segment's form through its `id`, so each section keeps its own mutation.
 */
function SaveBar({
  formId,
  dirty,
  saving,
  onCancel,
}: {
  formId: string
  dirty: boolean
  saving: boolean
  onCancel: () => void
}) {
  return (
    <div className="sticky bottom-0 z-sticky flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-soft">
      <p className="text-sm text-muted-foreground">{dirty ? '有未保存的更改。' : '所有更改已保存。'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" form={formId} loading={saving}>
          保存
        </Button>
      </div>
    </div>
  )
}

const FORM_ID = {
  site: 'admin-settings-site-form',
  smtp: 'admin-settings-smtp-form',
  storage: 'admin-settings-storage-form',
  runtime: 'admin-settings-runtime-form',
} as const

const updatedAtStatus = (updatedAt: string) => (
  <p className="text-xs text-muted-foreground">更新于 {updatedAt.slice(0, 10)}</p>
)

function SiteSection({
  settings,
  onFeedback,
}: {
  settings: SiteSettingsDto
  onFeedback: (feedback: Feedback) => void
}) {
  const queryClient = useQueryClient()
  const [siteName, setSiteName] = useState(settings.siteName ?? '')
  const [siteUrl, setSiteUrl] = useState(settings.siteUrl ?? '')

  const dirty = siteName !== (settings.siteName ?? '') || siteUrl !== (settings.siteUrl ?? '')

  const save = useMutation({
    mutationFn: async () => {
      const body: SiteSettingsInput = {
        siteName: siteName.trim(),
        siteUrl: siteUrl.trim() || null,
      }
      if (!body.siteName) throw new Error('请输入站点名称')
      const res = await api(API_ENDPOINTS.setup.site, { method: 'POST', body })
      if (!res.success) throw new Error(res.error?.message || '保存站点配置失败')
      return res.data
    },
    onSuccess: () => {
      onFeedback({ ok: true, msg: '站点配置已保存' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || '保存站点配置失败' }),
  })

  function reset() {
    setSiteName(settings.siteName ?? '')
    setSiteUrl(settings.siteUrl ?? '')
  }

  return (
    <>
      <Card className="gap-6">
        <SectionHeader
          title="站点信息"
          description="用于邮件、OAuth 回调与分享链接中的实例公开地址。"
          status={updatedAtStatus(settings.updatedAt)}
        />
        <form
          id={FORM_ID.site}
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FieldGroup>
            <FormField label="站点名称" required hint="显示在标题、邮件与页面元信息中，最长 120 字符。">
              <Input type="text" maxLength={120} value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </FormField>
            <FormField
              label="站点地址（可选）"
              hint="必须是 HTTPS 根地址，不能带路径、查询参数或认证信息；留空则回退到服务端环境变量推导的地址。"
            >
              <Input
                type="text"
                placeholder="https://musecanvas.example.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
            </FormField>
          </FieldGroup>
        </form>
      </Card>
      <SaveBar formId={FORM_ID.site} dirty={dirty} saving={save.isPending} onCancel={reset} />
    </>
  )
}

function SmtpSection({
  settings,
  onFeedback,
}: {
  settings: SmtpSettingsDto
  onFeedback: (feedback: Feedback) => void
}) {
  const queryClient = useQueryClient()
  const [host, setHost] = useState(settings.host ?? '')
  const [port, setPort] = useState(settings.port === null ? '' : String(settings.port ?? ''))
  const [tlsMode, setTlsMode] = useState<SmtpTlsMode>(settings.tlsMode)
  const [username, setUsername] = useState(settings.username ?? '')
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(settings.fromAddress ?? '')
  const [fromName, setFromName] = useState(settings.fromName ?? '')

  const portBaseline = settings.port === null ? '' : String(settings.port ?? '')
  const dirty =
    password.trim() !== '' ||
    host !== (settings.host ?? '') ||
    port !== portBaseline ||
    tlsMode !== settings.tlsMode ||
    username !== (settings.username ?? '') ||
    fromAddress !== (settings.fromAddress ?? '') ||
    fromName !== (settings.fromName ?? '')

  // The password field is write-only: an untouched input is omitted so the stored
  // secret survives, while sending an empty string would wipe it.
  function toInput(): SmtpSettingsInput {
    return {
      host: keepIfEmpty(host),
      port: keepIfEmptyNumber(port),
      tlsMode: tlsMode === settings.tlsMode ? undefined : tlsMode,
      username: keepIfEmpty(username),
      password: password.trim() || undefined,
      fromAddress: keepIfEmpty(fromAddress),
      fromName: keepIfEmpty(fromName),
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await api(API_ENDPOINTS.setup.smtp, { method: 'POST', body: toInput() })
      if (!res.success) throw new Error(res.error?.message || '保存 SMTP 设置失败')
      return res.data
    },
    onSuccess: () => {
      setPassword('')
      onFeedback({ ok: true, msg: 'SMTP 设置已保存，建议执行发信测试完成验证。' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || '保存 SMTP 设置失败' }),
  })

  const test = useMutation({
    mutationFn: async () => {
      const res = await api<SetupSmtpTestResult>(API_ENDPOINTS.setup.smtpTest, {
        method: 'POST',
        body: toInput(),
      })
      if (!res.success || !res.data?.verified) throw new Error(res.error?.message || 'SMTP 连通性测试未通过')
      return res.data
    },
    onSuccess: () => {
      setPassword('')
      onFeedback({ ok: true, msg: 'SMTP 连通性测试通过，设置已保存并标记为已验证。' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || 'SMTP 连通性测试未通过' }),
  })

  function reset() {
    setHost(settings.host ?? '')
    setPort(portBaseline)
    setTlsMode(settings.tlsMode)
    setUsername(settings.username ?? '')
    setPassword('')
    setFromAddress(settings.fromAddress ?? '')
    setFromName(settings.fromName ?? '')
  }

  return (
    <>
      <Card className="gap-6">
        <SectionHeader
          title="SMTP 邮件服务"
          description="用于发送登录验证码与通知邮件。"
          status={<ConnectionBadge status={settings.status} />}
        />
        <form
          id={FORM_ID.smtp}
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField label="发信服务器" hint="留空表示保持当前值不变。">
              <Input type="text" placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </FormField>
            <FormField label="端口">
              <Input
                type="number"
                min={1}
                max={65535}
                placeholder={settings.port === null ? '465' : String(settings.port)}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </FormField>
            <FormField label="加密方式">
              <Select value={tlsMode} onChange={(e) => setTlsMode(e.target.value as SmtpTlsMode)}>
                <option value="implicit_tls">隐式 TLS（465）</option>
                <option value="starttls">STARTTLS（587）</option>
                <option value="none">不加密</option>
              </Select>
            </FormField>
            <FormField label="登录用户名">
              <Input
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </FormField>
            <FormField
              label="登录密码 / 授权码"
              hint={settings.hasSecret ? '已配置密钥，留空则保持不变。' : '密钥仅写入，不会回显。'}
            >
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={settings.hasSecret ? '••••••••' : '未设置'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <FormField label="发件地址">
              <Input type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            </FormField>
            <FormField label="发件人名称">
              <Input type="text" maxLength={120} value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </FormField>
          </div>
        </form>
      </Card>

      <DangerZone description="测试会先保存当前表单内容，再真实建立外部连接并投递一封邮件；登录密钥一旦保存即被覆盖，旧值无法取回。">
        <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
          发送测试邮件
        </Button>
      </DangerZone>

      <SaveBar formId={FORM_ID.smtp} dirty={dirty} saving={save.isPending} onCancel={reset} />
    </>
  )
}

function StorageSection({
  settings,
  onFeedback,
}: {
  settings: StorageSettingsDto
  onFeedback: (feedback: Feedback) => void
}) {
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(settings.endpoint ?? '')
  const [publicEndpoint, setPublicEndpoint] = useState(settings.publicEndpoint ?? '')
  const [region, setRegion] = useState(settings.region)
  const [bucket, setBucket] = useState(settings.bucket ?? '')
  const [accessKeyId, setAccessKeyId] = useState(settings.accessKeyId ?? '')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [signedUrlTtlSeconds, setSignedUrlTtlSeconds] = useState(String(settings.signedUrlTtlSeconds))

  const dirty =
    secretAccessKey.trim() !== '' ||
    endpoint !== (settings.endpoint ?? '') ||
    publicEndpoint !== (settings.publicEndpoint ?? '') ||
    region !== settings.region ||
    bucket !== (settings.bucket ?? '') ||
    accessKeyId !== (settings.accessKeyId ?? '') ||
    signedUrlTtlSeconds !== String(settings.signedUrlTtlSeconds)

  function toInput(): StorageSettingsInput {
    return {
      endpoint: keepIfEmpty(endpoint),
      publicEndpoint: keepIfEmpty(publicEndpoint),
      region: keepIfEmpty(region),
      bucket: keepIfEmpty(bucket),
      accessKeyId: keepIfEmpty(accessKeyId),
      secretAccessKey: secretAccessKey.trim() || undefined,
      signedUrlTtlSeconds: keepIfEmptyNumber(signedUrlTtlSeconds),
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await api(API_ENDPOINTS.setup.storage, { method: 'POST', body: toInput() })
      if (!res.success) throw new Error(res.error?.message || '保存对象存储设置失败')
      return res.data
    },
    onSuccess: () => {
      setSecretAccessKey('')
      onFeedback({ ok: true, msg: '对象存储设置已保存，建议执行连通性测试完成验证。' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || '保存对象存储设置失败' }),
  })

  const test = useMutation({
    mutationFn: async () => {
      const res = await api<SetupStorageTestResult>(API_ENDPOINTS.setup.storageTest, {
        method: 'POST',
        body: toInput(),
      })
      if (!res.success || !res.data?.verified) throw new Error(res.error?.message || '对象存储连通性测试未通过')
      return res.data
    },
    onSuccess: () => {
      setSecretAccessKey('')
      onFeedback({ ok: true, msg: '对象存储连通性测试通过，设置已保存并标记为已验证。' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || '对象存储连通性测试未通过' }),
  })

  function reset() {
    setEndpoint(settings.endpoint ?? '')
    setPublicEndpoint(settings.publicEndpoint ?? '')
    setRegion(settings.region)
    setBucket(settings.bucket ?? '')
    setAccessKeyId(settings.accessKeyId ?? '')
    setSecretAccessKey('')
    setSignedUrlTtlSeconds(String(settings.signedUrlTtlSeconds))
  }

  return (
    <>
      <Card className="gap-6">
        <SectionHeader
          title="对象存储"
          description="S3 兼容存储（含 MinIO / OSS / COS / R2），用于持久化生成的图像与视频资产。"
          status={<ConnectionBadge status={settings.status} />}
        />
        <form
          id={FORM_ID.storage}
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <FormField label="服务端点" hint="必须为 HTTP(S) 地址，不能带查询参数。">
              <Input
                type="text"
                placeholder="https://minio.internal:9000"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </FormField>
            <FormField label="公网访问端点（可选）">
              <Input
                type="text"
                placeholder="https://cdn.example.com"
                value={publicEndpoint}
                onChange={(e) => setPublicEndpoint(e.target.value)}
              />
            </FormField>
            <FormField label="区域" hint="仅小写字母、数字与连字符，最长 32 字符。">
              <Input
                type="text"
                maxLength={32}
                placeholder="us-east-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </FormField>
            <FormField label="存储桶" hint="3-63 字符，仅小写字母、数字、连字符与点。">
              <Input type="text" value={bucket} onChange={(e) => setBucket(e.target.value)} />
            </FormField>
            <FormField label="Access Key ID">
              <Input
                type="text"
                autoComplete="off"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
              />
            </FormField>
            <FormField
              label="Secret Access Key"
              hint={settings.hasSecret ? '已配置密钥，留空则保持不变。' : '密钥仅写入，不会回显。'}
            >
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={settings.hasSecret ? '••••••••' : '未设置'}
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
              />
            </FormField>
            <FormField label="签名 URL 有效期（秒）" hint="允许范围 60 - 3600。">
              <Input
                type="number"
                min={60}
                max={3600}
                value={signedUrlTtlSeconds}
                onChange={(e) => setSignedUrlTtlSeconds(e.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Card>

      <DangerZone description="测试会先保存当前表单内容，再真实读写存储桶中的对象；Secret Access Key 一旦保存即被覆盖，旧值无法取回。">
        <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
          运行连通性测试
        </Button>
      </DangerZone>

      <SaveBar formId={FORM_ID.storage} dirty={dirty} saving={save.isPending} onCancel={reset} />
    </>
  )
}

const runtimeFields: Array<{
  key: keyof RuntimeSettingsInput
  label: string
  min: number
  max: number
}> = [
  { key: 'uploadTtlSeconds', label: '上传暂存有效期（秒）', min: 300, max: 604800 },
  { key: 'signedUrlTtlSeconds', label: '签名 URL 有效期（秒）', min: 60, max: 3600 },
  { key: 'maxImageBytes', label: '单图大小上限（字节）', min: 1, max: 100000000 },
  { key: 'maxTotalBytes', label: '单次上传总大小上限（字节）', min: 1, max: 200000000 },
  { key: 'maxInputs', label: '单次生成参考图上限（张）', min: 1, max: 32 },
  { key: 'providerTimeoutMs', label: '上游请求超时（毫秒）', min: 1, max: 3600000 },
  { key: 'maxOutputBytes', label: '生成结果大小上限（字节）', min: 1, max: 100000000 },
  { key: 'jobLeaseMs', label: '任务租约时长（毫秒）', min: 1, max: 3600000 },
]

type RuntimeDraft = Record<keyof RuntimeSettingsInput, string>

function toRuntimeDraft(settings: RuntimeSettingsDto): RuntimeDraft {
  return {
    uploadTtlSeconds: String(settings.uploadTtlSeconds),
    signedUrlTtlSeconds: String(settings.signedUrlTtlSeconds),
    maxImageBytes: String(settings.maxImageBytes),
    maxTotalBytes: String(settings.maxTotalBytes),
    maxInputs: String(settings.maxInputs),
    providerTimeoutMs: String(settings.providerTimeoutMs),
    maxOutputBytes: String(settings.maxOutputBytes),
    jobLeaseMs: String(settings.jobLeaseMs),
  }
}

function RuntimeSection({
  settings,
  onFeedback,
}: {
  settings: RuntimeSettingsDto
  onFeedback: (feedback: Feedback) => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<RuntimeDraft>(() => toRuntimeDraft(settings))

  const baseline = toRuntimeDraft(settings)
  const dirty = runtimeFields.some(({ key }) => draft[key] !== baseline[key])

  function resolve(key: keyof RuntimeSettingsInput) {
    const raw = draft[key].trim()
    return raw === '' ? settings[key] : Number(raw)
  }

  // The same cross-check the mutation runs, surfaced on the field that caused it.
  const totalBelowImage = resolve('maxTotalBytes') < resolve('maxImageBytes')

  function toValues(): Record<keyof RuntimeSettingsInput, number> {
    // Every field is always submitted: the server only cross-checks the keys present
    // in the request, so a partial submit could store a total cap below the
    // single-image cap that stays in the row. Blank inputs fall back to the stored value.
    const values = {} as Record<keyof RuntimeSettingsInput, number>
    for (const { key } of runtimeFields) {
      values[key] = resolve(key)
    }
    return values
  }

  const save = useMutation({
    mutationFn: async () => {
      const values = toValues()
      if (values.maxTotalBytes < values.maxImageBytes) {
        throw new Error('总大小上限不能小于单图大小上限')
      }
      const res = await api(API_ENDPOINTS.setup.runtime, { method: 'POST', body: values })
      if (!res.success) throw new Error(res.error?.message || '保存运行时限制失败')
      return res.data
    },
    onSuccess: () => {
      onFeedback({ ok: true, msg: '运行时限制已保存，Worker 将在缓存刷新后生效。' })
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => onFeedback({ ok: false, msg: err.message || '保存运行时限制失败' }),
  })

  return (
    <>
      <Card className="gap-6">
        <SectionHeader
          title="运行时限制"
          description="上传、生成任务与上游调用的护栏参数，留空的字段保持原值。"
          status={updatedAtStatus(settings.updatedAt)}
        />
        <form
          id={FORM_ID.runtime}
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            {runtimeFields.map(({ key, label, min, max }) => (
              <FormField
                key={key}
                label={label}
                error={
                  key === 'maxTotalBytes' && totalBelowImage ? '总大小上限不能小于单图大小上限。' : undefined
                }
              >
                <Input
                  type="number"
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </FormField>
            ))}
          </div>
        </form>
      </Card>

      <SaveBar
        formId={FORM_ID.runtime}
        dirty={dirty}
        saving={save.isPending}
        onCancel={() => setDraft(toRuntimeDraft(settings))}
      />
    </>
  )
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2 md:hidden" aria-hidden="true">
        {['w-[72px]', 'w-[88px]', 'w-[64px]', 'w-[80px]'].map((width, index) => (
          <SkeletonTile key={index} className={`aspect-auto h-[var(--control-md)] rounded-control ${width}`} />
        ))}
      </div>
      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        <nav aria-hidden="true" className="hidden shrink-0 flex-col gap-6 md:flex md:w-settings-nav">
          {[['96px', '128px', '112px'], ['80px', '144px', '104px']].map((group, index) => (
            <div key={index} className="flex flex-col gap-2">
              <SkeletonText width="96px" />
              {group.map((width, itemIndex) => <SkeletonRow key={itemIndex} cellWidth={width} />)}
            </div>
          ))}
        </nav>
        <Card aria-hidden="true" className="flex-1 gap-6">
          <CardHeader className="gap-2">
            <SkeletonText width="200px" />
            <SkeletonText width="320px" />
          </CardHeader>
          <CardBody className="gap-6">
            <SkeletonText lines={2} />
            <div className="grid gap-6 sm:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex flex-col gap-2">
                  <SkeletonText width={index % 2 ? '7rem' : '9rem'} />
                  <SkeletonTile className="aspect-auto h-[var(--control-md)] w-full rounded-control" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

export function AdminSettingsView() {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [active, setActive] = useState<SectionId>('site')

  const {
    data: config,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const res = await api<SetupConfigResponse>(API_ENDPOINTS.setup.config)
      if (!res.success || !res.data) throw new Error(res.error?.message || '读取系统配置失败')
      return res.data
    },
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="系统配置"
        description="实例初始化后的站点、邮件、存储与运行时参数维护入口。"
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
            icon={<RefreshCw aria-hidden="true" className={iconSize.sm} />}
          >
            刷新
          </Button>
        }
      />

      {feedback ? (
        <Alert tone={feedback.ok ? 'success' : 'danger'} role="status" onDismiss={() => setFeedback(null)}>
          {feedback.msg}
        </Alert>
      ) : null}

      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">正在加载系统配置</span>
          <SettingsSkeleton />
        </div>
      ) : null}

      {isError ? (
        <Alert
          tone="danger"
          role="alert"
          title="无法加载系统配置"
          action={
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
              刷新重试
            </Button>
          }
        >
          {error instanceof Error ? error.message : '读取系统配置失败'}
        </Alert>
      ) : null}

      {config ? (
        <div className="flex flex-col gap-6">
          {/* One selection, two surfaces: segment tabs below `md` (960px), group rail from `md` up. */}
          <Tabs
            variant="segment"
            value={active}
            onValueChange={(id) => setActive(id as SectionId)}
            tabs={sectionGroups.flatMap((group) => group.items.map((item) => ({ id: item.id, label: item.label })))}
            aria-label="设置分组"
            className="md:hidden"
          />

          <div className="flex flex-col gap-8 md:flex-row md:items-start">
            <nav aria-label="设置分组" className="hidden shrink-0 flex-col gap-6 md:flex md:w-settings-nav">
              {sectionGroups.map((group) => (
                <div key={group.title} className="flex flex-col gap-1">
                  <h2 className="px-3 text-overline text-muted-foreground">{group.title}</h2>
                  {group.items.map((item) => {
                    const ItemIcon = item.icon
                    const current = item.id === active
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => setActive(item.id)}
                        className={cn(
                          'relative flex min-h-[var(--control-md)] items-center gap-3 rounded-control px-3',
                          'text-left text-sm font-medium transition-colors',
                          current
                            ? 'bg-tonal-selected text-foreground'
                            : 'text-muted-foreground hover:bg-tonal-hover hover:text-foreground',
                        )}
                      >
                        {current ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-primary"
                          />
                        ) : null}
                        <ItemIcon className={`${iconSize.sm} shrink-0`} aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>

            {/* Every segment stays mounted, so an unsaved draft survives a group switch.
                The column keeps the spec's form measure (`--container-form`, 640px). */}
            <div className="flex w-full max-w-form min-w-0 flex-1 flex-col">
              <div className={cn('flex flex-col gap-6', active !== 'site' && 'hidden')}>
                <SiteSection
                  key={`site-${config.site.revision}`}
                  settings={config.site}
                  onFeedback={setFeedback}
                />
              </div>
              <div className={cn('flex flex-col gap-6', active !== 'smtp' && 'hidden')}>
                <SmtpSection
                  key={`smtp-${config.smtp.revision}`}
                  settings={config.smtp}
                  onFeedback={setFeedback}
                />
              </div>
              <div className={cn('flex flex-col gap-6', active !== 'storage' && 'hidden')}>
                <StorageSection
                  key={`storage-${config.storage.revision}`}
                  settings={config.storage}
                  onFeedback={setFeedback}
                />
              </div>
              <div className={cn('flex flex-col gap-6', active !== 'runtime' && 'hidden')}>
                <RuntimeSection
                  key={`runtime-${config.runtime.revision}`}
                  settings={config.runtime}
                  onFeedback={setFeedback}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
