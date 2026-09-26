'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@/shared/types'
import { ThemeToggle } from '@/shared/components/ui/theme-toggle'
import { Avatar } from '@/shared/components/ui/avatar'
import { Button, IconButton, buttonVariants } from '@/shared/components/ui/button'
import { useDialog } from '@/shared/hooks/useDialog'
import { cn } from '@/shared/lib/cn'
import {
  LayoutDashboard,
  Users,
  Blocks,
  Cpu,
  FileText,
  ShieldCheck,
  Settings,
  ListTodo,
  ChevronRight,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

interface AdminShellProps {
  user: User
  children: React.ReactNode
}

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  /** Rendered as a 16px group heading; hidden on the collapsed rail. */
  title?: string
  items: NavItem[]
}

interface Crumb {
  href: string
  label: string
}

/**
 * Jude-Frontweb admin layout (foundations.md 管理后台布局): sidebar 260px
 * (`--layout-sidebar`, collapsible to a 64px icon rail) + 56px header
 * (`--layout-header`) + a `max-w-content` content area.
 * `md` is 960px in this token layer, so "narrow" is `max-md` and the rail's
 * desktop-only affordances are `md:`.
 */
/** Sidebar becomes an overlay drawer below the 960px (`md`) threshold. */
const SIDEBAR_BREAKPOINT_QUERY = '(min-width: 960px)'
/** Existing collapse persistence — the one client state the shell keeps. */
const COLLAPSE_STORAGE_KEY = 'muse-admin-sidebar-collapsed'

const navGroups: NavGroup[] = [
  { items: [{ path: '/admin', label: '概览', icon: LayoutDashboard }] },
  {
    title: '用户与权限',
    items: [{ path: '/admin/users', label: '用户管理', icon: Users }],
  },
  {
    title: '生成资源',
    items: [
      { path: '/admin/media-models', label: '媒体模型', icon: Blocks },
      { path: '/admin/language-models', label: '语言模型', icon: Cpu },
      { path: '/admin/prompt-templates', label: '提示词模板', icon: FileText },
    ],
  },
  {
    title: '系统设置',
    items: [
      { path: '/admin/oauth', label: 'OAuth', icon: ShieldCheck },
      { path: '/admin/settings', label: '系统配置', icon: Settings },
    ],
  },
  { items: [{ path: '/admin/jobs', label: '任务监控', icon: ListTodo }] },
]

/** path → visible label, shared by the nav and the breadcrumb. */
const NAV_LABELS: Record<string, string> = { '/admin': '管理后台' }
for (const group of navGroups) {
  for (const item of group.items) NAV_LABELS[item.path] = item.label
}

/**
 * Pathname-driven breadcrumb. The root crumb is always 管理后台; each further
 * segment resolves through `NAV_LABELS` and falls back to the raw segment, so a
 * route the nav does not list is still described truthfully.
 */
function buildCrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ href: '/admin', label: NAV_LABELS['/admin'] }]
  const [, ...rest] = pathname.split('/').filter(Boolean)
  let href = ''
  for (const segment of rest) {
    href = `${href}/${segment}`
    crumbs.push({ href: `/admin${href}`, label: NAV_LABELS[`/admin${href}`] ?? segment })
  }
  return crumbs
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname])
  // Middle crumbs are the ones that drop on a narrow header; the current page never does.
  const hasMiddle = crumbs.length > 2

  return (
    <nav aria-label="面包屑" className="min-w-0 flex-1 md:flex-none">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          const isMiddle = index > 0 && !isLast
          return (
            <li
              key={crumb.href}
              className={cn('flex min-w-0 items-center gap-1.5', isMiddle && 'hidden md:flex')}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                  /
                </span>
              ) : null}
              {isLast ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
        {hasMiddle ? (
          // Ellipsis stands in for the collapsed middle section on narrow viewports.
          <li aria-hidden="true" className="shrink-0 text-muted-foreground md:hidden">
            …
          </li>
        ) : null}
      </ol>
    </nav>
  )
}

