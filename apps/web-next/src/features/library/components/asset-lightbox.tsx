'use client'

import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { CropIcon as Crop, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, DownloadSimpleIcon as Download, XIcon as X } from '@phosphor-icons/react'
import { MediaFrame } from '@/shared/components/media-frame'
import { useDialog } from '@/shared/hooks/useDialog'
import type { DialogDirection } from '@/shared/hooks/useDialog'
import { useGenerationMode } from '@/shared/hooks/useGenerationMode'
import { useModelsQuery } from '@/shared/hooks/useModels'
import { useGenerateUiStore } from '@/shared/stores/generate-ui-store'
import { maskCapabilityBlockReason, modelAcceptsMask, resolveActiveImageModel } from '@/shared/lib/model-capabilities'
import { formatDateTime } from '@/shared/lib/format'
import { assetPlaybackUrl, isVideoAsset } from '@/shared/types'
import type { Asset } from '@/shared/types'
import { Button, IconButton, buttonVariants } from '@/shared/components/ui'

export interface AssetLightboxProps {
  /** The currently filtered grid, in display order — this list *is* the
   *  navigation domain, so prev/next never lands on a hidden asset. */
  assets: Asset[]
  /** `previewAssetId` from the store. The component resolves it against `assets`
   *  on every render instead of ever holding the object itself, so a refetch or a
   *  delete can only close the dialog, never leave a stale row on screen. */
  activeAssetId: string | null
  onClose: () => void
  onSelect: (assetId: string) => void
}

/**
 * The scrim, identical to `Dialog`'s: `--color-overlay` at `--opacity-overlay`
 * (40% light, 55% dark) via `color-mix` rather than an `opacity` utility, because
 * the entrance/exit animation animates `opacity` and would otherwise fight the
 * token. `--opacity-overlay` is documented in `globals.css` as the scrim *and media
 * backdrop* value, which is exactly what this surface is.
 */
const SCRIM_BACKGROUND = 'color-mix(in srgb, var(--color-overlay) calc(var(--opacity-overlay) * 100%), transparent)'

/**
 * Full-size preview over the library grid. All modal behaviour (mount lifecycle,
 * portal, focus trap, scroll lock, Escape, ← / → navigation, inert background and
 * focus restore to the triggering tile) comes from `useDialog`; this file only
 * decides what the panel shows.
 *
 * It is deliberately *not* routed through `Dialog`: the arrows belong outside the
 * panel, on the media edge (`Image/Attachment Preview` → lightbox 全屏), and `Dialog`
 * wraps its children in a padded scroll body with a fixed header row, so neither the
 * full-bleed media nor those out-of-panel controls fit it. What it does share with
 * `Dialog` is the surface contract — `z-modal`, `shadow-modal`, `rounded-panel`, the
 * same scrim token and the same enter/exit motion pair.
 */
