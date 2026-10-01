import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Frame for the `(auth)` routes. It stays a server component: the session
 * pre-check lives in `login/page.tsx`, and nothing here reads cookies.
 *
 * The panel is a card, so it carries the card treatment from the token contract —
 * `bg-surface` + `shadow-soft` + `rounded-card` and **no rule** — and the
 * reading measure is the narrow container (`max-w-dialog-narrow`, 420px) rather
 * than a one-off pixel width.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12 text-foreground">
      <div className="mb-8 flex justify-center">
        <Link href="/" aria-label="返回 MuseCanvas 首页" className="rounded-control">
          <img
            src="/brand/musecanvas_flow_ribbon_final_pack/03_transparent_trimmed_png/03_wordmark_transparent_trimmed.png"
            alt="MuseCanvas"
            className="h-8 w-auto"
          />
        </Link>
      </div>

      <div className="w-full max-w-dialog-narrow rounded-card bg-surface p-6 shadow-soft sm:p-8">{children}</div>

      <p className="mt-8 max-w-dialog-narrow text-center text-xs text-muted-foreground [text-wrap:pretty]">
        登录即代表你已阅读并同意
        <Link href="/terms" className="rounded-control underline underline-offset-2 hover:text-foreground">
          用户协议
        </Link>
        与
        <Link href="/privacy" className="rounded-control underline underline-offset-2 hover:text-foreground">
          隐私政策
        </Link>
        。
      </p>
    </div>
  )
}
