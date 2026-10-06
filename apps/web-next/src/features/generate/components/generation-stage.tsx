'use client'

import { useEffect, useState } from 'react'
import { ClockIcon, CropIcon, DownloadSimpleIcon, SparkleIcon } from '@phosphor-icons/react'
import { Alert, Button, EmptyState, Progress, Spinner, buttonVariants } from '@/shared/components/ui'
import { JobStatusBadge } from '@/shared/components/job-status-badge'
import { MediaFrame } from '@/shared/components/media-frame'
import { formatElapsed, isJobActive, phaseLabel } from '@/shared/lib/job-status'
import { cn } from '@/shared/lib/cn'
import { isVideoOutput, outputUrl } from '@/shared/types'
import type { GenerateModeTab, GenerationJob, GenerationOutput } from '@/shared/types'
import type { EditTarget } from '@/shared/stores/generate-ui-store'
import type { EditSelection } from '@musecanvas/contracts'
import { EditRegionStage } from './edit-region-stage'

export interface GenerationStageProps {
  tab: GenerateModeTab
  job: GenerationJob | null
  loading: boolean
  queryFailed: boolean
  onReload: () => void
  activeCount: number
  onOpenTasks: () => void
  outputIndex: number
  onOutputChange: (index: number) => void
  editTarget: EditTarget | null
  onSelectionChange: (selection: EditSelection | null) => void
  onExitEdit: () => void
  onStartEdit: (output: GenerationOutput) => void
  editBlockedReason: string | null
  busy: boolean
  modelAvailable: boolean
  onExample: (text: string) => void
  onReuse: (job: GenerationJob) => void
  reuseBlocked: boolean
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  pendingCancelId: string | null
  pendingRetryId: string | null
  actionError?: string
}

const EXAMPLES = {
  image: ['暖白色陶瓷花瓶，窗边柔和晨光，极简产品摄影', '山间小屋与薄雾，水彩插画，柔和的秋日色彩'],
  video: ['镜头缓慢推进晨雾中的森林，晨光穿透树叶，平稳运镜', '海浪轻拍沙滩，夕阳映照水面，固定镜头，宁静氛围'],
}

