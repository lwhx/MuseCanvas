import Link from 'next/link'
import {
  ArrowRight,
  Download,
  Layers3,
  Library,
  Mail,
  PenLine,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  WandSparkles,
} from 'lucide-react'
import { Reveal } from '@/shared/components/reveal'
import { Card, CardBody, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { PublicHeader } from '@/shared/components/public-header'
import { SiteFooter } from '@/shared/components/site-footer'
// `button-variants` is the directive-free half of the button primitive, which is
// the whole reason this page can use it: a server component may render a client
// module but never *call* its exports, so `buttonVariants` is imported from the
// recipe module instead of mirrored here.
import { buttonVariants } from '@/shared/components/ui/button-variants'
import { cn } from '@/shared/lib/cn'
import { iconSize } from '@/shared/components/ui'

export const dynamic = 'force-static'

export const metadata = {
  title: 'MuseCanvas - 把灵感整理成可生成的画面',
  description: '面向创作者的 AI 图像生成工作台：提示词、画幅与参考图、任务队列和作品图库保持在同一条创作路径上。',
}

const heroPrimary = buttonVariants({ variant: 'primary', size: 'lg' })
const heroGhost = buttonVariants({ variant: 'ghost', size: 'lg' })

const consoleSpecs: { label: string; value: string; mono?: boolean }[] = [
  // 断行策略：数字与单位、名与版本之间用不断行空格绑定；` / ` 与 ` · ` 两侧留普通空格，允许在分隔符处换行
  { label: '生成模型', value: 'GPT Image 2.5 / Seedream 4.5', mono: true },
  { label: '画幅', value: '1:1 · 16:9 · 9:16 · 4:3 · 3:4', mono: true },
  { label: '单次张数', value: '1 / 2 / 4 张', mono: true },
  { label: '参考图', value: '最多 4 张，PNG / JPEG', mono: true },
]

const capabilities = [
  {
    title: '提示词不需要套模板',
    description:
      '写下主体、场景、材质、光线，以及想避开的元素就够了。风格模板由系统侧统一维护，提交前不必手动挑选。',
    icon: WandSparkles,
  },
  {
    title: '模型、画幅与参考图',
    description:
      '在同一个面板里切换模型、5 种画幅和单次张数，并上传 PNG 或 JPEG 参考图作为构图与风格依据。',
    icon: Layers3,
  },
  {
    title: '排队、重试与取消',
    description:
      '任务提交后进入队列按序执行，失败会自动重试；也可以只对失败的任务手动重跑，或在结束前取消。',
    icon: Repeat,
  },
  {
    title: '作品自动沉淀',
    description:
      '生成结果自动进入图库。调整网格密度、放大比对细节、下载原图，或者单张、批量删除不要的版本。',
    icon: Library,
  },
  {
    title: '验证码登录',
    description:
      '用邮箱接收 6 位验证码直接进入，不需要再记一个密码；也支持 GitHub 与 Google 账号。部署方可切换为邀请码注册。',
    icon: Mail,
  },
  {
    title: '自托管与后台',
    description:
      '通过初始化向导完成部署配置，任务、用户、模型与提供商、提示词模板、OAuth 都有各自的管理页面。',
    icon: ShieldCheck,
  },
]

const workflowSteps = [
  {
    title: '写下画面',
    description: '用自然语言描述构图与氛围，需要延续某张图的感觉时，直接把它作为参考图上传。',
    icon: PenLine,
  },
  {
    title: '确定输出',
    description: '选择模型、画幅和单次张数，提交后任务进入队列，每条任务的状态都可以在创作台里跟着看。',
    icon: SlidersHorizontal,
  },
  {
    title: '回看与下载',
    description: '完成后结果自动出现在图库，按时间回看、放大比对、下载原图，或删除不满意的版本。',
    icon: Download,
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-foreground antialiased">
      <PublicHeader current="landing" />

      <main>
        {/* Hero：营销模式 — 上下 96px（桌面）/ 64px（手机），内容 `max-w-content` 居中 */}
        <Reveal trigger="load">
          <section className="scroll-mt-16">
            <div className="mx-auto grid w-full max-w-content items-start gap-12 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)] lg:py-24">
              <div className="max-w-2xl">
                <h1 className="text-display text-foreground">MuseCanvas</h1>
                {/* 副标题是 20px 的 subtitle + secondary 色，不再继承 Display */}
                <p className="mt-4 text-subtitle text-muted-foreground [line-break:strict] [text-wrap:balance]">
                  把灵感整理成可生成的画面
                </p>

                <p className="mt-6 max-w-xl text-base text-muted-foreground [text-wrap:pretty]">
                  从提示词、模型与画幅，到任务队列和作品图库，一次生成经过的每个环节都留在同一条清晰的创作路径里。
                </p>

                {/* CTA 成对：primary（墨色）+ ghost */}
                <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <Link href="/login" className={heroPrimary}>
                    开始创作
                    <ArrowRight aria-hidden="true" />
                  </Link>
                  <Link href="#workflow" className={heroGhost}>
                    看看创作流程
                  </Link>
                </div>
              </div>

              {/* Console overview — 参数为创作台当前真实可选项 */}
              <aside
                aria-labelledby="console-overview-title"
                className="overflow-hidden rounded-panel bg-surface shadow-soft"
              >
                <div className="flex items-baseline justify-between gap-4 px-6 pb-4 pt-5">
                  <h2 id="console-overview-title" className="whitespace-nowrap text-sm font-medium text-foreground">
                    创作台速览
                  </h2>
                  <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">/generate</span>
                </div>

                <dl className="mx-6 pb-5">
                  {consoleSpecs.map((spec) => (
                    <div
                      key={spec.label}
                      className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[5.5rem_1fr] sm:gap-4"
                    >
                      <dt className="whitespace-nowrap text-sm text-muted-foreground">{spec.label}</dt>
                      <dd
                        className={cn(
                          'text-sm text-foreground',
                          spec.mono ? 'font-mono tabular-nums' : '[text-wrap:pretty]',
                        )}
                      >
                        {spec.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </aside>
            </div>
          </section>
        </Reveal>

        {/* Capabilities：卡片网格 2–3 列，间距 32px，卡片为图标 + 标题 + 描述 */}
        <section id="capabilities" aria-labelledby="capabilities-title" className="scroll-mt-16">
          <Reveal>
            <div className="mx-auto w-full max-w-content px-4 py-16 sm:px-6 lg:py-24">
              <header className="max-w-3xl">
                <h1 className="text-title text-foreground">产品能力</h1>
                <h2
                  id="capabilities-title"
                  className="mt-3 text-section text-foreground [line-break:strict] [text-wrap:balance]"
                >
                  一次生成要经过的环节，都收在同一个工作台里
                </h2>
              </header>

              <ul className="mt-10 grid gap-8 sm:grid-cols-2 md:grid-cols-3">
                {capabilities.map((capability) => {
                  const Icon = capability.icon
                  return (
                    <li key={capability.title}>
                      <Card className="h-full">
                        <Icon className={`${iconSize.lg} text-muted-foreground`} aria-hidden="true" />
                        <CardHeader>
                          <CardTitle level={3}>{capability.title}</CardTitle>
                        </CardHeader>
                        <CardBody>
                          <p className="text-sm text-muted-foreground [text-wrap:pretty]">{capability.description}</p>
                        </CardBody>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Workflow：surface 台阶把这一段从画布上分开，区块之间仍是 64–96px */}
        <section id="workflow" aria-labelledby="workflow-title" className="scroll-mt-16 bg-surface">
          <Reveal>
            <div className="mx-auto grid w-full max-w-content gap-12 px-4 py-16 sm:px-6 md:grid-cols-[0.8fr_1fr] lg:py-24">
              <div className="max-w-xl">
                <h1 className="text-title text-foreground">创作流程</h1>
                <h2
                  id="workflow-title"
                  className="mt-3 text-section text-foreground [line-break:strict] [text-wrap:balance]"
                >
                  不把灵感塞进表单，而是放进流程
                </h2>
                <p className="mt-4 text-base text-muted-foreground [text-wrap:pretty]">
                  登录后进入的不是一个功能堆叠的后台，而是一个专注的生成工作区：描述画面、确定输出、回看结果，三步之间没有需要来回搬运的中间状态。
                </p>
              </div>

              <ul className="grid gap-8">
                {workflowSteps.map((step) => {
                  const StepIcon = step.icon
                  return (
                    <li key={step.title} className="flex min-w-0 flex-col gap-1">
                      <h3 className="flex items-center gap-2 text-subtitle text-foreground [line-break:strict]">
                        <StepIcon className={`${iconSize.md} shrink-0 text-muted-foreground`} aria-hidden="true" />
                        {step.title}
                      </h3>
                      <p className="text-sm text-muted-foreground [text-wrap:pretty]">{step.description}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* CTA：tonal 底色分区，居中排版 */}
        <section aria-labelledby="cta-title" className="bg-tonal">
          <Reveal>
            <div className="mx-auto flex w-full max-w-content flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 lg:py-24">
              <h2 id="cta-title" className="text-section text-foreground [line-break:strict] [text-wrap:balance]">
                准备好让第一段描述成形了吗？
              </h2>
              <p className="max-w-2xl text-base text-muted-foreground [text-wrap:pretty]">
                登录后即进入创作台：写下提示词、选择画幅与张数，生成的作品会直接出现在你的图库里。
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <Link href="/login" className={heroPrimary}>
                  进入 MuseCanvas
                  <ArrowRight aria-hidden="true" />
                </Link>
                <Link href="/terms" className={heroGhost}>
                  先看用户协议
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter current="landing" />
    </div>
  )
}
