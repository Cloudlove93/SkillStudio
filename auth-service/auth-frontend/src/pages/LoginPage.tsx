import { useState, useRef } from 'react'
import { useNavigate } from 'react-router'
import { UserCircle } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { getPostAuthDestination, sendSmsCode } from '@/api/auth'
import { PhoneInput } from '@/components/phone-input'
import { translateApiError, useAuthI18n } from '@/i18n/auth-i18n'
import {
  AuthPageShell,
  FieldError,
  LoginFooter,
  ModeTabs,
  PasswordPill,
  PillInput,
  SmsCodeInput,
  type AuthMode,
} from './auth-form-parts'
import { mapFieldMessages, useCountdown } from './auth-form-hooks'

type LoginField = 'username' | 'password' | 'phone' | 'smsCode'

export function LoginPage() {
  const { loginWithPassword, loginWithPhone } = useAuthStore()
  const { locale, t } = useAuthI18n()
  const navigate = useNavigate()

  const [mode, setMode] = useState<AuthMode>('password')
  const [invalidFields, setInvalidFields] = useState<LoginField[]>([])
  const [loading, setLoading] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [otpId, setOtpId] = useState('')
  const { countdown, startCountdown } = useCountdown()
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({})
  const usernameRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  const smsCodeRef = useRef<HTMLInputElement | null>(null)

  const returnTo = new URLSearchParams(window.location.search).get('returnTo')
  const registerTo = returnTo ? `/register?returnTo=${encodeURIComponent(returnTo)}` : '/register'

  async function handleSendCode() {
    if (!phone.trim()) {
      setFieldErrors({ phone: t('auth.validation.phoneRequired') })
      focusField(phoneRef)
      return
    }
    setFieldErrors({})
    setLoading(true)
    try {
      const id = await sendSmsCode(phone.trim())
      setOtpId(id)
      startCountdown()
    } catch (err) {
      setInvalidFields(['phone'])
      setFieldErrors({ phone: getApiErrorMessage(err, t('auth.validation.sendCodeFailed')) })
      focusField(phoneRef)
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    const missingFields: LoginField[] = []
    if (!username.trim()) missingFields.push('username')
    if (!password) missingFields.push('password')
    if (!validateRequiredFields(missingFields, {
      username: t('auth.validation.accountRequired'),
      password: t('auth.validation.passwordRequired'),
    })) return

    setLoading(true)
    try {
      await loginWithPassword(username.trim(), password)
      goAfterAuth()
    } catch (err) {
      setInvalidFields(['username', 'password'])
      setFieldErrors({ password: getPasswordLoginErrorMessage(err) })
      focusField(passwordRef)
      setLoading(false)
    }
  }

  async function handleSmsSubmit(e: React.FormEvent) {
    e.preventDefault()
    const missingFields: LoginField[] = []
    if (!phone.trim()) missingFields.push('phone')
    if (!smsCode.trim()) missingFields.push('smsCode')
    if (!validateRequiredFields(missingFields, {
      phone: t('auth.validation.phoneRequired'),
      smsCode: t('auth.validation.smsCodeRequired'),
    })) return

    if (!otpId) {
      setFieldErrors({ phone: t('auth.validation.sendCodeFirst') })
      focusField(phoneRef)
      return
    }
    setLoading(true)
    try {
      await loginWithPhone(phone.trim(), smsCode.trim(), otpId)
      goAfterAuth()
    } catch (err) {
      const field = getSmsLoginErrorField(err)
      setInvalidFields([field])
      setFieldErrors({ [field]: getApiErrorMessage(err, t('auth.validation.loginFailed')) })
      focusField(field === 'phone' ? phoneRef : smsCodeRef)
      setLoading(false)
    }
  }

  function goAfterAuth() {
    const dest = getPostAuthDestination()
    if (dest.startsWith('/')) {
      navigate(dest, { replace: true })
    } else {
      window.location.href = dest
    }
  }

  function switchMode(m: AuthMode) {
    setMode(m)
    setInvalidFields([])
    setFieldErrors({})
  }

  const formShellClass = 'mt-11 flex min-h-[304px] flex-col'
  const formFieldsClass = 'space-y-6'
  const fieldShellClass = 'flex h-[58px] items-center rounded-full border border-transparent bg-[#f4f4f4] px-6 text-[#0a0a28] transition-[border-color,background-color,box-shadow] sm:h-[66px]'
  const inputClass = 'h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] sm:text-[20px]'
  const passwordInputClass = 'login-password-input h-full min-w-0 flex-1 bg-transparent pr-4 text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] sm:text-[20px]'
  const titleClassName = locale === 'zh'
    ? 'text-center text-[30px] font-semibold tracking-[0.28em] text-[#0a0a28] sm:text-[34px]'
    : 'text-center text-[30px] font-semibold tracking-[0.08em] text-[#0a0a28] sm:text-[34px]'

  function isInvalid(field: LoginField) {
    return invalidFields.includes(field)
  }

  function clearInvalidField(field: LoginField) {
    setInvalidFields(prev => prev.filter(item => item !== field))
    setFieldErrors(prev => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function focusField(ref: React.RefObject<HTMLInputElement | null>) {
    requestAnimationFrame(() => ref.current?.focus())
  }

  function focusFirstInvalidField(fields: LoginField[]) {
    const fieldRefs: Record<LoginField, React.RefObject<HTMLInputElement | null>> = {
      username: usernameRef,
      password: passwordRef,
      phone: phoneRef,
      smsCode: smsCodeRef,
    }
    focusField(fieldRefs[fields[0]])
  }

  function validateRequiredFields(
    fields: LoginField[],
    messages: Partial<Record<LoginField, string>>
  ) {
    if (fields.length === 0) {
      setInvalidFields([])
      setFieldErrors({})
      return true
    }

    setInvalidFields(fields)
    setFieldErrors(mapFieldMessages(fields, messages, t('auth.validation.required')))
    focusFirstInvalidField(fields)
    return false
  }

  function getPasswordLoginErrorMessage(err: unknown) {
    if (/required|missing|empty|必填/i.test(getApiErrorMessage(err))) {
      return t('auth.validation.accountPasswordRequired')
    }

    return t('auth.validation.badCredentials')
  }

  function getSmsLoginErrorField(err: unknown): Extract<LoginField, 'phone' | 'smsCode'> {
    const message = getApiErrorMessage(err)
    return /手机|phone|未注册/i.test(message) ? 'phone' : 'smsCode'
  }

  function getApiErrorMessage(err: unknown, fallback = t('common.operationFailed')) {
    const message = err instanceof Error && err.message ? err.message : ''
    return translateApiError(message, locale, fallback)
  }

  function renderUsernameField() {
    return (
      <>
        <PillInput
          inputRef={usernameRef}
          icon={<UserCircle className="size-6" />}
          type="text"
          placeholder={t('auth.accountOrEmail')}
          autoComplete="username"
          value={username}
          onChange={(value) => {
            setUsername(value)
            clearInvalidField('username')
          }}
          shellClassName={fieldShellClass}
          inputClassName={inputClass}
          invalid={isInvalid('username')}
        />
        <FieldError message={fieldErrors.username} />
      </>
    )
  }

  return (
    <AuthPageShell
      gridClassName="relative z-10 mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 items-center px-6 py-10 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-16 lg:px-20 xl:gap-28"
      panelClassName="mx-auto w-full max-w-[420px] rounded-[28px] bg-white px-8 pb-10 pt-9 shadow-[0_18px_50px_rgba(96,132,210,0.12)] sm:max-w-[500px] sm:rounded-[36px] sm:px-12 sm:pb-14 sm:pt-12 lg:max-w-[520px] lg:px-14"
      title={t('auth.loginTitle')}
      titleClassName={titleClassName}
    >
          <ModeTabs
            mode={mode}
            onChange={switchMode}
            labels={{ password: t('auth.passwordLogin'), sms: t('auth.smsLogin') }}
            className="mt-10 flex h-[68px] rounded-full border border-[#dce4ff] bg-white p-0.5"
          />

          {mode === 'password' ? (
            <form onSubmit={handlePasswordSubmit} noValidate className={formShellClass}>
              <div className={formFieldsClass}>
                {renderUsernameField()}
                <PasswordPill
                  inputRef={passwordRef}
                  placeholder={t('auth.password')}
                  value={password}
                  onChange={(value) => {
                    setPassword(value)
                    clearInvalidField('password')
                  }}
                  visible={showPassword}
                  onToggleVisible={() => setShowPassword(prev => !prev)}
                  autoComplete="current-password"
                  shellClassName={fieldShellClass}
                  inputClassName={passwordInputClass}
                  invalid={isInvalid('password')}
                />
                <FieldError message={fieldErrors.password} />
              </div>

              <LoginFooter registerTo={registerTo} loading={loading} />
            </form>
          ) : (
            <form onSubmit={handleSmsSubmit} noValidate className={formShellClass}>
              <div className={formFieldsClass}>
                <PhoneInput
                  inputRef={phoneRef}
                  value={phone}
                  onChange={(value) => {
                    setPhone(value)
                    clearInvalidField('phone')
                  }}
                  disabled={loading}
                  placeholder={t('auth.phone')}
                  variant="pill"
                  className={isInvalid('phone') ? 'auth-field-invalid' : ''}
                />
                <FieldError message={fieldErrors.phone} />
                <SmsCodeInput
                  inputRef={smsCodeRef}
                  value={smsCode}
                  onChange={(value) => {
                    setSmsCode(value)
                    clearInvalidField('smsCode')
                  }}
                  onSend={handleSendCode}
                  loading={loading}
                  countdown={countdown}
                  phone={phone}
                  shellClassName={fieldShellClass}
                  inputClassName={inputClass}
                  invalid={isInvalid('smsCode')}
                />
                <FieldError message={fieldErrors.smsCode} />
              </div>

              <LoginFooter registerTo={registerTo} loading={loading} disabled={loading || !otpId} />
            </form>
          )}
    </AuthPageShell>
  )
}
