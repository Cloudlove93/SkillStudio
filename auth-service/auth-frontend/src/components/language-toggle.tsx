import { useAuthI18n } from '@/i18n/auth-i18n'
import { cn } from '@/lib/utils'

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useAuthI18n()

  const optionClass = (nextLocale: 'zh' | 'en') =>
    `rounded-full px-3 py-1 transition-colors ${
      locale === nextLocale
        ? 'bg-[#5454ff] text-white shadow-[0_6px_14px_rgba(84,84,255,0.24)]'
        : 'text-[#545465] hover:text-[#5454ff]'
    }`

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-[#dce4ff] bg-white/85 p-1 text-[13px] font-bold backdrop-blur',
        className,
      )}
      role="group"
      aria-label={t('common.language.toggleLabel')}
    >
      <button type="button" onClick={() => setLocale('zh')} className={optionClass('zh')}>
        {t('common.language.zh')}
      </button>
      <button type="button" onClick={() => setLocale('en')} className={optionClass('en')}>
        {t('common.language.en')}
      </button>
    </div>
  )
}
