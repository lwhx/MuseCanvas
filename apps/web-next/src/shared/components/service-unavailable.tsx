'use client'

/**
 * Upstream-unavailable page state, rendered from the server layouts whenever the
 * session call answers `UPSTREAM_UNAVAILABLE`.
 *
 * A failed request has to offer a way out, so the retry is a real action: it
 * re-issues the current request instead of leaving the user to fiddle with the
 * address bar. Surface styling only — `bg-surface` + `shadow-soft`, no rule — and
 * the heading is the 18px module step at weight 400.
 */
export function ServiceUnavailable() {
  const retry = () => window.location.reload()

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4 text-foreground sm:p-8">
      <div className="w-full max-w-dialog-narrow rounded-card bg-surface p-8 text-center shadow-soft">
        <h1 className="text-module font-normal">服务暂时不可用</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          无法连接后端服务，可能是服务正在启动或维护中。请稍后重试。
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex min-h-[var(--control-md)] items-center justify-center rounded-control bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover motion-press"
          style={{ transitionDuration: 'var(--motion-fast)', transitionTimingFunction: 'var(--ease-standard)' }}
        >
          刷新重试
        </button>
      </div>
    </main>
  )
}
