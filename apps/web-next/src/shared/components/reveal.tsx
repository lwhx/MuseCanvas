'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  /** 0-based section step. The spacing comes from `--stagger-step-page` (100ms),
   *  so callers pass the plain index — `index * 2` hacks are what the token
   *  override replaces. Clamped to 8 steps in `globals.css`. */
  staggerIndex?: number
}

/**
 * Scroll-triggered page-level entrance (fade-in-up over `--motion-page` 400ms,
 * ease-out) for marketing-style sections, with the section rhythm of 100ms taken
 * from `--stagger-step-page` rather than an eyeballed multiplier at the call site.
 *
 * SSR and first paint render the final visible state (no-JS and slow-hydration
 * safe); after hydration an IntersectionObserver hides below-fold blocks and
 * re-reveals them on scroll. Reduced-motion users never get the hidden state —
 * the observer is not installed and content stays statically visible.
 */
export function Reveal({ children, className = '', staggerIndex }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
          } else {
            setVisible(false)
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -5% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={
        {
          '--stagger-index': staggerIndex ?? 0,
          // The marketing rhythm is 100ms per section, not the 50ms list step.
          '--stagger-step': 'var(--stagger-step-page)',
        } as CSSProperties
      }
      className={`${className} ${visible ? 'motion-page motion-stagger' : 'opacity-0'}`}
    >
      {children}
    </div>
  )
}
