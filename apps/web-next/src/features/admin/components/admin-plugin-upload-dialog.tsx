'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import type {
  AdminPluginScanFinding,
  AdminPluginUploadResponse,
  AdminPluginValidateSuccess,
  PluginKind,
} from '@/shared/types'
import { PLUGIN_ARTIFACT_MAX_BYTES, humanFileSize, postPluginPackage, shortDigest } from '../lib/plugin-upload'
import { ShieldAlert } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  FileDropZone,
  FormField,
  Spinner,
  Textarea,
} from '@/shared/components/ui'
import type { DropZoneFile } from '@/shared/components/ui'

/** The drop zone holds at most one artifact; a stable id keeps its row keyed. */
const ARTIFACT_FILE_ID = 'plugin-artifact'

/**
 * Manifest prefills. Field names follow `validatePluginManifest` in
 * packages/providers/src/core/plugin-scan.ts (id ^[a-z][a-z0-9-]{1,40}$, version
 * semver x.y.z, non-empty allowedHosts / credentialSchemas / models, and per-kind
 * modalities / languageProtocols). The server validates; this is only a starting draft.
 */
const MANIFEST_TEMPLATES: Record<PluginKind, string> = {
  media: JSON.stringify(
    {
      kind: 'media',
      id: 'my-media-plugin',
      version: '1.0.0',
      displayName: '示例媒体插件',
      description: '请替换为真实插件清单',
      modalities: ['image'],
      allowedHosts: ['api.example.com'],
      credentialSchemas: ['legacy-api-key-v1'],
      models: [{ id: 'example-model', name: '示例模型', modalities: ['image'] }],
    },
    null,
    2,
  ),
  language: JSON.stringify(
    {
      kind: 'language',
      id: 'my-language-plugin',
      version: '1.0.0',
      displayName: '示例语言插件',
      description: '请替换为真实插件清单',
      languageProtocols: ['openai_chat'],
      allowedHosts: ['api.example.com'],
      credentialSchemas: ['legacy-api-key-v1'],
      models: [{ id: 'example-model', name: '示例模型' }],
    },
    null,
    2,
  ),
}

/** Worker reloads the catalog on a 5s maintenance tick; debounce typing bursts well below that. */
const VALIDATE_DEBOUNCE_MS = 400

type ValidatePhase = 'idle' | 'checking' | 'ready' | 'rejected' | 'error'

interface ValidateState {
  phase: ValidatePhase
  findings: AdminPluginScanFinding[]
  summary: AdminPluginValidateSuccess | null
  message: string
}

const IDLE: ValidateState = { phase: 'idle', findings: [], summary: null, message: '' }

interface AdminPluginUploadDialogProps {
  open: boolean
  onClose: () => void
  /** Which kernel the uploaded package targets; seeds the manifest prefill. */
  kind: PluginKind
  /** Called after a successful install so the parent can announce the `待加载` handshake. */
  onInstalled?: (plugin: { pluginId: string; pluginVersion: string }) => void
}

/** One scan finding: severity as text + Badge, never colour alone. */
function FindingList({ findings }: { findings: AdminPluginScanFinding[] }) {
  if (findings.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <li
          key={`${f.rule}-${f.line ?? 'x'}-${i}`}
          className={`flex flex-wrap items-start gap-2 rounded-control p-2 text-xs ${
            f.severity === 'error' ? 'bg-danger-soft text-danger' : 'bg-tonal text-muted-foreground'
          }`}
        >
          {/* 严重级别以文字呈现，不依赖颜色区分 */}
          <Badge tone={f.severity === 'error' ? 'danger' : 'warning'} className="shrink-0">
            {f.severity === 'error' ? '错误' : '警告'}
          </Badge>
          <span className="font-mono">{f.rule}</span>
          {typeof f.line === 'number' && <span className="font-mono tabular-nums">第 {f.line} 行</span>}
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  )
}

