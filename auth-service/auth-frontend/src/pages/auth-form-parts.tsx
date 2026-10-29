import { useRef, type FocusEventHandler, type FormEventHandler, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { Button } from '@/components/ui/button'
import { useAuthI18n, type MessageKey } from '@/i18n/auth-i18n'
import backgroundUrl from '@/assets/background.jpg'

export type PasswordCheck = { labelKey: MessageKey; ok: boolean }
export type AuthMode = 'password' | 'sms'

export function AuthPageShell({
  gridClassName,
  panelClassName,
  title,
  titleClassName,
  children,
}: {
  gridClassName: string
  panelClassName: string
  title: string
  titleClassName: string
  children: ReactNode
}) {
  const { locale, t } = useAuthI18n()
  const heroTitleClass = locale === 'zh'
    ? 'whitespace-nowrap text-[40px] xl:text-[50px]'
    : 'max-w-[620px] text-[36px] leading-[1.08] xl:text-[44px]'
  const heroTaglineClass = locale === 'zh'
    ? 'text-[29px] leading-none xl:text-[33px]'
    : 'max-w-[440px] text-[24px] leading-[1.14] xl:text-[28px]'

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#eaf3ff]">
      <img
        src={backgroundUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-[#eff6ff]/45" />
      <div className="absolute right-5 top-5 z-20 sm:right-8 sm:top-8">
        <LanguageToggle />
      </div>

      <div className={gridClassName}>
        <section className="hidden pl-[7vw] lg:block xl:pl-[6vw]">
          <h1 className={`${heroTitleClass} font-semibold tracking-[0] text-[#0a0a28]`}>
            {t('common.platformName')}
          </h1>
          <p className={`mt-6 ${heroTaglineClass} font-medium tracking-[0] text-[#545465]`}>
            {t('common.platformTagline')}
          </p>
        </section>

        <section className={panelClassName}>
          <h2 className={titleClassName}>{title}</h2>
          {children}
        </section>
      </div>
    </main>
  )
}

export function getPasswordChecks(value: string, confirmPassword?: string): PasswordCheck[] {
  return [
    { labelKey: 'auth.password.minLength', ok: value.length >= 8 },
    { labelKey: 'auth.password.lowercase', ok: /[a-z]/.test(value) },
    { labelKey: 'auth.password.uppercase', ok: /[A-Z]/.test(value) },
    { labelKey: 'auth.password.number', ok: /\d/.test(value) },
    { labelKey: 'auth.password.symbol', ok: /[^A-Za-z0-9]/.test(value) },
    ...(confirmPassword !== undefined
      ? [{ labelKey: 'auth.password.match' as const, ok: value.length > 0 && value === confirmPassword }]
      : []),
  ]
}

export function PasswordHints({ checks }: { checks: PasswordCheck[] }) {
  const { t } = useAuthI18n()

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 px-2 pl-3 sm:px-4">
      {checks.map(check => (
        <div
          key={check.labelKey}
          className={`flex items-center gap-2 text-[12px] font-semibold leading-5 sm:text-[13px] ${
            check.ok ? 'text-[#58ad86]' : 'text-[#9b9ba5]'
          }`}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-[11px] leading-none">
            {check.ok ? '✓' : '○'}
          </span>
          <span>{t(check.labelKey)}</span>
        </div>
      ))}
    </div>
  )
}

export function PillInput({
  inputRef,
  icon,
  type,
  placeholder,
  autoComplete,
  value,
  onChange,
  onFocus,
  shellClassName = 'flex h-[56px] items-center rounded-full border border-transparent bg-[#f4f4f4] px-6 text-[#0a0a28] transition-[border-color] sm:h-[60px]',
  inputClassName = 'h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] sm:text-[20px]',
  invalid = false,
}: {
  inputRef?: Ref<HTMLInputElement>
  icon: ReactNode
  type: string
  placeholder: string
  autoComplete: string
  value: string
  onChange: (value: string) => void
  onFocus?: FocusEventHandler<HTMLInputElement>
  shellClassName?: string
  inputClassName?: string
  invalid?: boolean
}) {
  return (
    <label className={`${shellClassName} ${invalid ? 'auth-field-invalid' : ''}`}>
      <span className="mr-4 shrink-0">{icon}</span>
      <input
        ref={inputRef}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        className={inputClassName}
      />
    </label>
  )
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="pl-6 text-sm leading-5 text-rose-500">{message}</p> : null
}

export function AuthField({
  children,
  error,
}: {
  children: ReactNode
  error?: string
}) {
  return (
    <div data-auth-field className="space-y-1.5">
      {children}
      <FieldError message={error} />
    </div>
  )
}

export function ModeTabs({
  mode,
  onChange,
  labels,
  className = 'mt-7 flex h-[58px] shrink-0 rounded-full border border-[#dce4ff] bg-white p-0.5',
}: {
  mode: AuthMode
  onChange: (mode: AuthMode) => void
  labels?: Record<AuthMode, string>
  className?: string
}) {
  const { t } = useAuthI18n()
  const tabLabels = labels ?? {
    password: t('auth.passwordRegister'),
    sms: t('auth.phoneRegister'),
  }
  const tabClass = (tab: AuthMode) =>
    `flex-1 rounded-full text-[17px] font-semibold transition-colors sm:text-[19px] ${
      mode === tab ? 'bg-[#eef1ff] text-[#5956ff]' : 'text-[#a5a3d8] hover:text-[#6d68ff]'
    }`

  return (
    <div className={className}>
      <button type="button" onClick={() => onChange('password')} className={tabClass('password')}>
        {tabLabels.password}
      </button>
      <button type="button" onClick={() => onChange('sms')} className={tabClass('sms')}>
        {tabLabels.sms}
      </button>
    </div>
  )
}

export function RegisterForm({
  onSubmit,
  loginTo,
  loading,
  children,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>
  loginTo: string
  loading: boolean
  children: ReactNode
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="mt-7 flex min-h-0 flex-1 flex-col">
      <div className="register-form-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-4">
        {children}
        <div className="h-2" />
      </div>
      <RegisterFooter loginTo={loginTo} loading={loading} />
    </form>
  )
}

export function SmsCodeInput({
  inputRef,
  value,
  onChange,
  onSend,
  loading,
  countdown,
  phone,
  shellClassName = 'flex h-[56px] items-center rounded-full border border-transparent bg-[#f4f4f4] px-6 text-[#0a0a28] transition-[border-color,background-color,box-shadow] sm:h-[60px]',
  inputClassName = 'h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] sm:text-[20px]',
  invalid = false,
}: {
  inputRef?: Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  onSend: () => void
  loading: boolean
  countdown: number
  phone: string
  shellClassName?: string
  inputClassName?: string
  invalid?: boolean
}) {
  const { t } = useAuthI18n()

  return (
    <label className={`${shellClassName} ${invalid ? 'auth-field-invalid' : ''}`}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t('auth.smsCode')}
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className={inputClassName}
      />
      <button
        type="button"
        disabled={loading || countdown > 0 || !phone.trim()}
        onClick={onSend}
        className="ml-4 shrink-0 text-[17px] font-medium text-[#a7a7ad] transition-colors hover:text-[#5956ff] disabled:pointer-events-none disabled:opacity-60 sm:text-[20px]"
      >
        {countdown > 0 ? `${countdown}s` : t('auth.sendCode')}
      </button>
    </label>
  )
}

