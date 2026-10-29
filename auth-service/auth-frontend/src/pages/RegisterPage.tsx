import { useState, useRef, useMemo } from 'react'
import { Mail, UserCircle } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { getPostAuthDestination, sendSmsCode } from '@/api/auth'
import { PhoneInput } from '@/components/phone-input'
import { translateApiError, useAuthI18n } from '@/i18n/auth-i18n'
import {
  AuthPageShell,
  AuthField,
  getPasswordChecks,
  ModeTabs,
  PasswordHints,
  PasswordPill,
  PillInput,
  RegisterForm,
  SmsCodeInput,
  type AuthMode,
} from './auth-form-parts'
import { mapFieldMessages, useCountdown } from './auth-form-hooks'

type RegisterField = 'username' | 'email' | 'phone' | 'smsCode' | 'password' | 'confirmPassword'

export function RegisterPage() {
  const { registerWithPassword, registerWithPhone } = useAuthStore()
  const { locale, t } = useAuthI18n()

  const [mode, setMode] = useState<AuthMode>('password')
  const [invalidFields, setInvalidFields] = useState<RegisterField[]>([])
  const [loading, setLoading] = useState(false)

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [otpId, setOtpId] = useState('')
  const { countdown, startCountdown } = useCountdown()
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegisterField, string>>>({})
  const usernameRef = useRef<HTMLInputElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  const smsCodeRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null)

  const returnTo = new URLSearchParams(window.location.search).get('returnTo')
  const loginTo = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'
  const passwordChecks = useMemo(() => getPasswordChecks(password, confirmPassword), [password, confirmPassword])

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

  function validatePassword(nextPassword: string, nextConfirmPassword?: string) {
    if (!getPasswordChecks(nextPassword).every(check => check.ok)) {
      setFieldErrors({ password: t('auth.validation.passwordComplexity') })
      setInvalidFields(['password'])
      focusField(passwordRef)
      return false
    }
    if (nextConfirmPassword !== undefined && nextPassword !== nextConfirmPassword) {
      setFieldErrors({ confirmPassword: t('auth.validation.passwordMismatch') })
      setInvalidFields(['confirmPassword'])
      focusField(confirmPasswordRef)
      return false
    }
    return true
  }

  function validateEmail(nextEmail: string) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return true
    }

    setFieldErrors({ email: t('auth.validation.emailInvalid') })
    setInvalidFields(['email'])
    focusField(emailRef)
    return false
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    const missingFields: RegisterField[] = []
    if (!username.trim()) missingFields.push('username')
    if (!email.trim()) missingFields.push('email')
    if (!password) missingFields.push('password')
    if (!confirmPassword) missingFields.push('confirmPassword')
    if (!validateRequiredFields(missingFields, {
      username: t('auth.validation.usernameRequired'),
      email: t('auth.validation.emailRequired'),
      password: t('auth.validation.passwordRequired'),
      confirmPassword: t('auth.validation.confirmPasswordRequired'),
    })) return

    setFieldErrors({})
    if (!validateEmail(email.trim())) return
    if (!validatePassword(password, confirmPassword)) return

    setInvalidFields([])
    setLoading(true)
    try {
      await registerWithPassword(username.trim(), email.trim(), password)
      window.location.href = getPostAuthDestination()
    } catch (err) {
      const field = getPasswordRegisterErrorField(err)
      setInvalidFields([field])
      setFieldErrors({ [field]: getApiErrorMessage(err, t('auth.validation.registerFailed')) })
      focusFirstInvalidField([field])
      setLoading(false)
    }
  }

  async function handleSmsSubmit(e: React.FormEvent) {
    e.preventDefault()
    const missingFields: RegisterField[] = []
    if (!username.trim()) missingFields.push('username')
    if (!phone.trim()) missingFields.push('phone')
    if (!smsCode.trim()) missingFields.push('smsCode')
    if (!password) missingFields.push('password')
    if (!confirmPassword) missingFields.push('confirmPassword')
    if (!validateRequiredFields(missingFields, {
      username: t('auth.validation.usernameRequired'),
      phone: t('auth.validation.phoneRequired'),
      smsCode: t('auth.validation.smsCodeRequired'),
      password: t('auth.validation.passwordRequired'),
      confirmPassword: t('auth.validation.confirmPasswordRequired'),
    })) return

    if (!otpId) {
      setFieldErrors({ phone: t('auth.validation.sendCodeFirst') })
      focusField(phoneRef)
      return
    }
    if (!validatePassword(password, confirmPassword)) return

    setInvalidFields([])
    setLoading(true)
    try {
      await registerWithPhone(phone.trim(), smsCode.trim(), otpId, username.trim(), password)
      window.location.href = getPostAuthDestination()
    } catch (err) {
      const field = getSmsRegisterErrorField(err)
      setInvalidFields([field])
      setFieldErrors({ [field]: getApiErrorMessage(err, t('auth.validation.registerFailed')) })
      focusFirstInvalidField([field])
      setLoading(false)
    }
  }

  function switchMode(m: AuthMode) {
    setMode(m)
    setInvalidFields([])
    setFieldErrors({})
  }

  function focusInputWithManagedScroll(
    input: HTMLInputElement | null,
    block: ScrollLogicalPosition = 'nearest'
  ) {
    if (!input) return

    input.focus({ preventScroll: true })

    requestAnimationFrame(() => {
      const field = input.closest('[data-auth-field]')
        ?? input.closest('label')
        ?? input.parentElement
      if (!field) return
      field.scrollIntoView({
        behavior: 'smooth',
        block,
        inline: 'nearest',
      })
    })
  }

  function focusField(ref: React.RefObject<HTMLInputElement | null>) {
    requestAnimationFrame(() => focusInputWithManagedScroll(ref.current, 'center'))
  }

  function focusFirstInvalidField(fields: RegisterField[]) {
    const fieldRefs: Record<RegisterField, React.RefObject<HTMLInputElement | null>> = {
      username: usernameRef,
      email: emailRef,
      phone: phoneRef,
      smsCode: smsCodeRef,
      password: passwordRef,
      confirmPassword: confirmPasswordRef,
    }
    focusField(fieldRefs[fields[0]])
  }

  function validateRequiredFields(
    fields: RegisterField[],
    messages: Partial<Record<RegisterField, string>>
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

  function getPasswordRegisterErrorField(err: unknown): RegisterField {
    const message = getApiErrorMessage(err)
    if (/邮箱|email/i.test(message)) return 'email'
    if (/密码|password/i.test(message)) return 'password'
    return 'username'
  }

  function getSmsRegisterErrorField(err: unknown): RegisterField {
    const message = getApiErrorMessage(err)
    if (/验证码|code|otp/i.test(message)) return 'smsCode'
    if (/手机|phone/i.test(message)) return 'phone'
    if (/密码|password/i.test(message)) return 'password'
    return 'username'
  }

  function getApiErrorMessage(err: unknown, fallback = t('common.operationFailed')) {
    const message = err instanceof Error && err.message ? err.message : ''
    return translateApiError(message, locale, fallback)
  }

  function isInvalid(field: RegisterField) {
    return invalidFields.includes(field)
  }

  function clearInvalidField(field: RegisterField) {
    setInvalidFields(prev => prev.filter(item => item !== field))
    setFieldErrors(prev => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function renderUsernameField() {
    return (
      <AuthField error={fieldErrors.username}>
        <PillInput
          inputRef={usernameRef}
          icon={<UserCircle className="size-6" />}
          type="text"
          placeholder={t('auth.username')}
          autoComplete="username"
          value={username}
          onChange={(value) => {
            setUsername(value)
            clearInvalidField('username')
          }}
          invalid={isInvalid('username')}
        />
      </AuthField>
    )
  }

  const passwordHintsRef = useRef<HTMLDivElement | null>(null)

  function scrollToHints() {
    requestAnimationFrame(() => {
      passwordHintsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function renderPasswordFields() {
    return (
      <>
        <AuthField error={fieldErrors.password}>
          <PasswordPill
            inputRef={passwordRef}
            placeholder={t('auth.password')}
            value={password}
            onChange={(value) => {
              setPassword(value)
              clearInvalidField('password')
              if (value.length === 1) scrollToHints()
            }}
            visible={showPassword}
            onToggleVisible={() => setShowPassword(prev => !prev)}
            invalid={isInvalid('password')}
          />
        </AuthField>
        <AuthField error={fieldErrors.confirmPassword}>
          <PasswordPill
            inputRef={confirmPasswordRef}
            placeholder={t('auth.confirmPassword')}
            value={confirmPassword}
            onChange={(value) => {
              setConfirmPassword(value)
              clearInvalidField('confirmPassword')
            }}
            visible={showConfirmPassword}
            onToggleVisible={() => setShowConfirmPassword(prev => !prev)}
            invalid={isInvalid('confirmPassword')}
            onManagedFocus={focusInputWithManagedScroll}
          />
        </AuthField>
        <div ref={passwordHintsRef}>
          {(password.length > 0 || confirmPassword.length > 0) && (
            <PasswordHints checks={passwordChecks} />
          )}
        </div>
      </>
    )
  }

  return (
    <AuthPageShell
      gridClassName="relative z-10 mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 items-center px-6 py-10 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-20 lg:px-20 xl:gap-28"
      panelClassName="mx-auto flex h-[660px] max-h-[calc(100vh-3rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-[28px] bg-white px-8 py-9 shadow-[0_18px_50px_rgba(96,132,210,0.12)] sm:h-[660px] sm:max-w-[500px] sm:rounded-[36px] sm:px-12 lg:max-w-[520px] lg:px-14"
      title={t('auth.registerTitle')}
      titleClassName="text-center text-[28px] font-semibold tracking-[0] text-[#0a0a28] sm:text-[32px]"
    >
          <ModeTabs mode={mode} onChange={switchMode} />

          {mode === 'password' ? (
            <RegisterForm onSubmit={handlePasswordSubmit} loginTo={loginTo} loading={loading}>
              {renderUsernameField()}
              <AuthField error={fieldErrors.email}>
                <PillInput
                  inputRef={emailRef}
                  icon={<Mail className="size-6" />}
                  type="email"
                  placeholder={t('auth.email')}
                  autoComplete="email"
                  value={email}
                  onChange={(value) => {
                    setEmail(value)
                    clearInvalidField('email')
                  }}
                  invalid={isInvalid('email')}
                />
              </AuthField>
              {renderPasswordFields()}
            </RegisterForm>
          ) : (
            <RegisterForm onSubmit={handleSmsSubmit} loginTo={loginTo} loading={loading}>
              {renderUsernameField()}
              <AuthField error={fieldErrors.phone}>
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
              </AuthField>
              <AuthField error={fieldErrors.smsCode}>
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
                  invalid={isInvalid('smsCode')}
                />
              </AuthField>
              {renderPasswordFields()}
            </RegisterForm>
          )}
    </AuthPageShell>
  )
}