export function AdminPluginUploadDialog({ open, onClose, kind, onInstalled }: AdminPluginUploadDialogProps) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [manifestText, setManifestText] = useState(MANIFEST_TEMPLATES[kind])
  const [validate, setValidate] = useState<ValidateState>(IDLE)

  const resetFields = () => {
    setFile(null)
    setManifestText(MANIFEST_TEMPLATES[kind])
    setValidate(IDLE)
  }

  const close = () => {
    resetFields()
    onClose()
  }

  // Pre-flight: whenever a file and a manifest are present, re-run POST admin/plugins/validate
  // (scan-only, writes nothing) so the admin sees findings before installing. Stale responses
  // are dropped via the AbortController owned by this effect run.
  useEffect(() => {
    if (!open) return
    if (!file || !manifestText.trim()) {
      setValidate(IDLE)
      return
    }
    if (!file.name.endsWith('.mjs')) {
      setValidate({ ...IDLE, phase: 'error', message: '插件包必须是单个 .mjs 文件（服务端同样强制）' })
      return
    }
    if (file.size > PLUGIN_ARTIFACT_MAX_BYTES) {
      setValidate({
        ...IDLE,
        phase: 'error',
        message: `插件包不能超过 ${PLUGIN_ARTIFACT_MAX_BYTES} 字节（5 MB，上限由服务端强制）`,
      })
      return
    }
    const controller = new AbortController()
    setValidate({ ...IDLE, phase: 'checking' })
    const timer = setTimeout(async () => {
      const res = await postPluginPackage<AdminPluginValidateSuccess | { ok: false; installed: false; code: string; findings: AdminPluginScanFinding[] }>(
        API_ENDPOINTS.admin.pluginValidate,
        manifestText,
        file,
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (!res.success) {
        setValidate({ ...IDLE, phase: 'error', message: `${res.error?.code ?? 'ERROR'}：${res.error?.message ?? '校验请求失败'}` })
        return
      }
      const data = res.data
      if (data && data.ok === true) {
        setValidate({ phase: 'ready', findings: data.warnings, summary: data, message: '' })
      } else if (data) {
        // HTTP 422 arrives with a success:true envelope (server `rejected()` wraps `ok()`),
        // so findings live on res.data, not res.error.
        setValidate({ phase: 'rejected', findings: data.findings, summary: null, message: `服务端拒绝：${data.code}` })
      } else {
        setValidate({ ...IDLE, phase: 'error', message: '校验响应缺少数据' })
      }
    }, VALIDATE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, file, manifestText])

  const installMutation = useMutation({
    mutationFn: async (artifact: { file: File; manifest: string }) =>
      postPluginPackage<AdminPluginUploadResponse>(API_ENDPOINTS.admin.pluginUpload, artifact.manifest, artifact.file),
    onSuccess: (res) => {
      if (!res.success) {
        // fail() envelope: PLUGIN_UPLOAD_DISABLED / PLUGIN_VERSION_IMMUTABLE /
        // PLUGIN_ID_RESERVED / INVALID_INPUT / PLUGIN_ARTIFACT_TOO_LARGE / NETWORK_ERROR…
        setValidate({ ...IDLE, phase: 'error', message: `${res.error?.code ?? 'ERROR'}：${res.error?.message ?? '上传请求失败'}` })
        return
      }
      const data = res.data
      if (data && data.installed === true) {
        // The row was created with status='pending'; it goes live only after the
        // worker pulls, verifies and re-scans the artifact on its maintenance tick.
        queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] })
        onInstalled?.({ pluginId: data.plugin.pluginId, pluginVersion: data.plugin.pluginVersion })
        close()
        return
      }
      if (data) {
        setValidate({ phase: 'rejected', findings: data.findings, summary: null, message: `服务端拒绝：${data.code}` })
      } else {
        setValidate({ ...IDLE, phase: 'error', message: '上传响应缺少数据' })
      }
    },
    onError: (err: Error) => {
      setValidate({ ...IDLE, phase: 'error', message: err.message || '上传请求失败' })
    },
  })

  const blockingFindings = validate.findings.some((f) => f.severity === 'error')
  const canSubmit =
    !!file &&
    !!manifestText.trim() &&
    (validate.phase === 'ready' || validate.phase === 'rejected') &&
    !blockingFindings &&
    !installMutation.isPending

  // One selected artifact, mirrored into the shared drop zone's file row. No byte
  // progress is available from `postPluginPackage`, so no percentage is claimed:
  // the install button carries the busy state instead.
  const artifactFiles: DropZoneFile[] = file
    ? [{ id: ARTIFACT_FILE_ID, name: file.name, size: file.size }]
    : []

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`上传${kind === 'media' ? '媒体' : '语言'}插件`}
      panelClassName="max-w-dialog-wide"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button
            loading={installMutation.isPending}
            disabled={!canSubmit}
            onClick={() => file && installMutation.mutate({ file, manifest: manifestText })}
          >
            安装插件
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Risk disclosure — deliberately first-class content, not fine print. */}
        <Alert
          tone="danger"
          icon={<ShieldAlert aria-hidden="true" />}
          title="上传前必读"
        >
          <div className="flex flex-col gap-2">
            <p>
              上传的插件代码会由 Worker 进程<strong>以该进程的全部权限直接执行</strong>（可读写任务数据、访问已配置的供应商凭据与网络）。
              仅允许受信任的管理员上传，请勿加载任何来源不明的 <code className="font-mono">.mjs</code> 文件。
            </p>
            <p>
              <strong>同版本不可覆盖，升级版本号后重新上传</strong>：插件以 <code className="font-mono">pluginId@pluginVersion</code>{' '}
              为一次性写入身份，Worker 的注册表与模块缓存都以该身份为键，同版本热替换不会生效，服务端会直接拒绝（PLUGIN_VERSION_IMMUTABLE）。
            </p>
          </div>
        </Alert>

        <FileDropZone
          files={artifactFiles}
          onFilesSelected={(files) => setFile(files[0] ?? null)}
          onRemove={() => setFile(null)}
          accept=".mjs,application/javascript,text/javascript"
          maxFileSize={PLUGIN_ARTIFACT_MAX_BYTES}
          maxFiles={1}
          label="拖拽 .mjs 插件包到此处，或点击选择文件"
          hint={`单个 .mjs 文件，大小上限 5 MB（${PLUGIN_ARTIFACT_MAX_BYTES.toLocaleString('en-US')} 字节），以服务端强制为准。`}
        />

        <FormField
          label="插件清单 manifest（JSON）"
          required
          hint="manifest 的 id / version 必须与插件包内注册的插件一致；字段规则由服务端校验。"
        >
          <Textarea
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            rows={10}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </FormField>

        {/* aria-live region: pre-flight verdict + findings update without a click. */}
        <div aria-live="polite" role="status" className="flex flex-col gap-2">
          {validate.phase === 'checking' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner label="正在校验" />
              正在服务端扫描插件包与清单（不落库）…
            </p>
          )}
          {validate.phase === 'error' && (
            <Alert tone="danger" role="alert" title="无法完成预检">
              {validate.message}。请更换插件包文件或修正清单内容后重试。
            </Alert>
          )}
          {validate.phase === 'rejected' && (
            <div className="flex flex-col gap-2">
              <Alert tone="danger" role="alert" title="服务端拒绝该插件包">
                {validate.message}。请按下列发现修正文件或清单后，以新的版本号重新上传。
              </Alert>
              <FindingList findings={validate.findings} />
            </div>
          )}
          {validate.phase === 'ready' && validate.summary && (
            <div className="flex flex-col gap-2">
              <Alert tone="success" title="校验通过">
                插件包与清单已通过服务端扫描，可以安装插件。
              </Alert>
              <div className="flex flex-col gap-1 rounded-control bg-tonal p-3 text-xs text-muted-foreground">
                <span className="font-mono text-foreground">
                  {validate.summary.pluginId}@{validate.summary.pluginVersion}
                </span>
                <span>
                  {validate.summary.displayName} · {validate.summary.modelIds.length} 个模型 · 制品 sha256{' '}
                  <span className="font-mono text-foreground" title={validate.summary.artifactDigest}>
                    {shortDigest(validate.summary.artifactDigest)}
                  </span>{' '}
                  · {humanFileSize(validate.summary.artifactSizeBytes)}
                </span>
              </div>
              {validate.summary.warnings.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">警告（不阻断安装，但请确认符合预期）：</p>
                  <FindingList findings={validate.summary.warnings} />
                </div>
              )}
            </div>
          )}
          {validate.phase === 'idle' && (
            <p className="text-xs text-muted-foreground">选择插件包文件后将自动进行服务端预检。</p>
          )}
        </div>

        {blockingFindings && (
          <Alert tone="danger" role="alert" title="无法安装插件">
            存在错误级别的扫描发现，安装已被阻止。请按下列发现修正插件包后重新上传。
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          安装成功后插件状态为「待加载」：需等待 Worker 拉取制品、核验 sha256 并重新扫描通过后才会启用，安装完成不代表即时生效。
        </p>
      </div>
    </Dialog>
  )
}
