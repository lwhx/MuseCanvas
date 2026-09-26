'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { api } from '@/shared/services/api'
import type { BuiltinProviderTemplate, ProviderCredentialInput } from '@/shared/types'
import {
  LEGACY_ADAPTER_OPTIONS,
  buildTemplateCredentialInput,
  parseServiceAccountJson,
} from '../lib/provider-templates'
import {
  Alert,
  Button,
  Dialog,
  FieldGroup,
  FormField,
  Input,
  Select,
  Textarea,
} from '@/shared/components/ui'

interface AdminProviderCredentialDialogProps {
  open: boolean
  onClose: () => void
  templates?: BuiltinProviderTemplate[]
  /** When set, the dialog is pinned to this plugin and hides both pickers. */
  lockedTemplate?: BuiltinProviderTemplate | null
  /**
   * Which credential family the dialog creates. `media` offers plugin-backed
   * credentials (plus legacy media adapters); `language` is the plugin-less
   * adapter + API key shape that language models bind to.
   */
  scope?: 'media' | 'language'
}

type Mode = 'template' | 'legacy'

/** Fields whose local validation failed; each message renders inside its `FormField`. */
type FieldKey = 'template' | 'displayName' | 'apiKey' | 'serviceAccount'
type FieldErrors = Partial<Record<FieldKey, string>>

/** A validation failure that belongs to one input, not to the dialog as a whole. */
interface FieldValidationError extends Error {
  field: FieldKey
}

function validationError(field: FieldKey, message: string): FieldValidationError {
  return Object.assign(new Error(message) as FieldValidationError, { field })
}

const MODE_OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: 'template', label: '内置插件', hint: '由供应商插件签发，可通过连通测试。' },
  { value: 'legacy', label: '自定义凭据', hint: '不绑定插件身份，按适配协议 + API Key 使用。' },
]