export function PasswordPill({
  inputRef,
  placeholder,
  value,
  onChange,
  visible,
  onToggleVisible,
  onFocus,
  autoComplete = 'new-password',
  shellClassName = 'flex h-[56px] items-center rounded-full border border-transparent bg-[#f4f4f4] px-6 text-[#0a0a28] transition-[border-color] sm:h-[60px]',
  inputClassName = 'login-password-input h-full min-w-0 flex-1 bg-transparent pr-4 text-[17px] font-medium text-[#0a0a28] outline-none placeholder:text-[#a7a7ad] sm:text-[20px]',
  invalid = false,
  onManagedFocus,
}: {
  inputRef?: Ref<HTMLInputElement>
  placeholder: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  onToggleVisible: () => void
  onFocus?: FocusEventHandler<HTMLInputElement>
  autoComplete?: string
  shellClassName?: string
  inputClassName?: string
  invalid?: boolean
  onManagedFocus?: (input: HTMLInputElement | null) => void
}) {
  const innerInputRef = useRef<HTMLInputElement | null>(null)
  const { t } = useAuthI18n()

  function setInputRef(input: HTMLInputElement | null) {
    innerInputRef.current = input
    if (typeof inputRef === 'function') {
      inputRef(input)
    } else if (inputRef) {
      inputRef.current = input
    }
  }

  return (
    <label className={`${shellClassName} ${invalid ? 'auth-field-invalid' : ''}`}>
      <LockKeyhole className="mr-4 size-6 shrink-0" />
      <input
        ref={setInputRef}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onPointerDown={onManagedFocus ? (e) => {
          e.preventDefault()
          onManagedFocus(innerInputRef.current)
        } : undefined}
        className={inputClassName}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        className="ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[#0a0a28] transition-colors hover:bg-black/5"
        aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
      >
        {visible ? <Eye className="size-6" /> : <EyeOff className="size-6" />}
      </button>
    </label>
  )
}

