'use client'

import { useCallback, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { API_ENDPOINTS } from '@musecanvas/contracts'
import { ArrowLeftIcon as ArrowLeft, EnvelopeSimpleIcon as Mail } from '@phosphor-icons/react'
import { api } from '@/shared/services/api'
import { useAuthUiStore } from '@/shared/stores/auth-ui-store'
import type { User } from '@/shared/types'
import { safeRedirectPath } from '@/shared/lib/app-routes'
import {
  Button,
  FieldGroup,
  FormField,
  IconButton,
  Input,
  buttonVariants,
} from '@/shared/components/ui'
import { GithubIcon, GoogleIcon } from '@/shared/components/brand-icons'

type Step = 'email' | 'invitation' | 'otp'
/** Every step owns exactly one field, so a failed request has a home to report in. */
type FieldKey = 'email' | 'invitation' | 'otp'
type FieldErrors = Partial<Record<FieldKey, string>>

const fieldOfStep: Record<Step, FieldKey> = {
  email: 'email',
  invitation: 'invitation',
  otp: 'otp',
}

/** Shape check only — the backend stays the authority on whether an address exists. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** copy.md §4: 发生了什么 + 为什么 + 如何解决. */
const NETWORK_ERROR = '网络连接失败。设备可能未联网或后端服务暂时不可用，请检查网络后重试。'
const OTP_SEND_FAILED = '验证码发送失败。请确认邮箱地址填写无误，稍后重新发送。'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = safeRedirectPath(searchParams.get('from'))

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  // Focus lands on the first invalid field after a submit (components.md → Inline
  // error), never while the user is still typing.
  const inputRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({})
  const focusFirstError = useCallback((next: FieldErrors) => {
    const first = (Object.keys(fieldOfStep) as FieldKey[]).find((key) => Boolean(next[key]))
    if (first) inputRefs.current[first]?.focus()
  }, [])

  const setUser = useAuthUiStore((s) => s.setUser)

  /** Typing clears only the field's own error, so a hint never fights another. */
  function clearFieldError(key: FieldKey) {
    setErrors((previous) => {
      if (!previous[key]) return previous
      const next: FieldErrors = { ...previous }
      delete next[key]
      return next
    })
  }

  function reportFailure(message: string) {
    const next: FieldErrors = {}
    next[fieldOfStep[step]] = message
    setErrors(next)
    focusFirstError(next)
  }

  async function handleSendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedEmail = email.trim()
    const next: FieldErrors = {}
    if (!trimmedEmail) {
      next.email = '邮箱地址不能为空。请填写用于接收登录验证码的邮箱地址。'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      next.email = '邮箱地址格式不正确。请确认包含 @ 和完整域名，例如 name@example.com。'
    }
    if (step === 'invitation' && !invitationCode.trim()) {
      next.invitation = '邀请码不能为空。请填写收到的邀请码，每个邀请码通常只能使用一次。'
    }

    setErrors(next)
    if (next.email || next.invitation) {
      focusFirstError(next)
      return
    }

    setLoading(true)

    try {
      const res = await api<{ accepted: boolean; nextStep: 'invitation' | 'otp' }>(
        API_ENDPOINTS.auth.otpRequest,
        {
          method: 'POST',
          body: { email: trimmedEmail, invitationCode: invitationCode.trim() || undefined },
        },
      )
      setLoading(false)

      if (res.success && res.data) {
        setStep(res.data.nextStep)
        return
      }
      reportFailure(res.error?.message || OTP_SEND_FAILED)
    } catch {
      setLoading(false)
      reportFailure(NETWORK_ERROR)
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!otpCode.trim()) {
      const next: FieldErrors = { otp: '验证码不能为空。请输入邮件中收到的 6 位验证码。' }
      setErrors(next)
      focusFirstError(next)
      return
    }

    setLoading(true)

    try {
      const res = await api<{ user: User }>(API_ENDPOINTS.auth.otpVerify, {
        method: 'POST',
        body: {
          email: email.trim(),
          code: otpCode.trim(),
          invitationCode: invitationCode.trim() || undefined,
        },
      })
      setLoading(false)

      if (res.success && res.data?.user) {
        setUser(res.data.user)
        router.push(from)
        router.refresh()
        return
      }
      reportFailure(
        res.error?.message || '验证码错误或已过期。请输入邮件中最新的一条验证码，或返回上一步重新发送。',
      )
    } catch {
      setLoading(false)
      reportFailure(NETWORK_ERROR)
    }
  }

  /** Returns to the email step; the typed values stay in state (失败保留输入). */
  function backToEmail() {
    setErrors({})
    setStep('email')
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-title text-foreground">
          {step === 'otp' ? '输入验证码' : step === 'invitation' ? '需要邀请码' : '登录\u00A0MuseCanvas'}
        </h1>
        <p
          className={`min-w-0 text-sm text-muted-foreground [text-wrap:pretty] ${
            step === 'otp' ? '[overflow-wrap:anywhere]' : ''
          }`}
        >
          {step === 'otp'
            ? `验证码已发送至 ${email}，请在下方输入邮件里的 6 位验证码。`
            : step === 'invitation'
              ? '当前平台处于邀请测试期，请填写有效邀请码。'
              : '无需复杂密码，通过邮箱验证码登录。'}
        </p>
      </header>

      {step === 'email' && (
        <form noValidate onSubmit={handleSendOtp} className="flex flex-col gap-6">
          <FieldGroup>
            <FormField
              id="email"
              label="邮箱地址"
              required
              hint="邮箱只用于登录与作品找回。"
              error={errors.email}
            >
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearFieldError('email')
                }}
                placeholder="name@example.com"
                ref={(node) => {
                  inputRefs.current.email = node
                }}
              />
            </FormField>
          </FieldGroup>

          <Button
            type="submit"
            loading={loading}
            fullWidth
            icon={<Mail weight="bold" aria-hidden="true" />}
          >
            获取登录验证码
          </Button>
        </form>
      )}

      {step === 'invitation' && (
        <form noValidate onSubmit={handleSendOtp} className="flex flex-col gap-6">
          <FieldGroup>
            <FormField
              id="invite"
              label="邀请码"
              required
              hint="邀请码由发放方提供，可能只能使用一次。"
              error={errors.invitation}
            >
              <Input
                type="text"
                autoComplete="off"
                value={invitationCode}
                onChange={(event) => {
                  setInvitationCode(event.target.value)
                  clearFieldError('invitation')
                }}
                placeholder="请填写邀请码"
                ref={(node) => {
                  inputRefs.current.invitation = node
                }}
              />
            </FormField>
          </FieldGroup>

          <div className="flex items-center gap-3">
            <IconButton
              variant="secondary"
              aria-label="返回上一步，检查邮箱地址"
              onClick={backToEmail}
              icon={<ArrowLeft weight="bold" aria-hidden="true" />}
            />
            <Button type="submit" loading={loading} className="flex-1">
              确认并发送验证码
            </Button>
          </div>
        </form>
      )}

      {step === 'otp' && (
        <form noValidate onSubmit={handleVerifyOtp} className="flex flex-col gap-6">
          <FieldGroup>
            <FormField
              id="otp"
              label={`6\u00A0位验证码`}
              required
              hint={`发送至 ${email}`}
              error={errors.otp}
            >
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={otpCode}
                onChange={(event) => {
                  setOtpCode(event.target.value)
                  clearFieldError('otp')
                }}
                placeholder="123456"
                className="text-center font-mono tracking-widest"
                ref={(node) => {
                  inputRefs.current.otp = node
                }}
              />
            </FormField>
          </FieldGroup>

          <div className="flex items-center gap-3">
            <IconButton
              variant="secondary"
              aria-label="返回上一步，重新填写邮箱地址"
              onClick={backToEmail}
              icon={<ArrowLeft weight="bold" aria-hidden="true" />}
            />
            <Button type="submit" loading={loading} className="flex-1">
              验证并登录
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-center text-sm text-muted-foreground">或使用第三方账号登录</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={API_ENDPOINTS.auth.oauthStart('github')}
            className={buttonVariants({ variant: 'secondary', className: 'flex-1 gap-2' })}
          >
            <GithubIcon className="h-5 w-5 shrink-0" />
            <span>使用 GitHub 登录</span>
          </a>
          <a
            href={API_ENDPOINTS.auth.oauthStart('google')}
            className={buttonVariants({ variant: 'secondary', className: 'flex-1 gap-2' })}
          >
            <GoogleIcon className="h-5 w-5 shrink-0" />
            <span>使用 Google 登录</span>
          </a>
        </div>
      </div>
    </div>
  )
}