export function GenerationStage(props: GenerationStageProps) {
  const { job, editTarget, busy } = props
  const active = Boolean(job && isJobActive(job))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, job?.id])
  const outputs = job?.outputs ?? []
  const index = Math.max(0, Math.min(props.outputIndex, outputs.length - 1))
  const output = outputs[index]
  const video = output ? isVideoOutput(output) : false
  const phase = job?.cancelRequested ? '取消中' : job?.status === 'queued' ? '等待调度' : job?.status === 'retry_wait' ? '等待重试' : phaseLabel(job?.phase)
  const localEditReason = !output?.assetId ? '该产物缺少素材标识，无法局部修改。' : props.editBlockedReason

  return (
    <section aria-label="结果画布" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-sm font-medium text-foreground">{editTarget ? '局部修改' : props.tab === 'video' ? '视频创作' : '图像创作'}</h1>
          {!editTarget && job && <JobStatusBadge status={job.status} busy={active} />}
          {!editTarget && active && <span className="text-xs text-muted-foreground">{phase} · <span className="font-mono tabular-nums">{formatElapsed(job!, now)}</span></span>}
        </div>
        <Button variant="secondary" size="sm" onClick={props.onOpenTasks} icon={<ClockIcon weight="bold" aria-hidden="true" />}>
          任务 · {props.activeCount} 运行中
        </Button>
      </div>
      {props.queryFailed && (
        <Alert tone="warning" title={job ? '任务刷新失败，保留已加载结果' : '任务列表加载失败'} action={<Button variant="secondary" size="sm" onClick={props.onReload}>重载</Button>} />
      )}
      {!editTarget && job && (
        <details className="shrink-0 px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{job.modelName} · 查看本次提示词</summary>
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words py-2">{job.inputPrompt ?? job.prompt}</p>
        </details>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-card bg-tonal">
        {editTarget ? (
          <div inert={busy} aria-busy={busy} onKeyDownCapture={(event) => {
            if (event.key !== 'Escape' || busy) return
            event.preventDefault()
            event.stopPropagation()
            props.onSelectionChange(null)
          }} className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-3 [&>div]:min-h-0 [&>div]:flex-1 [&>div>div:first-child]:min-h-0 [&>div>div:first-child]:flex-1 [&>div>div:first-child]:max-h-none [&>div>div:first-child]:[aspect-ratio:auto!important]">
            <EditRegionStage src={editTarget.url} alt="局部修改源图" declaredWidth={editTarget.width} declaredHeight={editTarget.height} selection={editTarget.selection} onSelectionChange={props.onSelectionChange} />
          </div>
        ) : output && job?.status === 'succeeded' ? (
          <MediaFrame key={output.id} src={outputUrl(output)} kind={video ? 'video' : 'image'} alt={job.prompt} layout="stage" width={output.metadata.width} height={output.metadata.height} aspectRatio={output.metadata.aspectRatio} showControls={video} className="h-full w-full object-contain" />
        ) : active ? (
          <div className="flex max-h-full w-full max-w-lg flex-col items-center gap-3 overflow-y-auto p-4 text-center">
            <Spinner size="lg" label={phase} />
            <p className="text-sm font-medium text-foreground">{phase}</p>
            <Progress value={null} label="任务处理中" showLabelRow={false} className="w-full" />
            <p className="text-xs text-muted-foreground">已耗时 {formatElapsed(job!, now)} · 可继续准备下一次创作，任务在后台执行。</p>
          </div>
        ) : job?.status === 'failed' ? (
          <div className="max-h-full overflow-y-auto p-4"><EmptyState variant="error" title="生成失败" description={job.errorMessage ?? job.errorCode ?? '生成服务未能完成任务，请重试或使用配置调整草稿。'} /></div>
        ) : job?.status === 'canceled' ? (
          <div className="max-h-full overflow-y-auto p-4"><EmptyState variant="no-results" title="任务已取消" description="本次任务已结束。使用这次配置可重新准备草稿，不会自动提交。" /></div>
        ) : job ? (
          <div className="max-h-full overflow-y-auto p-4"><EmptyState variant="no-results" title="暂无可展示的产物" description="可重载任务列表，或使用这次配置重新准备草稿。" action={<Button variant="secondary" size="sm" onClick={props.onReload}>重载任务</Button>} /></div>
        ) : props.loading ? (
          <Spinner label="加载任务中" />
        ) : (
          <div className="flex max-h-full max-w-lg flex-col items-center gap-4 overflow-y-auto p-4 text-center md:p-6">
            <SparkleIcon weight="duotone" aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-module text-foreground">让想法成为画面</h2>
            <p className="text-sm text-muted-foreground">{props.modelAvailable ? '在下方描述画面，选择模型，再主动提交。也可从示例开始。' : '当前没有可用模型，请先配置模型；下方保留你的创作草稿。'}</p>
            {props.modelAvailable && <div className="flex w-full flex-col gap-2">{EXAMPLES[props.tab].map((text) => <Button key={text} variant="secondary" size="sm" disabled={busy} className="whitespace-normal text-left" onClick={() => props.onExample(text)}>{text}</Button>)}</div>}
          </div>
        )}
      </div>
      {editTarget ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">源图保持不变 · 框选区域后填写修改指令</p>
          <Button variant="secondary" size="sm" disabled={busy} onClick={props.onExitEdit}>退出局部修改</Button>
        </div>
      ) : job ? (
        <div className="flex shrink-0 flex-col gap-2">
          {outputs.length > 1 && <div aria-label="切换产物" className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="shrink-0 text-xs text-muted-foreground">第 {index + 1} / 共 {outputs.length} 个</span>
            {outputs.map((item, itemIndex) => <button key={item.id} type="button" aria-label={`查看第 ${itemIndex + 1} 个产物`} aria-pressed={index === itemIndex} onClick={() => props.onOutputChange(itemIndex)} className={cn('h-10 w-10 shrink-0 overflow-hidden rounded-control border-2', index === itemIndex ? 'border-primary' : 'border-transparent')}><MediaFrame src={outputUrl(item)} kind={isVideoOutput(item) ? 'video' : 'image'} alt="" layout="thumb" /></button>)}
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy || props.reuseBlocked} onClick={() => props.onReuse(job)}>使用这次配置</Button>
            {active && <Button variant="danger-ghost" size="sm" disabled={busy || Boolean(job.cancelRequested) || props.pendingCancelId !== null} loading={props.pendingCancelId === job.id} onClick={() => props.onCancel(job.id)}>{job.cancelRequested ? '取消中' : '取消任务'}</Button>}
            {job.status === 'failed' && <Button variant="secondary" size="sm" disabled={busy || props.pendingRetryId !== null} loading={props.pendingRetryId === job.id} onClick={() => props.onRetry(job.id)}>重试原任务</Button>}
            {output && job.status === 'succeeded' && <>
              {!video && <Button variant="secondary" size="sm" disabled={busy || Boolean(localEditReason)} onClick={() => props.onStartEdit(output)} icon={<CropIcon weight="bold" aria-hidden="true" />}>局部修改</Button>}
              <a href={output.downloadUrl || outputUrl(output)} download target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm' })}><DownloadSimpleIcon weight="bold" aria-hidden="true" />{video ? '下载视频' : '下载原图'}</a>
            </>}
          </div>
          {!video && output && localEditReason && <p className="text-xs text-muted-foreground">{localEditReason}</p>}
          {props.reuseBlocked && <p className="text-xs text-muted-foreground">输入图片上传或校验中，完成后可使用历史配置。</p>}
          {props.actionError && <p role="alert" className="text-xs text-danger">{props.actionError}</p>}
        </div>
      ) : null}
    </section>
  )
}