export function RegisterFooter({
  loginTo,
  loading,
}: {
  loginTo: string
  loading: boolean
}) {
  const { locale, t } = useAuthI18n()
  const buttonClassName = locale === 'zh'
    ? 'mt-3 h-[60px] w-full rounded-full bg-[#5552ff] text-[20px] font-semibold tracking-[0.7em] text-white shadow-[0_10px_18px_rgba(85,82,255,0.25)] hover:bg-[#4c49f2] sm:text-[24px]'
    : 'mt-3 h-[60px] w-full rounded-full bg-[#5552ff] text-[18px] font-semibold tracking-[0.02em] text-white shadow-[0_10px_18px_rgba(85,82,255,0.25)] hover:bg-[#4c49f2] sm:text-[20px]'

  return (
    <>
      <div className="mt-4 shrink-0 border-t border-[#efefef] pt-4">
        <div className="flex justify-end text-[14px] text-[#96969e] sm:text-[16px]">
          <span>{t('auth.haveAccount')}</span>
          <Link to={loginTo} className="ml-2 font-medium text-[#5956ff] hover:underline">
            {t('auth.loginNow')}
          </Link>
        </div>
      </div>

      <Button type="submit" disabled={loading} className={buttonClassName}>
        {loading ? t('auth.registering') : t('auth.register')}
      </Button>
    </>
  )
}

export function LoginFooter({
  registerTo,
  loading,
  disabled,
}: {
  registerTo: string
  loading: boolean
  disabled?: boolean
}) {
  const { locale, t } = useAuthI18n()
  const buttonClassName = locale === 'zh'
    ? 'mt-5 h-[58px] w-full rounded-full bg-[#5552ff] text-[20px] font-semibold tracking-[0.7em] text-white shadow-[0_10px_18px_rgba(85,82,255,0.25)] hover:bg-[#4c49f2] sm:h-[66px] sm:text-[24px]'
    : 'mt-5 h-[58px] w-full rounded-full bg-[#5552ff] text-[18px] font-semibold tracking-[0.02em] text-white shadow-[0_10px_18px_rgba(85,82,255,0.25)] hover:bg-[#4c49f2] sm:h-[66px] sm:text-[20px]'

  return (
    <div className="mt-auto">
      <div className="flex justify-end text-[14px] text-[#96969e] sm:text-[16px]">
        <span>{t('auth.noAccount')}</span>
        <Link to={registerTo} className="ml-2 font-medium text-[#5956ff] hover:underline">
          {t('auth.registerNow')}
        </Link>
      </div>

      <Button type="submit" disabled={disabled ?? loading} className={buttonClassName}>
        {loading ? t('auth.loggingIn') : t('auth.login')}
      </Button>
    </div>
  )
}