export function AdminShell({ user, children }: AdminShellProps) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const {
    mounted: drawerMounted,
    phase: drawerPhase,
    labelId: drawerLabelId,
    closeButtonRef: drawerCloseButtonRef,
    portalTarget: drawerPortalTarget,
    rootProps: drawerRootProps,
    dialogProps: drawerDialogProps,
  } = useDialog({ open: drawerOpen, onClose: closeDrawer })
  // Collapse preference is read post-mount only: the server has no localStorage,
  // and a first-paint mismatch would flash the wrong width and shift layout.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1')
    } catch {
      // Storage unavailable — stay expanded.
    }
  }, [])

  useEffect(() => {
    closeDrawer()
  }, [pathname, closeDrawer])

  useEffect(() => {
    const breakpoint = window.matchMedia(SIDEBAR_BREAKPOINT_QUERY)
    const closeOnDesktop = () => {
      if (breakpoint.matches) closeDrawer()
    }
    breakpoint.addEventListener('change', closeOnDesktop)
    return () => breakpoint.removeEventListener('change', closeOnDesktop)
  }, [closeDrawer])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, prev ? '0' : '1')
      } catch {
        // Session-only toggle.
      }
      return !prev
    })
  }

  const userInitial = user.email?.charAt(0).toUpperCase() || 'A'

  function isItemActive(itemPath: string) {
    if (itemPath === '/admin') {
      return pathname === '/admin'
    }
    const cleanPath = itemPath.split('?')[0]
    return pathname.startsWith(cleanPath)
  }

  /** `rail` = the collapsed 64px icon-only sidebar: labels move to `aria-label`/`title`. */
  const renderNavLinks = (options?: { onNavigate?: () => void; rail?: boolean }) => {
    const { onNavigate, rail } = options ?? {}
    return (
      <div className="flex flex-col gap-6">
        {navGroups.map((group, groupIndex) => (
          <div key={group.title ?? groupIndex} className="flex flex-col gap-1">
            {group.title && (
              // 16px group title (Jude-Frontweb v22: group title strictly larger than 14px item).
              <h2
                className={cn(
                  'px-3 text-base font-medium text-foreground tracking-normal',
                  rail && 'sr-only',
                )}
              >
                {group.title}
              </h2>
            )}
            {group.items.map((item) => {
              const active = isItemActive(item.path)
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  aria-label={rail ? item.label : undefined}
                  title={rail ? item.label : undefined}
                  className={cn(
                    'relative flex min-h-[var(--control-md)] items-center gap-3 rounded-control',
                    'px-3 text-sm font-medium transition-colors',
                    'duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
                    rail && 'justify-center px-0',
                    active
                      ? 'bg-tonal-selected text-foreground'
                      : 'text-muted-foreground hover:bg-tonal-hover hover:text-foreground',
                  )}
                >
                  {active ? (
                    // Current page = tonal-selected + the 3px primary bar. Never brand green.
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-primary"
                    />
                  ) : null}
                  <Icon className="h-[var(--icon-sm)] w-[var(--icon-sm)] shrink-0" aria-hidden="true" />
                  <span className={rail ? 'sr-only' : 'truncate'}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-foreground">
      {/* Header — 56px (`--layout-header`), strictly aligned with workspace header */}
      <header className="relative z-sticky flex h-[var(--layout-header)] shrink-0 items-center border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-content items-center gap-3 px-4 sm:px-6">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开管理导航"
            className="md:hidden"
            icon={<Menu className="h-[var(--icon-md)] w-[var(--icon-md)]" aria-hidden="true" />}
          />

          <Link
            href="/generate"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
          >
            <ChevronRight className="h-[var(--icon-sm)] w-[var(--icon-sm)] rotate-180" aria-hidden="true" />
            返回创作端
          </Link>

          <Breadcrumbs pathname={pathname} />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ThemeToggle />
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline">{user.email}</span>
            {/* Decorative: the address next to it is the label, so the letter glyph
                must not be announced a second time. */}
            <Avatar size="sm" initial={userInitial} decorative />
          </div>
        </div>
      </header>

      {/* Main container — strictly matches workspace generation layout max-w-content rhythm */}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
        <div className="flex min-h-0 w-full max-w-content flex-1 overflow-hidden">
          {/* Sidebar — `--layout-sidebar` 260px, collapsing to the 64px icon rail */}
          <aside
            className={cn(
              'hidden shrink-0 flex-col border-r border-border bg-surface py-3',
              'transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)] md:flex',
              collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
            )}
          >
            <nav className="flex w-full flex-1 flex-col overflow-hidden px-2" aria-label="管理后台导航">
              <div className="min-h-0 flex-1 overflow-y-auto">{renderNavLinks({ rail: collapsed })}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                aria-label={collapsed ? '展开导航栏' : '折叠导航栏'}
                aria-pressed={collapsed}
                className={cn('mt-2 text-muted-foreground', collapsed && 'justify-center px-0')}
                icon={
                  collapsed ? (
                    <PanelLeftOpen className="h-[var(--icon-sm)] w-[var(--icon-sm)]" aria-hidden="true" />
                  ) : (
                    <PanelLeftClose className="h-[var(--icon-sm)] w-[var(--icon-sm)]" aria-hidden="true" />
                  )
                }
              >
                {!collapsed && <span className="text-sm font-medium">折叠</span>}
              </Button>
            </nav>
          </aside>

          {/* Main content — 16/24/32px padding rhythm */}
          <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
            {children}
          </main>
        </div>
      </div>

      {/* Narrow-viewport (`max-md`) overlay drawer */}
      {drawerMounted && drawerPortalTarget && createPortal(
        <div
          {...drawerRootProps}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDrawer()
          }}
          className={cn(
            'fixed inset-0 z-overlay md:hidden',
            drawerPhase === 'close' ? 'motion-fade-out pointer-events-none' : 'motion-fade-in',
          )}
        >
          <div
            className="fixed inset-0 bg-overlay/40"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            {...drawerDialogProps}
            className={cn(
              'fixed inset-y-0 left-0 z-modal flex w-full max-w-sidebar flex-col gap-4 bg-surface p-4 shadow-drawer',
              drawerPhase === 'close' ? 'motion-drawer-out-left' : 'motion-drawer-in-left',
            )}
          >
            {/* Dialog-class surface: no rule inside the panel, spacing does the work. */}
            <div className="flex items-center justify-between gap-3">
              <h2 id={drawerLabelId} className="text-module text-foreground">
                管理后台导航
              </h2>
              <IconButton
                ref={drawerCloseButtonRef}
                variant="ghost"
                size="sm"
                onClick={closeDrawer}
                aria-label="关闭导航"
                icon={<X className="h-[var(--icon-md)] w-[var(--icon-md)]" aria-hidden="true" />}
              />
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="管理后台导航">
              {renderNavLinks({ onNavigate: closeDrawer })}
            </nav>
          </div>
        </div>,
        drawerPortalTarget,
      )}
    </div>
  )
}
