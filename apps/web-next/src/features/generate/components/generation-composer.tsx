'use client'

import { useEffect, useRef } from 'react'
import { CaretDownIcon, CaretUpIcon, SparkleIcon } from '@phosphor-icons/react'
import { Alert, Button, Select } from '@/shared/components/ui'
import { cn } from '@/shared/lib/cn'
import type { GenerateModeTab, ModelConfig } from '@/shared/types'
import type { ParameterCarrier, ParameterState, ParameterValue } from '@/shared/lib/media-parameters'
import type { ImageInputPlan } from '@/shared/lib/generation-params'
import { MediaParameterControls } from './media-parameter-controls'
import { ReferenceImagesTrigger } from './reference-images-trigger'

export interface GenerationComposerProps {
  prompt: string
  onPromptChange: (text: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  tab: GenerateModeTab
  editing: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  busy: boolean
  models: ModelConfig[]
  modelId: string
  model: ModelConfig | undefined
  parameterModel: ParameterCarrier | null | undefined
  values: ParameterState
  onModelChange: (id: string) => void
  onParameterChange: (name: string, value: ParameterValue) => void
  modelsLoading: boolean
  modelStatus: string | null
  modelsFailed: boolean
  onReloadModels: () => void
  inputPlan: ImageInputPlan
  blockedReason: string | null
  error: string
  notice: string
  onSubmit: () => void
}

export function GenerationComposer(props: GenerationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [props.prompt, props.expanded])

  return (
    <section aria-label="创作草稿" className={cn('flex min-h-0 shrink-0 flex-col gap-2 rounded-card bg-surface p-3 shadow-soft pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4', props.expanded ? 'max-h-[65%] md:max-h-[50%]' : 'max-h-[50%] md:max-h-[45%]')}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-foreground">{props.editing ? '修改指令' : '创作草稿'}</h2>
          <p className="truncate text-xs text-muted-foreground md:hidden">{props.prompt.trim() || '写下你想创作的画面'} · {props.model?.displayName ?? '未选择模型'}</p>
        </div>
        <Button variant="ghost" size="sm" aria-expanded={props.expanded} aria-controls="generation-composer-fields" onClick={() => props.onExpandedChange(!props.expanded)} icon={props.expanded ? <CaretDownIcon weight="bold" aria-hidden="true" /> : <CaretUpIcon weight="bold" aria-hidden="true" />}>
          <span className="md:hidden">{props.expanded ? '收起创作区' : '展开创作区'}</span>
          <span className="hidden md:inline">{props.expanded ? '收起输入' : '展开输入'}</span>
        </Button>
      </div>
      <div id="generation-composer-fields" className={cn('min-h-0 overflow-y-auto', !props.expanded && 'hidden md:block')}>
        <fieldset disabled={props.busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          {props.editing ? <p className="text-xs text-muted-foreground">当前输入只用于修改框选区域。已暂存的参考图不会用于局部修改，退出后仍可使用。</p> : <div className="flex flex-wrap items-center gap-2"><ReferenceImagesTrigger model={props.model} plan={props.inputPlan} disabled={props.busy} /></div>}
          <div className="flex flex-col gap-1">
            <label htmlFor="generate-prompt" className="text-xs text-muted-foreground">{props.editing ? '修改指令' : '提示词'}</label>
            <textarea ref={textareaRef} id="generate-prompt" rows={2} value={props.prompt} disabled={props.busy} onChange={(event) => props.onPromptChange(event.target.value)} onKeyDown={props.onKeyDown} placeholder={props.editing ? '例如：将框选区域改为红色风衣，其余保持不变…' : props.tab === 'video' ? '描述主体、动作、镜头与氛围…' : '描述主体、场景、光线与风格…'} aria-describedby="generate-prompt-help" className={cn('w-full resize-none rounded-control border border-border-control bg-transparent p-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground', props.expanded ? 'max-h-56' : 'max-h-28')} />
            <p id="generate-prompt-help" className="text-xs text-muted-foreground">Ctrl/⌘ + Enter 提交 · 查看历史不会覆盖这份草稿</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="generate-model" className="text-overline text-muted-foreground">模型</label>
              <Select id="generate-model" size="sm" width="content" className="max-w-full" value={props.modelId} onChange={(event) => props.onModelChange(event.target.value)} disabled={props.busy || props.modelsLoading || props.models.length === 0} aria-describedby={props.modelStatus ? 'generate-model-status' : undefined}>
                {props.modelsLoading && <option value="">加载模型中…</option>}
                {props.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.deprecated ? `（已弃用${model.deprecationNote ? `：${model.deprecationNote}` : ''}）` : ''}</option>)}
                {!props.modelsLoading && props.models.length === 0 && <option value="">尚未配置{props.tab === 'video' ? '视频' : '图像'}模型</option>}
              </Select>
            </div>
            <MediaParameterControls model={props.parameterModel} values={props.values} onChange={props.onParameterChange} countUnit={props.tab === 'video' ? ' 条' : ' 张'} disabled={props.busy} />
            {props.editing && <div className="flex flex-col gap-1 text-xs text-muted-foreground"><span>尺寸</span><span>按源图比例自动</span></div>}
          </div>
        </fieldset>
      </div>
      {(props.modelStatus || props.error || props.notice) && (
        <div role="region" aria-label="创作反馈" tabIndex={0} className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-2">
            {props.modelStatus && <p id="generate-model-status" role={props.modelsFailed ? 'alert' : 'status'} className="text-xs text-muted-foreground">{props.modelStatus}{props.modelsFailed && <button type="button" onClick={props.onReloadModels} className="ml-2 underline underline-offset-2">重载模型</button>}</p>}
            {props.error && <Alert tone="danger" role="alert" title="无法开始生成">{props.error}</Alert>}
            {props.notice && <p role="status" className="text-xs text-muted-foreground">{props.notice}</p>}
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {props.blockedReason && <p id="generate-submit-blocker" role="status" className="min-w-0 flex-1 break-words text-xs text-muted-foreground">{props.blockedReason}</p>}
        <Button variant="primary" onClick={props.onSubmit} disabled={Boolean(props.blockedReason) || props.busy} loading={props.busy} aria-describedby={props.blockedReason ? 'generate-submit-blocker' : undefined} icon={<SparkleIcon weight="bold" aria-hidden="true" />}>
          {props.editing ? '提交局部修改' : '立即生成'}
        </Button>
      </div>
    </section>
  )
}