// Legacy (plugin-less) credentials remain the path for language models and
// custom endpoints; the API rejects any other adapter without plugin identity.
export function AdminProviderCredentialDialog({
  open,
  onClose,
  templates = [],
  lockedTemplate,
  scope = 'media',
}: AdminProviderCredentialDialogProps) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>(scope === 'language' ? 'legacy' : 'template')
  const [templateKey, setTemplateKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [serviceAccountRaw, setServiceAccountRaw] = useState('')
  const [adapter, setAdapter] = useState(LEGACY_ADAPTER_OPTIONS[scope][0].value)
  const [baseUrl, setBaseUrl] = useState('')
  const [actionError, setActionError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const legacyAdapters = LEGACY_ADAPTER_OPTIONS[scope]
  const template = scope === 'language'
    ? null
    : lockedTemplate ?? templates.find((t) => t.key === templateKey) ?? null
  const effectiveMode: Mode = scope === 'language' ? 'legacy' : (lockedTemplate ? 'template' : mode)
  const useServiceAccount = template?.credential.kind === 'google_service_account'

  function clearFieldError(field: FieldKey) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const resetFields = () => {
    setDisplayName('')
    setApiKey('')
    setServiceAccountRaw('')
    setBaseUrl('')
    setActionError('')
    setFieldErrors({})
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      setFieldErrors({})
      setActionError('')
      let body: ProviderCredentialInput
      if (effectiveMode === 'template') {
        if (!template) throw validationError('template', '请选择媒体插件。')
        if (template.credential.kind === 'google_service_account') {
          const parsed = parseServiceAccountJson(serviceAccountRaw)
          if (!parsed.ok) throw validationError('serviceAccount', parsed.error)
          body = buildTemplateCredentialInput(template, parsed.value, displayName)
        } else {
          if (!apiKey.trim()) throw validationError('apiKey', '请输入 API Key。')
          body = buildTemplateCredentialInput(template, apiKey.trim(), displayName)
        }
      } else {
        if (!displayName.trim()) throw validationError('displayName', '请输入凭据显示名称。')
        if (!apiKey.trim()) throw validationError('apiKey', '请输入 API Key。')
        body = { displayName: displayName.trim(), adapter, baseUrl: baseUrl.trim() || undefined, apiKey: apiKey.trim(), enabled: true }
      }
      const res = await api(API_ENDPOINTS.admin.providerCredentials, { method: 'POST', body })
      if (!res.success) throw new Error(res.error?.message || '创建凭据失败')
      return res.data
    },
    onSuccess: () => {
      resetFields()
      onClose()
      queryClient.invalidateQueries({ queryKey: ['admin', 'provider-credentials'] })
    },
    onError: (err: Error) => {
      const fieldError = err as Partial<FieldValidationError>
      if (fieldError.field) {
        // Inline only: the field says what is missing, so no dialog-level banner.
        const field = fieldError.field
        setFieldErrors((prev) => ({ ...prev, [field]: err.message }))
        setActionError('')
        return
      }
      setActionError(err.message || '创建凭据失败')
    },
  })

  const credentialFieldLabel = useServiceAccount
    ? template?.credential.label
    : (template?.credential.label ?? 'API Key')

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        effectiveMode === 'template'
          ? '从媒体插件创建凭据'
          : scope === 'language'
            ? '创建语言模型凭据'
            : '创建自定义凭据'
      }
      panelClassName="max-w-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={createMutation.isPending}
            disabled={effectiveMode === 'template' && !template}
            onClick={() => createMutation.mutate()}
          >
            保存凭据
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {actionError && (
          <Alert tone="danger" role="alert" title="无法创建凭据">
            {actionError}。请核对填写内容与供应商配置后重试；密钥无效时请重新获取 API Key。
          </Alert>
        )}

        {scope === 'media' && !lockedTemplate && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">凭据类型</legend>
            {/* Native radios + `accent-color`: keyboard, form semantics and the
                selected state come from the platform, not from aria-pressed. */}
            <div className="flex flex-wrap gap-2">
              {MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-[var(--control-md)] flex-1 cursor-pointer items-start gap-2 rounded-control px-3 py-1.5 text-sm text-foreground transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-tonal-hover"
                >
                  <input
                    type="radio"
                    name="credential-mode"
                    value={option.value}
                    checked={effectiveMode === option.value}
                    onChange={() => {
                      setMode(option.value)
                      setActionError('')
                    }}
                    className="mt-1 h-5 w-5 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <FieldGroup>
          {effectiveMode === 'template' && !lockedTemplate && (
            <FormField
              label="媒体插件"
              required
              error={fieldErrors.template}
              hint="凭据将绑定所选插件的身份，仅该插件的模型可以使用。"
            >
              <Select
                value={templateKey}
                onChange={(e) => {
                  setTemplateKey(e.target.value)
                  clearFieldError('template')
                }}
              >
                <option value="">请选择插件</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.displayName} · {t.pluginId}@{t.pluginVersion} · {t.modality === 'video' ? '视频' : '图像'}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          {effectiveMode === 'template' && template && (
            <div className="flex flex-col gap-1 rounded-control bg-tonal p-3 text-xs text-muted-foreground">
              <div className="font-mono text-foreground">
                {template.pluginId}@{template.pluginVersion}
              </div>
              <div>
                供应商 {template.providerId} · 凭据 {template.credential.schemaId}@{template.credential.schemaVersion}
              </div>
              <div className="break-all font-mono">{template.baseUrl}</div>
            </div>
          )}

          {effectiveMode === 'legacy' && (
            <div className="rounded-control bg-tonal p-3 text-xs text-muted-foreground">
              {scope === 'language' ? (
                <>
                  语言模型不使用供应商插件，凭据按{' '}
                  <span className="font-mono text-foreground">适配协议 + API Key</span> 与语言模型绑定。
                </>
              ) : (
                <>
                  自定义凭据不绑定插件身份，因此无法通过媒体凭据的连通测试；此类凭据列在
                  <span className="font-mono text-foreground">语言模型</span>
                  页的凭据列表中。
                </>
              )}
            </div>
          )}

          {effectiveMode === 'legacy' && (
            <FormField
              label="显示名称"
              required
              error={fieldErrors.displayName}
              hint="用于在模型配置中标识该凭据，例如供应商或用途。"
            >
              <Input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value)
                  clearFieldError('displayName')
                }}
                placeholder={scope === 'language' ? '例如：Anthropic 语言模型凭据' : '例如：自建 OpenAI 兼容端点'}
                autoComplete="off"
              />
            </FormField>
          )}

          {effectiveMode === 'legacy' && (
            <FormField label="适配协议" hint="决定请求与响应的解析方式，需与服务端接口一致。">
              <Select value={adapter} onChange={(e) => setAdapter(e.target.value)}>
                {legacyAdapters.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          {effectiveMode === 'legacy' && (
            <FormField
              label="Base URL（可选）"
              hint="留空时使用适配协议的默认端点；填写时请写到版本路径，例如 https://api.example.com/v1。"
            >
              <Input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
          )}

          {effectiveMode === 'template' && (
            <FormField
              label="显示名称（可选）"
              hint="留空时使用插件名称作为凭据显示名称。"
            >
              <Input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value)
                  clearFieldError('displayName')
                }}
                placeholder={template ? template.displayName : '默认使用插件名称'}
                autoComplete="off"
              />
            </FormField>
          )}

          {effectiveMode === 'legacy' ? (
            <FormField
              label="API Key"
              required
              error={fieldErrors.apiKey}
              hint="密钥以加密形式存储于服务端，保存后不再明文展示。"
            >
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  clearFieldError('apiKey')
                }}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
          ) : useServiceAccount ? (
            <FormField
              label={credentialFieldLabel ?? '服务账号 JSON'}
              required
              error={fieldErrors.serviceAccount}
              hint={template?.credential.helpText ?? '粘贴 Google 服务账号密钥文件内容，仅服务端解密使用。'}
              keepHintOnError
            >
              <Textarea
                value={serviceAccountRaw}
                onChange={(e) => {
                  setServiceAccountRaw(e.target.value)
                  clearFieldError('serviceAccount')
                }}
                rows={6}
                placeholder={template?.credential.placeholder}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </FormField>
          ) : (
            <FormField
              label={credentialFieldLabel ?? 'API Key'}
              required
              error={fieldErrors.apiKey}
              hint={template?.credential.helpText ?? '密钥以加密形式存储于服务端，保存后不再明文展示。'}
              keepHintOnError
            >
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  clearFieldError('apiKey')
                }}
                placeholder={template?.credential.placeholder ?? 'sk-...'}
                autoComplete="new-password"
                spellCheck={false}
              />
            </FormField>
          )}
        </FieldGroup>
      </div>
    </Dialog>
  )
}