export function AssetLightbox({ assets, activeAssetId, onClose, onSelect }: AssetLightboxProps) {
  const index = activeAssetId ? assets.findIndex((asset) => asset.id === activeAssetId) : -1
  const current = index >= 0 ? assets[index] : null

  const onNavigate = useCallback(
    (direction: DialogDirection) => {
      const target = assets[index + (direction === 'previous' ? -1 : 1)]
      if (target) onSelect(target.id)
    },
    [assets, index, onSelect],
  )

  const { mounted, phase, labelId, closeButtonRef, portalTarget, rootProps, dialogProps } = useDialog({
    open: current !== null,
    onClose,
    onNavigate,
  })

  // 局部修改 runs on the model the creation console would submit with, so the gate
  // here has to ask *that* model — a second, locally chosen one is how the lightbox
  // ends up offering an edit the console then refuses.
  const { data: models } = useModelsQuery()
  const storedImageModelId = useGenerateUiStore((s) => s.selectedModelIdByKind.image)
  const setEditTarget = useGenerateUiStore((s) => s.setEditTarget)
  const { selectMode } = useGenerationMode()

  // Body of the exit fade: the row can already be gone (delete, filter switch)
  // while the close animation runs, and a panel that empties mid-fade looks
  // broken. The id stays the single source of truth — `open` goes false the
  // moment `current` is, so this cached copy can only ever be on its way out.
  const [lastKnown, setLastKnown] = useState<Asset | null>(null)
  if (current && current !== lastKnown) setLastKnown(current)
  const shown = current ?? lastKnown

  if (!mounted || !portalTarget || !shown) return null

  const closing = phase === 'close'
  const isVideo = isVideoAsset(shown)
  const isFirst = index <= 0
  const isLast = index >= assets.length - 1
  const regionEditBlocked = isVideo
    ? '仅图像作品支持局部修改'
    : maskCapabilityBlockReason(resolveActiveImageModel(models ?? [], storedImageModelId))

  function startRegionEdit(asset: Asset) {
    setEditTarget({
      assetId: asset.id,
      url: assetPlaybackUrl(asset),
      width: asset.width,
      height: asset.height,
      selection: null,
    })
    // Close the dialog before routing: it traps focus and locks body scroll, and a
    // portal left over the console would keep swallowing both.
    onClose()
    selectMode('image')
  }

  return createPortal(
    <div
      {...rootProps}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ backgroundColor: SCRIM_BACKGROUND }}
      className={`fixed inset-0 z-modal flex items-center justify-center p-4 ${
        closing ? 'motion-fade-out pointer-events-none' : 'motion-fade-in'
      }`}
    >
      <p className="sr-only" role="status" aria-live="polite">
        第 {Math.max(index + 1, 1)} / {assets.length} 个作品
      </p>

      <IconButton
        variant="ghost"
        size="lg"
        ref={closeButtonRef}
        onClick={onClose}
        aria-label="关闭预览"
        className="absolute right-4 top-4 rounded-pill bg-overlay/60 text-foreground-inverse enabled:hover:bg-overlay"
        icon={<X weight="bold" aria-hidden="true" />}
      />

      <NavButton direction="previous" disabled={isFirst} onNavigate={onNavigate} />
      <NavButton direction="next" disabled={isLast} onNavigate={onNavigate} />

      <div
        {...dialogProps}
        className={`max-h-[90vh] w-full max-w-content overflow-hidden rounded-panel bg-surface shadow-modal ${
          closing ? 'motion-dialog-out' : 'motion-dialog-in'
        }`}
      >
        <div key={shown.id} className="motion-pop">
          <MediaFrame
            src={assetPlaybackUrl(shown)}
            kind={isVideo ? 'video' : 'image'}
            alt={shown.prompt || ''}
            layout="stage"
            showControls={isVideo}
            durationSeconds={shown.durationSeconds}
            width={shown.width}
            height={shown.height}
            hasAudio={shown.hasAudio}
            className={isVideo ? 'max-h-[75vh] w-full object-contain' : 'mx-auto max-h-[75vh] w-auto object-contain'}
          />
        </div>
        {/* A dialog is a card-class surface: heading, meta and actions are separated
            by whitespace only, never a rule. */}
        <div className="flex flex-col gap-3 p-6">
          <p id={labelId} className="text-module">
            {shown.prompt}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatDateTime(shown.createdAt)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Crop weight="bold" aria-hidden="true" />}
                onClick={() => startRegionEdit(shown)}
                disabled={Boolean(regionEditBlocked)}
                title={regionEditBlocked ?? '到创作台框选要修改的区域'}
              >
                局部修改
              </Button>
              <a
                href={assetPlaybackUrl(shown)}
                download
                target="_blank"
                rel="noreferrer"
                aria-label="下载该作品"
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                <Download weight="bold" aria-hidden="true" />
                下载
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  )
}

interface NavButtonProps {
  direction: DialogDirection
  disabled: boolean
  onNavigate: (direction: DialogDirection) => void
}

/** Edge arrows. The boundary ones stay out of the tab ring because `useDialog`
 *  skips `[disabled]` when it collects the focusable set, and they wear the one
 *  disabled treatment the token layer defines instead of a hand-picked opacity. */
function NavButton({ direction, disabled, onNavigate }: NavButtonProps) {
  const previous = direction === 'previous'
  const Icon = previous ? ChevronLeft : ChevronRight
  return (
    <IconButton
      variant="ghost"
      size="lg"
      onClick={() => onNavigate(direction)}
      disabled={disabled}
      aria-label={previous ? '上一个作品' : '下一个作品'}
      className={`absolute top-1/2 -translate-y-1/2 rounded-pill bg-overlay/60 text-foreground-inverse enabled:hover:bg-overlay ${
        previous ? 'left-4' : 'right-4'
      }`}
      icon={<Icon weight="bold" aria-hidden="true" />}
    />
  )
}
