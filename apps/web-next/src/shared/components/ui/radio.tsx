'use client'

import { createContext, useContext, useId, useRef } from 'react'
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { controlSquare } from './size'

interface RadioGroupContextValue {
  name?: string
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null)

export interface RadioGroupProps {
  name?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  orientation?: 'horizontal' | 'vertical'
  children: ReactNode
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

export function RadioGroup({
  name,
  value,
  onValueChange,
  disabled = false,
  orientation = 'vertical',
  children,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: RadioGroupProps) {
  const generatedName = useId()
  const groupName = name ?? generatedName

  return (
    <RadioGroupContext.Provider value={{ name: groupName, value, onValueChange, disabled }}>
      <div
        role="radiogroup"
        aria-orientation={orientation}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'flex',
          orientation === 'horizontal' ? 'flex-row flex-wrap gap-4' : 'flex-col gap-1',
          className,
        )}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  )
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'value'> {
  value?: string
  /** Visible clickable text. Omit for a standalone radio button. */
  label?: ReactNode
  'aria-label'?: string
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * Jude-Frontweb v22 Circular Radio:
 * - 16px circular outer frame (`h-4 w-4 rounded-full border border-border-control bg-surface`).
 * - Checked state: `border-primary bg-surface` with centered 6-7px solid dot (`bg-primary rounded-full`).
 * - Unchecked: `border border-border-control bg-surface`, hover deepens border to foreground.
 * - Arrow key navigation handled natively via shared `name` attribute in browser accessibility tree.
 * - `focus-visible` 2px outline on keyboard focus.
 * - Comfortable 40px (`--control-md`) hit area.
 */
export function Radio({
  label,
  'aria-label': ariaLabel,
  checked: controlledChecked,
  onCheckedChange,
  onChange,
  disabled: itemDisabled = false,
  className,
  id: customId,
  name: explicitName,
  value,
  ...rest
}: RadioProps) {
  const group = useContext(RadioGroupContext)
  const generatedId = useId()
  const id = customId ?? (label ? generatedId : undefined)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const name = explicitName ?? group?.name
  const isChecked = group?.value !== undefined && value !== undefined
    ? group.value === value
    : controlledChecked
  const isDisabled = group?.disabled || itemDisabled

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event)
    onCheckedChange?.(event.target.checked)
    if (group?.onValueChange && value !== undefined) {
      group.onValueChange(value)
    }
  }

  const visualCircle = (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
        'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-border-focus',
        isChecked
          ? 'border-primary bg-surface'
          : cn('border-border-control bg-surface', !isDisabled && 'group-hover:border-foreground peer-hover:border-foreground'),
      )}
    >
      {isChecked ? (
        <span className="h-[6.5px] w-[6.5px] rounded-full bg-primary" />
      ) : null}
    </span>
  )

  const nativeInput = (
    <input
      ref={inputRef}
      id={id}
      type="radio"
      name={name}
      value={value}
      checked={isChecked}
      disabled={isDisabled}
      aria-label={label ? undefined : ariaLabel}
      onChange={handleChange}
      className="sr-only peer"
      {...rest}
    />
  )

  if (!label) {
    return (
      <label
        htmlFor={id}
        className={cn(
          'group inline-flex select-none items-center justify-center rounded-control',
          controlSquare.md,
          isDisabled ? 'is-disabled' : 'cursor-pointer',
          className,
        )}
      >
        {nativeInput}
        {visualCircle}
      </label>
    )
  }

  return (
    <label
      htmlFor={id}
      className={cn(
        'group inline-flex min-h-[var(--control-md)] select-none items-center gap-2.5 text-sm text-foreground',
        isDisabled ? 'is-disabled' : 'cursor-pointer',
        className,
      )}
    >
      {nativeInput}
      {visualCircle}
      <span>{label}</span>
    </label>
  )
}
