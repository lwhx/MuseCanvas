'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { editSelectionIsUsable } from '@musecanvas/contracts'
import { useGenerateUiStore } from '@/shared/stores/generate-ui-store'
import { useModelsQuery } from '@/shared/hooks/useModels'
import { useJobsQuery, useCreateJob, useCancelJob, useRetryJob } from '@/shared/hooks/useJobs'
import { useCreateImageEdit } from '../lib/use-image-edit'
import { maskCapabilityBlockReason, modelAcceptsMask } from '@/shared/lib/model-capabilities'
import {
  buildGenerationInputs,
  inputPlanViolations,
  resolveImageInputPlan,
} from '@/shared/lib/generation-params'
import {
  buildMediaParameters,
  canonicalNameOf,
  descriptorLabel,
  parameterIssues,
  reconcileModelParameters,
} from '@/shared/lib/media-parameters'
import { clearReferenceImages, reconcileStagedRoles } from '@/shared/lib/reference-upload'
import { GENERATE_ROUTE } from '@/shared/lib/app-routes'
import { MediaFrame, stageAspectRatio } from '@/shared/components/media-frame'
import { JobStatusBadge } from '@/shared/components/job-status-badge'
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  IconButton,
  PageHeader,
  Progress,
  Select,
  SkeletonRow,
  SkeletonTile,
  Spinner,
  buttonVariants,
} from '@/shared/components/ui'
import { cn } from '@/shared/lib/cn'
import { isJobActive } from '@/shared/lib/job-status'
import { isVideoOutput, modelMediaKind, outputUrl } from '@/shared/types'
import type {
  CreateGenerationRequest,
  GenerateModeTab,
  GenerationJob,
  GenerationOutput,
  MediaKind,
} from '@/shared/types'
import { EditRegionStage } from './edit-region-stage'
import { MediaParameterControls } from './media-parameter-controls'
import { ReferenceImagesTrigger } from './reference-images-trigger'
import { ActiveJobsBoard } from './active-jobs-board'
import {
  ChevronRight,
  Clock,
  Crop,
  Download,
  ImageOff,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'

/** `?tab=` accepts only the two kinds; anything else (typo, stale bookmark) is image. */
function readTabParam(value: string | null): GenerateModeTab {
  return value === 'video' ? 'video' : 'image'
}

/** The DTO has no `modelKind` on a job row, so the kind comes from `mediaKind`
 *  first and from the emitted outputs as a fallback. */
function jobMediaKind(job: GenerationJob): MediaKind {
  if (job.mediaKind === 'video') return 'video'
  if (job.mediaKind === 'image') return 'image'
  return (job.outputs ?? []).some((output) => isVideoOutput(output)) ? 'video' : 'image'
}

/** Numeric aspect ratio of an output, reusing the stage box's own resolution
 *  order (real pixels, then the declared ratio, then 16:9). */
function outputRatio(output: GenerationOutput | undefined): number {
  const css = stageAspectRatio(
    output?.metadata.aspectRatio,
    output?.metadata.width,
    output?.metadata.height,
  )
  const [w, h] = css.split('/').map((part: string) => Number(part.trim()))
  return w && h && h > 0 ? w / h : 16 / 9
}

/** One key per submit *attempt*, so a double-fired request collapses into one job
 *  on the server while a deliberate resubmit after a failure is a new job. */
function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function GenerateConsole() {
  const prompt = useGenerateUiStore((s) => s.prompt)
  const activeTab = useGenerateUiStore((s) => s.activeTab)
  const selectedModelIdByKind = useGenerateUiStore((s) => s.selectedModelIdByKind)
  const paramsByKind = useGenerateUiStore((s) => s.paramsByKind)
  const selectedJobId = useGenerateUiStore((s) => s.selectedJobId)
  // One object reference, so a staged-upload progress tick (which rewrites
  // `stagedImages`, never this) cannot re-render the console out of edit mode.
  const editTarget = useGenerateUiStore((s) => s.editTarget)
  const stagedOrder = useGenerateUiStore((s) =>
    s.stagedImages.map((image) => image.localId).join('|'),
  )
  const setPrompt = useGenerateUiStore((s) => s.setPrompt)
  const setActiveTab = useGenerateUiStore((s) => s.setActiveTab)
  const setSelectedModelId = useGenerateUiStore((s) => s.setSelectedModelId)
  const setParam = useGenerateUiStore((s) => s.setParam)
  const replaceParams = useGenerateUiStore((s) => s.replaceParams)
  const setSelectedJobId = useGenerateUiStore((s) => s.setSelectedJobId)
  const setEditTarget = useGenerateUiStore((s) => s.setEditTarget)
  const setEditSelection = useGenerateUiStore((s) => s.setEditSelection)
  // Derived primitives, so upload progress ticks never re-render this console.
  const isPreparingReferences = useGenerateUiStore((s) => s.isPreparingReferences)
  const isReferenceUploadBusy = useGenerateUiStore((s) =>
    s.stagedImages.some((image) => image.status === 'pending' || image.status === 'uploading' || image.status === 'processing'),
  )
  const hasReferenceUploadError = useGenerateUiStore((s) =>
    s.stagedImages.some((image) => image.status === 'error'),
  )

  const router = useRouter()
  const searchParams = useSearchParams()

  const {
    data: models,
    isLoading: modelsLoading,
    isError: modelsQueryFailed,
    error: modelsQueryError,
    refetch: refetchModels,
  } = useModelsQuery()
  const {
    data: jobs = [],
    isLoading: jobsLoading,
    isError: jobsError,
    refetch: refetchJobs,
  } = useJobsQuery(30)

  const createJobMutation = useCreateJob()
  const cancelJobMutation = useCancelJob()
  const retryJobMutation = useRetryJob()
  const editMutation = useCreateImageEdit()

  const railOpen = useGenerateUiStore((s) => s.railOpen)
  const activeBoardOpen = useGenerateUiStore((s) => s.activeBoardOpen)
  const historyOpen = useGenerateUiStore((s) => s.historyOpen)
  const setRailOpen = useGenerateUiStore((s) => s.setRailOpen)
  const setActiveBoardOpen = useGenerateUiStore((s) => s.setActiveBoardOpen)
  const setHistoryOpen = useGenerateUiStore((s) => s.setHistoryOpen)

  const [errorMessage, setErrorMessage] = useState('')
  // The last `?tab=` value this mount has already honoured. A `tab`-less URL
  // never lands here, so this only ever holds `undefined` or a string.
  const consumedTabParamRef = useRef<string | undefined>(undefined)

  // GET /api/models returns image AND video models: each tab may only drive its
  // own kind, otherwise a video model gets auto-selected into the image flow.
  const imageModels = useMemo(
    () => (models ?? []).filter((model) => modelMediaKind(model) !== 'video'),
    [models],
  )
  const videoModels = useMemo(
    () => (models ?? []).filter((model) => modelMediaKind(model) === 'video'),
    [models],
  )
  const isVideoTab = activeTab === 'video'
  // Deprecated models sort last. The first entry is what a fresh session falls
  // back to, so a vendor-retired model must never occupy the recommended slot;
  // within each group the admin's own `sort_order` still decides, because this
  // is a presentation rule and not a re-ranking of the catalogue.
  const tabModels = useMemo(() => {
    const list = isVideoTab ? videoModels : imageModels
    return [...list].sort((left, right) => Number(left.deprecated === true) - Number(right.deprecated === true))
  }, [isVideoTab, videoModels, imageModels])

  const storedModelId = selectedModelIdByKind[activeTab]
  // Same id and still offered -> keep it; otherwise fall back to the first model
  // of *this* kind. Never across kinds.
  const activeModelId = tabModels.some((model) => model.id === storedModelId)
    ? storedModelId
    : tabModels[0]?.id ?? ''
  const currentModel = tabModels.find((model) => model.id === activeModelId)
  const params = paramsByKind[activeTab]
  const inputPlan = useMemo(() => resolveImageInputPlan(currentModel), [currentModel])
  const referencePlanBlocker = useGenerateUiStore((s) =>
    s.stagedImages.length > 0 ? inputPlanViolations(s.stagedImages, inputPlan)[0] ?? null : null,
  )
  // Computed, never stored: this runs the same validator the API runs, so an
  // enabled submit button and an acceptable request are the same claim rather
  // than two lists that can disagree.
  const parameterProblems = useMemo(() => parameterIssues(currentModel, params), [currentModel, params])
  // One noun for the staged-image surface: frame slots stop calling them references.
  const inputNoun = inputPlan.slots.some(
    (slot) => slot.role === 'first_frame' || slot.role === 'last_frame',
  )
    ? '输入画面'
    : '参考图'

  /**
   * `?tab=` is a one-shot deep link into the mode, not a record of it: the
   * header owns switching now and writes the store directly.
   *
   * Two details make that safe. The guard is keyed on the consumed *raw value*
   * rather than "the mode we last applied", and `activeTab` stays out of the
   * dependency list — otherwise clicking 作图 while the URL still said
   * `tab=video` would be bounced straight back to video. And once consumed, the
   * param is dropped: a bookmark that keeps saying `video` after the user chose
   * 作图 would resurrect video on the next reload.
   */
  useEffect(() => {
    const raw = searchParams.get('tab')
    if (raw === null) return
    if (consumedTabParamRef.current === raw) return
    consumedTabParamRef.current = raw
    setActiveTab(readTabParam(raw))
    router.replace(GENERATE_ROUTE, { scroll: false })
  }, [router, searchParams, setActiveTab])

  // Persist the resolved fallback so an admin rename/removal cannot silently
  // jump the selection mid-session. Writing it is what ends the loop: the next
  // run sees `storedModelId === activeModelId` and returns.
  useEffect(() => {
    if (!activeModelId) return
    if (storedModelId === activeModelId) return
    setSelectedModelId(activeTab, activeModelId)
  }, [activeTab, activeModelId, storedModelId, setSelectedModelId])

  // Reconcile the parameter picks whenever the selected model changes: anything
  // the new contract does not accept is dropped, so the controls on screen agree
  // with the request about to be built. The sparse map handles a *missing* value
  // (absent key means descriptor default) but not a *stale* one, and without this
  // a `quality=max` chosen on a 2.5 model would still be sent after switching to
  // a model that has no such rung.
  //
  // Idempotent by construction — once the map is reconciled the comparison below
  // holds and nothing is written again, so this cannot cycle.
  useEffect(() => {
    if (!currentModel) return
    const previous = paramsByKind[activeTab]
    const reconciled = reconcileModelParameters(currentModel, previous)
    const entries = Object.entries(reconciled)
    const unchanged = entries.length === Object.keys(previous).length
      && entries.every(([key, value]) => previous[key] === value)
    if (unchanged) return
    replaceParams(activeTab, reconciled)
  }, [currentModel, activeTab, paramsByKind, replaceParams])

  // Frame roles are positional, so every staging change (add / remove / reorder /
  // model or tab switch) re-derives them. `stagedOrder` is a joined string and the
  // reconciliation itself is a no-op once the roles match, so this cannot cycle.
  useEffect(() => {
    if (!stagedOrder) return
    void reconcileStagedRoles(currentModel)
  }, [stagedOrder, currentModel])

  // Find currently selected or running job
  const selectedJob = jobs.find((j) => j.id === selectedJobId) || jobs[0] || null
  const selectedJobActive = selectedJob ? isJobActive(selectedJob) : false
  const stageOutputs = selectedJob?.outputs ?? []
  const stageIsVideo = selectedJob ? jobMediaKind(selectedJob) === 'video' : false
  // A lone 16:9 clip at `max-w-lg` is ~288px tall against a ~512px square
  // render, so a wide single output gets a wider box to carry the same weight.
  // Portrait deliberately keeps `max-w-lg`: the stage box now follows the
  // media's own ratio, and 9:16 at `max-w-3xl` would stand ~1365px tall.
  const singleOutputClass =
    stageOutputs.length === 1 && outputRatio(stageOutputs[0]) >= 1.5
      ? 'grid-cols-1 max-w-3xl mx-auto'
      : 'grid-cols-1 max-w-lg mx-auto'

  // 局部修改 is an image feature, so the video tab can never be the one driving it:
  // `params` and `currentModel` are read for whichever tab is live, and an edit has
  // to be built from the image model's contract.
  const editing = activeTab === 'image' && editTarget !== null
  // Computed, never stored: an incapable model is refused at both entry points *and*
  // at submit, and a request is never downgraded to a whole-image edit.
  const maskCapable = modelAcceptsMask(currentModel)
  const maskBlockedReason = maskCapabilityBlockReason(currentModel)
  const editSelectionReady = editSelectionIsUsable(editTarget?.selection ?? null)
  // The descriptor set an edit can actually be built from. `POST /api/images/edit`
  // carries `modelId`, `prompt`, `quality` and the region — no `size` (the server
  // derives the output size from the source image's own aspect ratio) and no
  // `count` (one picture comes back). Offering either would be a choice the request
  // cannot express, and narrowing here also makes `editParameterProblems` validate
  // exactly the controls still on screen.
  const editModelContract = useMemo(() => {
    if (!currentModel) return null
    return {
      ...currentModel,
      parameters: (currentModel.parameters ?? []).filter(
        (descriptor) => descriptor.type !== 'image-size' && canonicalNameOf(descriptor) !== 'count',
      ),
    }
  }, [currentModel])
  const editParameterProblems = useMemo(
    () => parameterIssues(editModelContract, params),
    [editModelContract, params],
  )
  // One pass over the submit gate, so a disabled button always carries a reason the
  // user can read instead of a control that simply refuses to respond.
  function editSubmitBlocker(): string | null {
    if (!editing) return null
    if (!prompt.trim()) return '请输入修改指令'
    if (!maskCapable) return maskBlockedReason
    if (!editSelectionReady) return '请先在图片上框选要修改的区域'
    if (editParameterProblems.length > 0) return editParameterProblems[0].message
    if (selectedJobActive) return '上一个任务仍在进行中，请等待完成'
    return null
  }
  const editBlockedReason = editSubmitBlocker()

  function generateSubmitBlocker(): string | null {
    if (modelsLoading) return '正在加载模型，请稍候'
    if (modelsQueryFailed && !models) return '模型列表加载失败，请重试'
    if (!currentModel) {
      return isVideoTab
        ? '尚未配置可用的视频模型，请先启用视频模型'
        : '尚未配置可用的图像模型，请联系管理员'
    }
    if (!prompt.trim()) return '请输入提示词后即可生成'
    if (createJobMutation.isPending) return '正在创建任务，请稍候'
    if (selectedJobActive) return '上一个任务仍在进行中，请等待完成'
    if (isPreparingReferences) return `正在校验${inputNoun}，请完成后再生成`
    if (isReferenceUploadBusy) return `${inputNoun}正在上传，请等待完成后再生成`
    if (hasReferenceUploadError) return `存在上传失败的${inputNoun}，请重试或删除`
    if (referencePlanBlocker) return referencePlanBlocker
    if (parameterProblems.length > 0) {
      const [problem] = parameterProblems
      const descriptor = currentModel?.parameters?.find((entry) => entry.name === problem.parameter)
      const label = descriptor ? descriptorLabel(descriptor, currentModel) : ''
      return label ? `${label}：${problem.message}` : problem.message
    }
    return null
  }
  const submitBlockedReason = editing
    ? editMutation.isPending
      ? '正在提交局部修改，请稍候'
      : editBlockedReason
    : generateSubmitBlocker()

  // Escape clears the selection from anywhere in edit mode — the caret is usually in
  // the prompt textarea while the user looks at the rectangle they just drew.
  // Leaving edit mode is deliberately not on this key: the stage has its own exit
  // control, and a stray Esc should not discard a picture someone just framed.
  useEffect(() => {
    if (!editing) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setEditSelection(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, setEditSelection])

  const boardProps = {
    jobs,
    isLoading: jobsLoading,
    isError: jobsError,
    onReload: () => void refetchJobs(),
    selectedJobId,
    onSelectJob: selectJob,
    onCancel: (jobId: string) => cancelJobMutation.mutate(jobId),
    onRetry: (jobId: string) => retryJobMutation.mutate(jobId),
    pendingCancelId: cancelJobMutation.isPending ? (cancelJobMutation.variables ?? null) : null,
    pendingRetryId: retryJobMutation.isPending ? (retryJobMutation.variables ?? null) : null,
  }

  /** Picking another job ends the edit: the stage would otherwise keep showing a
   *  picture that is no longer what the console is looking at. */
  function selectJob(jobId: string) {
    setSelectedJobId(jobId)
    setEditTarget(null)
  }

  function startRegionEdit(output: GenerationOutput) {
    setActiveTab('image')
    setEditTarget({
      assetId: output.assetId,
      url: outputUrl(output),
      width: output.metadata.width,
      height: output.metadata.height,
      selection: null,
    })
    // A fresh mode gets a fresh slate: a leftover failure from the previous job
    // would read as a verdict on the edit that has not been attempted yet.
    setErrorMessage('')
  }

  function handleSubmitEdit() {
    if (!editTarget || !activeModelId) {
      setErrorMessage('请选择生成模型')
      return
    }
    // Read here rather than from the derived flag, so the narrowing below is the
    // same predicate the button used and cannot have drifted from it.
    const selection = editTarget.selection
    if (!editSelectionIsUsable(selection)) {
      setErrorMessage('请先在图片上框选要修改的区域')
      return
    }
    if (!maskCapable) {
      setErrorMessage(maskBlockedReason ?? '当前模型不支持局部修改')
      return
    }
    if (editParameterProblems.length > 0) {
      const [problem] = editParameterProblems
      const parameters = editModelContract?.parameters ?? []
      const descriptor = parameters.find((entry) => entry.name === problem.parameter)
      const label = descriptor ? descriptorLabel(descriptor, editModelContract) : ''
      setErrorMessage(label ? `${label}：${problem.message}` : problem.message)
      return
    }
    setErrorMessage('')
    // Every control the model declares and this screen still shows rides along in
    // the `parameters` bag — dropping one here would leave a picker the user can
    // set to no effect. `size` and `count` are excluded by `editModelContract`
    // above, because this route derives the size from the source image and returns
    // one picture; the server overrides either anyway.
    editMutation.mutate(
      {
        modelId: activeModelId,
        prompt: prompt.trim(),
        assetId: editTarget.assetId,
        selection,
        idempotencyKey: newIdempotencyKey(),
        parameters: buildMediaParameters(editModelContract, params),
      },
      { onError: (error: Error) => setErrorMessage(error.message || '创建局部修改任务失败') },
    )
  }

  async function handleGenerate(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (editing) {
      handleSubmitEdit()
      return
    }
    const video = activeTab === 'video'
    if (!prompt.trim()) {
      setErrorMessage(video ? '请输入视频生成提示词' : '请输入作图提示词')
      return
    }
    if (!activeModelId) {
      setErrorMessage(video ? '请选择视频生成模型' : '请选择生成模型')
      return
    }
    if (video && videoModels.length === 0) {
      setErrorMessage('尚未配置可用的视频模型，请先在媒体模型中启用 Seedance 或 Veo 预设')
      return
    }

    // Read the snapshot imperatively so the gate can never be evaluated from a
    // stale render of an upload that finished between render and click.
    const inputState = useGenerateUiStore.getState()
    const stagedImages = inputState.stagedImages
    if (inputState.isPreparingReferences) {
      setErrorMessage(`正在校验${inputNoun}，请完成后再生成`)
      return
    }
    if (stagedImages.some((image) => image.status !== 'ready' && image.status !== 'error')) {
      setErrorMessage(`${inputNoun}正在上传，请等待完成后再生成`)
      return
    }
    if (stagedImages.some((image) => image.status === 'error')) {
      setErrorMessage(`存在上传失败的${inputNoun}，请重试或删除`)
      return
    }
    const inputs = buildGenerationInputs(stagedImages)
    if (stagedImages.length > 0 && inputs.length === 0) {
      setErrorMessage(`没有可用的${inputNoun}，请重新上传`)
      return
    }
    // Only validate the input capability when images are actually staged: a model
    // without image inputs must still support its ordinary text-to-image flow.
    // This also catches stale references after switching to a model with a smaller
    // or incompatible input contract, for both image and video generation.
    if (stagedImages.length > 0) {
      const violations = inputPlanViolations(stagedImages, inputPlan)
      if (violations.length > 0) {
        setErrorMessage(violations[0])
        return
      }
    }
    // Block here rather than letting the server refuse it: an invalid custom
    // size or a transparent-background-plus-jpeg pair should be explained while
    // the user is still looking at the control, not after a job row exists.
    // This is UX only — the API runs the identical check and is the authority.
    if (parameterProblems.length > 0) {
      const [problem] = parameterProblems
      const descriptor = currentModel?.parameters?.find((entry) => entry.name === problem.parameter)
      const label = descriptor ? descriptorLabel(descriptor, currentModel) : ''
      setErrorMessage(label ? `${label}：${problem.message}` : problem.message)
      return
    }
    setErrorMessage('')

    try {
      // One builder for both kinds. It walks the model's declared descriptors, so
      // a parameter this model never offered cannot be sent even if it is still
      // sitting in the tab's state from the model that was selected a moment ago.
      const payload: CreateGenerationRequest = {
        modelId: activeModelId,
        prompt: prompt.trim(),
        parameters: buildMediaParameters(currentModel, params),
        ...(inputs.length > 0 ? { inputs } : {}),
      }
      const job = await createJobMutation.mutateAsync(payload)
      setSelectedJobId(job.id)
      // The uploads are now attached to the job; only release local object URLs.
      await clearReferenceImages({ deleteRemote: false })
    } catch (err: any) {
      setErrorMessage(err.message || '创建生成任务失败')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!submitBlockedReason) handleGenerate()
    }
  }

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      {/* 作图 / 生视频 is picked from the workspace header, so this is a named
          region rather than a tabpanel: `role="tabpanel"` requires a `tablist`
          ancestor, and the controls now live in another subtree. The name is
          stable — which mode is live is carried by `aria-current` up in the nav,
          and a landmark that renames itself mid-focus is just noise. */}
      <div
        role="region"
        aria-label="创作台"
        className="relative flex min-h-0 w-full flex-1 overflow-hidden"
      >
        {/* Left: recent activity rail, with active jobs and history. */}
        <aside
          aria-label="任务面板"
          inert={!railOpen}
          className={cn(
            'hidden shrink-0 flex-col bg-surface transition-[width] md:flex',
            'duration-[var(--motion-overlay)] ease-[var(--ease-standard)]',
            railOpen ? 'w-72' : 'w-0 overflow-hidden',
          )}
        >
          <div className="flex h-[var(--layout-header)] shrink-0 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Clock className="h-[var(--icon-sm)] w-[var(--icon-sm)] text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-foreground">任务面板</span>
            </div>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRailOpen(false)}
              aria-label="收起任务面板"
              title="收起任务面板"
              icon={<PanelLeftClose aria-hidden="true" />}
            />
          </div>

          <ActiveJobsBoard {...boardProps} open={activeBoardOpen} onToggle={setActiveBoardOpen} />

          {/* The rule that used to split the board from 历史 is now just air. */}
          <h2 id="gen-history-heading" className="shrink-0 px-2 pt-6 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={historyOpen}
              aria-controls="gen-history-list"
              onClick={() => setHistoryOpen(!historyOpen)}
              className="w-full justify-start px-2 text-left"
              icon={<ChevronRight aria-hidden="true" className={cn('motion-position', historyOpen && 'rotate-90')} />}
            >
              <span>历史</span>
              {jobs.length > 0 && (
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {jobs.length}
                </span>
              )}
            </Button>
          </h2>

          <div
            id="gen-history-list"
            aria-labelledby="gen-history-heading"
            className={historyOpen ? 'min-h-0 flex-1 overflow-y-auto p-2' : 'hidden'}
          >
            {jobsLoading ? (
              <div aria-busy="true" className="flex flex-col gap-2 py-2">
                <span className="sr-only">加载历史记录中</span>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <SkeletonTile className="h-12 w-12 shrink-0 basis-auto" />
                    <SkeletonRow cells={2} className="min-w-0 flex-1" />
                  </div>
                ))}
              </div>
            ) : jobs.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" role="list">
                {jobs.map((j) => {
                  const isSelected = j.id === (selectedJob?.id || '')
                  const firstOutput = (j.outputs ?? [])[0]
                  return (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => selectJob(j.id)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'relative flex w-full min-w-0 gap-3 rounded-control p-2.5 pl-3 text-left transition-colors',
                          'duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
                          isSelected
                            ? 'bg-tonal-selected'
                            : 'bg-tonal enabled:hover:bg-tonal-hover',
                        )}
                      >
                        {/* Selection rides the 4px primary bar plus the tonal step:
                            the brand green is a status colour, never a selection one. */}
                        {isSelected && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-0 w-1 rounded-pill bg-primary"
                          />
                        )}
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-tonal">
                          {firstOutput ? (
                            <MediaFrame
                              src={outputUrl(firstOutput)}
                              kind={isVideoOutput(firstOutput) ? 'video' : 'image'}
                              alt=""
                              layout="thumb"
                              durationSeconds={
                                isVideoOutput(firstOutput) ? firstOutput.metadata.durationSeconds : undefined
                              }
                              hasAudio={isVideoOutput(firstOutput) ? firstOutput.metadata.hasAudio : undefined}
                            />
                          ) : (
                            <ImageOff aria-hidden="true" className="h-[var(--icon-md)] w-[var(--icon-md)] text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                          <p className="truncate text-xs font-medium text-foreground">{j.prompt}</p>
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                              {j.modelName}
                            </span>
                            <JobStatusBadge status={j.status} />
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState
                variant="first-use"
                objectName="生成记录"
                density="compact"
                title="还没有生成记录"
                description="写下提示词并开始生成，这里会留下你最近的任务。"
              />
            )}
          </div>
        </aside>

        {/* Center: full-width interactive generation studio. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="flex min-w-0 w-full flex-1 flex-col gap-6">
            <PageHeader
              title={editing ? '局部修改' : isVideoTab ? '视频生成' : '图像生成'}
              description={
                editing
                  ? '在源图上框选一块区域，再用一句话描述要改什么。源图保持不变，结果作为新任务生成。'
                  : '写下画面描述，选好模型与参数，即可生成图像或视频。'
              }
            />

            {/* Prompt & Input Box */}
            <Card className="gap-0 p-4">
              <div className="w-full">
                <label htmlFor="generate-prompt" className="sr-only">生成提示词</label>
                <textarea
                  id="generate-prompt"
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isVideoTab
                      ? '描述你想生成的视频内容，例如：镜头缓慢推进晨雾中的森林，晨光穿透树叶，电影感运镜……'
                      : editing
                        ? '描述要修改的内容，例如：把框选区域内的人物换成一件红色风衣，其余保持不变……'
                        : '描述你想生成的画面内容，例如：赛博朋克风格未来雨夜街道，霓虹灯倒影，8k 高细节……'
                  }
                  aria-describedby="generate-prompt-help"
                  className="w-full resize-none bg-transparent text-left text-sm leading-[1.59] text-foreground placeholder:text-muted-foreground"
                />
                <p id="generate-prompt-help" className="mt-1 text-xs text-muted-foreground">
                  支持 Ctrl/⌘ + Enter 快捷生成。
                </p>
              </div>

              {/* Controls Bar — separated from the textarea by space, never a rule */}
              <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                  {/* Model Selector */}
                  <div className="flex flex-col items-start gap-1">
                    <label htmlFor="generate-model" className="sr-only">生成模型</label>
                    <Select
                      size="sm"
                      width="content"
                      id="generate-model"
                      value={activeModelId}
                      onChange={(e) => setSelectedModelId(activeTab, e.target.value)}
                      disabled={modelsLoading || tabModels.length === 0}
                      aria-describedby={
                        modelsLoading || modelsQueryFailed || !currentModel
                          ? 'generate-model-help generate-model-status'
                          : 'generate-model-help'
                      }
                    >
                      {modelsLoading && <option value="">加载模型中…</option>}
                      {tabModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.deprecated === true
                            ? `${m.displayName}（已弃用${m.deprecationNote ? `：${m.deprecationNote}` : ''}）`
                            : m.displayName}
                        </option>
                      ))}
                      {!modelsLoading && tabModels.length === 0 && (
                        <option value="">尚未配置{isVideoTab ? '视频' : '图像'}模型</option>
                      )}
                    </Select>
                    <span id="generate-model-help" className="sr-only">
                      选择本次生成使用的模型。模型由管理员配置。
                    </span>
                    {(modelsLoading || modelsQueryFailed || !currentModel) && (
                      <p
                        id="generate-model-status"
                        role={modelsQueryFailed ? 'alert' : 'status'}
                        className="max-w-64 text-xs text-muted-foreground"
                      >
                        {modelsLoading
                          ? '正在加载模型列表…'
                          : modelsQueryFailed
                            ? models
                              ? '模型列表刷新失败，仍可使用已加载的模型。'
                              : `模型列表加载失败：${modelsQueryError instanceof Error ? modelsQueryError.message : '请重试'}`
                            : isVideoTab
                              ? '尚未配置可用的视频模型。'
                              : '尚未配置可用的图像模型。'}
                        {modelsQueryFailed && (
                          <button
                            type="button"
                            onClick={() => void refetchModels()}
                            className="ml-1 font-medium text-foreground underline underline-offset-2"
                          >
                            重试
                          </button>
                        )}
                      </p>
                    )}
                  </div>

                  {/* One renderer for both media kinds, driven entirely by the
                      selected model's declared descriptors. The image branch used
                      to hardcode five sizes and three counts, which is how the
                      console came to offer `1024x768` — a size no configured model
                      accepts. Nothing here knows what a GPT Image is. In edit mode
                      the narrowed contract drops the descriptors the request cannot
                      carry, so nothing on screen lies about what will happen. */}
                  <MediaParameterControls
                    model={editing ? editModelContract : currentModel}
                    values={params}
                    onChange={(name, value) => setParam(activeTab, name, value)}
                    countUnit={isVideoTab ? ' 条' : ' 张'}
                  />
                  {editing ? (
                    <span className="flex flex-col gap-1">
                      <span className="px-0.5 text-overline text-muted-foreground">尺寸</span>
                      {/* Read-only output, so a `title` alone would hide the reason
                          from keyboard and touch users: the text says it outright. */}
                      <span
                        title="局部修改的输出尺寸由服务端按源图比例决定"
                        className="flex min-h-[var(--control-sm)] items-center rounded-control bg-tonal px-3 text-xs text-muted-foreground"
                      >
                        按源图比例自动
                      </span>
                    </span>
                  ) : null}
                  {/* Mount point for controls that are not model parameters —
                      the region-select editor attaches here without this file
                      needing to know anything about it. */}
                  <div className="flex flex-wrap items-center gap-2" data-slot="generate-controls-extra" />
                  {/* Hidden in edit mode: the source is the picture on the stage,
                      referenced by its asset id, so staged inputs would be dropped
                      from a request that has no `inputs` at all. */}
                  {editing ? null : (
                    <ReferenceImagesTrigger
                      model={currentModel}
                      plan={inputPlan}
                      disabled={createJobMutation.isPending}
                    />
                  )}
                </div>

                {/* Generate Button */}
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
                  {submitBlockedReason && (
                    <span
                      id="generate-submit-blocker"
                      role="status"
                      aria-live="polite"
                      className="max-w-full break-words text-xs font-medium text-muted-foreground"
                    >
                      {submitBlockedReason}
                    </span>
                  )}

                  {/* `loading` keeps the action name and the button width while the
                      job is in flight, instead of renaming the control to 处理中 —
                      states.md §4: 异步保留宽度和动作名称。 */}
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => handleGenerate()}
                    disabled={Boolean(submitBlockedReason)}
                    loading={editing ? editMutation.isPending : createJobMutation.isPending || selectedJobActive}
                    aria-describedby={submitBlockedReason ? 'generate-submit-blocker' : undefined}
                    title={editing ? (editBlockedReason ?? '提交局部修改') : undefined}
                    className="px-5"
                    icon={<Sparkles aria-hidden="true" />}
                  >
                    {editing ? '提交局部修改' : '立即生成'}
                  </Button>
                </div>
              </div>
            </Card>

            {errorMessage && (
              <Alert tone="danger" role="alert" title="无法开始生成">
                {errorMessage}
              </Alert>
            )}

            {/* The rail is `hidden md:flex`, so below `md` this is the only way to
                see or cancel a running task for image generation. Video page omits md:hidden area to match image generation desktop styling. */}
            {!isVideoTab && (
              <div className="md:hidden">
                <ActiveJobsBoard {...boardProps} variant="inline" hideWhenEmpty />
              </div>
            )}

            {editing && editTarget ? (
              /* Edit mode owns the whole stage: the source picture, the rectangle
                 and nothing else. It is a branch *before* the job card rather than
                 a swap inside it because a 局部修改 can also be entered from the
                 library, where there may be no selected job at all. */
              <Card className="items-center">
                <div className="flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Crop className="h-[var(--icon-sm)] w-[var(--icon-sm)] text-primary" aria-hidden="true" />
                    <CardTitle level={3} className="text-sm">局部修改</CardTitle>
                    <span className="text-xs text-muted-foreground">· 源图保持不变，结果作为新任务生成</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditTarget(null)}
                    icon={<X aria-hidden="true" />}
                  >
                    退出局部修改
                  </Button>
                </div>

                <EditRegionStage
                  src={editTarget.url}
                  alt="局部修改源图"
                  declaredWidth={editTarget.width}
                  declaredHeight={editTarget.height}
                  selection={editTarget.selection}
                  onSelectionChange={setEditSelection}
                />
              </Card>
            ) : selectedJob ? (
              /* Main Stage Display Area. Sized by its content on purpose: the old
                 `flex-1 justify-center` swallowed whatever height the shorter
                 16:9 video left over and showed it as blank below the player. */
              <Card className="items-center">
                <div className="flex w-full flex-col gap-4">
                  {/* Header of selected job */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <JobStatusBadge status={selectedJob.status} busy={selectedJobActive} />
                      <span className="truncate text-xs text-muted-foreground">{selectedJob.modelName}</span>
                      <span aria-hidden="true" className="text-xs text-muted-foreground">·</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {new Date(selectedJob.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedJobActive && (
                        // 中止 is not a high-risk destructive confirm, so it is a
                        // ghost button with danger text, never a solid red one.
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="sm"
                          onClick={() => cancelJobMutation.mutate(selectedJob.id)}
                          disabled={Boolean(selectedJob.cancelRequested)}
                          loading={cancelJobMutation.isPending}
                          icon={<XCircle aria-hidden="true" />}
                        >
                          {selectedJob.cancelRequested ? '取消中' : '取消任务'}
                        </Button>
                      )}

                      {selectedJob.status === 'failed' && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => retryJobMutation.mutate(selectedJob.id)}
                          loading={retryJobMutation.isPending}
                          icon={<RefreshCw aria-hidden="true" />}
                        >
                          重试
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Job Prompt */}
                  <p className="text-sm text-foreground">{selectedJob.prompt}</p>

                  {/* Job Content / Outputs */}
                  {selectedJobActive && (
                    <Progress
                      value={null}
                      label={stageIsVideo ? '正在渲染视频' : '正在生成画面'}
                      showLabelRow={false}
                      size="md"
                      className="w-full max-w-3xl"
                    />
                  )}
                  {selectedJob.status === 'succeeded' && stageOutputs.length > 0 ? (
                    <div
                      className={cn(
                        'grid w-full gap-4',
                        stageOutputs.length === 1
                          ? singleOutputClass
                          : stageOutputs.length === 2
                            ? 'grid-cols-2'
                            : 'grid-cols-2 md:grid-cols-4',
                      )}
                    >
                      {stageOutputs.map((output) => {
                        const src = outputUrl(output)
                        const isVideo = isVideoOutput(output)
                        // The request references its source by asset id, so a row
                        // without one cannot be edited at all — and an incapable
                        // model must not be able to start a whole-image edit.
                        const canEdit = Boolean(output.assetId) && maskCapable
                        return (
                          <div
                            key={output.id}
                            className="group relative overflow-hidden rounded-control bg-surface"
                          >
                            <MediaFrame
                              src={src}
                              kind={isVideo ? 'video' : 'image'}
                              alt={selectedJob.prompt}
                              layout="stage"
                              durationSeconds={isVideo ? output.metadata.durationSeconds : undefined}
                              aspectRatio={output.metadata.aspectRatio}
                              width={output.metadata.width}
                              height={output.metadata.height}
                              hasAudio={isVideo ? output.metadata.hasAudio : undefined}
                              showControls={isVideo}
                            />
                            {/* A <video controls> owns its own control bar, so the
                                hover download overlay is only for still images.
                                `.media-tile-actions` is what makes the pair
                                reachable without hover on touch devices. */}
                            {!isVideo && (
                              <div className="media-tile-actions media-scrim absolute inset-0 flex items-end justify-end gap-2 p-2 opacity-0 motion-hover-fade group-hover:opacity-100 group-focus-within:opacity-100">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => startRegionEdit(output)}
                                  disabled={!canEdit}
                                  title={canEdit ? '局部修改：框选一个区域后描述修改' : (maskBlockedReason ?? '当前模型不支持局部修改')}
                                  aria-label="局部修改"
                                  className="bg-surface text-xs"
                                  icon={<Crop aria-hidden="true" />}
                                >
                                  局部修改
                                </Button>
                                {/* Navigation to a file is a link, not a button. */}
                                <a
                                  href={src}
                                  target="_blank"
                                  rel="noreferrer"
                                  download
                                  aria-label="下载原图"
                                  title="下载原图"
                                  className={buttonVariants({ variant: 'secondary', size: 'sm', iconOnly: true })}
                                >
                                  <Download aria-hidden="true" />
                                </a>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : selectedJobActive ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                      <Spinner size="lg" label="正在生成" className="text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        {stageIsVideo ? 'AI 正在渲染视频…' : 'AI 正在绘制画面…'}
                      </p>
                      <p className="text-xs text-muted-foreground">任务正在后端集群队列调度中，可以离开本页，完成后会在任务面板提示。</p>
                    </div>
                  ) : selectedJob.status === 'failed' ? (
                    <EmptyState
                      variant="error"
                      title="生成未完成"
                      description={selectedJob.errorMessage ?? selectedJob.errorCode ?? '服务端返回了未知错误，请重试或更换模型。'}
                      action={
                        <Button
                          variant="secondary"
                          onClick={() => retryJobMutation.mutate(selectedJob.id)}
                          loading={retryJobMutation.isPending}
                          icon={<RefreshCw aria-hidden="true" />}
                        >
                          重试任务
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      variant="no-results"
                      objectName="生成画面"
                      title="暂无可用生成画面"
                      description="这次任务没有产出可展示的画面，重新提交一次即可。"
                      action={
                        <Button variant="secondary" onClick={() => void handleGenerate()} icon={<Sparkles aria-hidden="true" />}>
                          立即生成
                        </Button>
                      }
                    />
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>

        {/* Reopen control stays in the left rail's slot, so collapsing it never
            shifts the button away from the panel edge. */}
        {!railOpen && (
          <IconButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRailOpen(true)}
            aria-label="展开任务面板"
            title="展开任务面板"
            className="absolute left-4 top-3 hidden bg-surface shadow-soft md:inline-flex"
            icon={<PanelLeftOpen aria-hidden="true" />}
          />
        )}
      </div>
    </div>
  )
}
