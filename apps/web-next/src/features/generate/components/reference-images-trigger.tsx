'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/shared/components/ui'
import { cn } from '@/shared/lib/cn'
import { useGenerateUiStore } from '@/shared/stores/generate-ui-store'
import type { ImageInputPlan, ImageInputPlanModel } from '@/shared/lib/generation-params'
import { ReferenceImagesDialog } from './reference-images-dialog'

const PREVIEW_LIMIT = 3

/** Frame slots mean the staged images *are* the video's first/last frames, so the
 *  trigger stops calling them references. */
function usesFrameSlots(plan: ImageInputPlan): boolean {
  return plan.slots.some((slot) => slot.role === 'first_frame' || slot.role === 'last_frame')
}

export function ReferenceImagesTrigger({
  model,
  plan,
  disabled = false,
}: {
  /** `ImageInputPlanModel`, not the legacy 2-key pick: `modelKind` has to survive
   *  the prop hop down to `addReferenceFiles`, which re-resolves the plan itself. */
  model: ImageInputPlanModel | null | undefined
  plan: ImageInputPlan
  disabled?: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hasOpened = useRef(false)
  const [isOpen, setIsOpen] = useState(false)

  const stagedImages = useGenerateUiStore((s) => s.stagedImages)
  const maxInputs = plan.capacity
  const frameMode = usesFrameSlots(plan)
  const noun = frameMode ? '输入画面' : '参考图'
  const uploading = stagedImages.find((image) => image.status === 'uploading')
  const failed = stagedImages.some((image) => image.status === 'error')
  const count = stagedImages.length

  useEffect(() => {
    // Only return focus when a panel we opened actually closed.
    if (!isOpen && hasOpened.current) buttonRef.current?.focus()
  }, [isOpen])

  function openPanel() {
    hasOpened.current = true
    setIsOpen(true)
  }

  const counter = uploading ? `${uploading.progress}%` : `${count}/${maxInputs}`

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="secondary"
        size="sm"
        onClick={openPanel}
        disabled={disabled}
        aria-label={
          count > 0 ? `${noun}，已添加 ${count} 张，最多 ${maxInputs} 张` : `添加${noun}`
        }
        className={cn(
          'border gap-1.5 px-2.5',
          failed ? 'border-danger text-danger' : count > 0 ? 'border-border-control bg-tonal-selected' : 'border-border-control',
        )}
        icon={
          <ImagePlus
            aria-hidden="true"
            className={maxInputs > 0 ? 'text-primary' : 'text-muted-foreground'}
          />
        }
      >
        <span>{noun}</span>
        {stagedImages.slice(0, PREVIEW_LIMIT).map((image) => (
          <img
            key={image.localId}
            src={image.previewUrl}
            alt=""
            aria-hidden="true"
            className="h-5 w-5 shrink-0 rounded-checkbox border border-border object-cover"
          />
        ))}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{counter}</span>
      </Button>

      <ReferenceImagesDialog
        open={isOpen}
        model={model}
        plan={plan}
        onClose={() => setIsOpen(false)}
      />
    </>
  )
}
