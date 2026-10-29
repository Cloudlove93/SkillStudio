import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { LanguageToggle } from '@/components/language-toggle'
import { useAuthI18n, type MessageKey } from '@/i18n/auth-i18n'
import { useAuthStore } from '@/stores/auth'
import { resolveAppBase, resolveEdunexBase } from '@/api/auth'
import carouselUrl from '@/assets/carousel.png'

const services = [
  {
    name: 'EduClaw',
    descriptionKey: 'nav.service.educlaw',
    isLive: true,
    requiredRole: 'EduClaw',
    resolveBase: resolveAppBase,
  },
  {
    name: 'Edunex',
    descriptionKey: 'nav.service.edunex',
    isLive: true,
    requiredRole: 'Edunex',
    resolveBase: resolveEdunexBase,
  },
  {
    name: 'PPTX Studio',
    descriptionKey: 'nav.service.pptxStudio',
    isLive: false,
    requiredRole: 'PPTX Studio',
    resolveBase: resolveAppBase,
  },
  {
    name: 'SynapAI',
    descriptionKey: 'nav.service.synapAi',
    isLive: false,
    requiredRole: 'SynapAI',
    resolveBase: resolveAppBase,
  },
] satisfies Array<{
  name: string
  descriptionKey: MessageKey
  isLive: boolean
  requiredRole: string
  resolveBase: () => string
}>

function getServiceInitial(name: string): string {
  const initial = name.trim().charAt(0)
  return initial ? initial.toUpperCase() : 'E'
}

export function NavPage() {
  const { t } = useAuthI18n()
  const { user, logout } = useAuthStore()
  const [query, setQuery] = useState('')

  const filteredServices = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return services

    return services.filter((service) =>
      `${service.name} ${t(service.descriptionKey)}`.toLowerCase().includes(keyword),
    )
  }, [query, t])

  function hasAccess(service: typeof services[number]): boolean {
    const roles = user?.roles ?? []
    return roles.includes(service.requiredRole)
  }

  async function handleLogout() {
    await logout()
    window.location.href = '/login'
  }

  function handleServiceClick(service: typeof services[number], e: React.MouseEvent) {
    e.preventDefault()
    if (!service.isLive) return
    if (!hasAccess(service)) {
      alert(t('nav.noPermission'))
      return
    }
    const token = localStorage.getItem('access_token')
    if (token) {
      window.location.href = service.resolveBase() + '/#token=' + encodeURIComponent(token)
    }
  }

  return (
    <div className="min-h-screen bg-white text-[#080923]">
      <header className="border-b border-[#e8e8f0] bg-white">
        <div className="mx-auto flex h-[86px] w-full max-w-[1720px] items-center justify-between px-6 lg:px-20">
          <div className="text-[26px] font-extrabold tracking-[0] text-[#6458ff] sm:text-[32px]">
            {t('common.platformName')}
          </div>

          <div className="flex items-center gap-4 text-[15px] font-semibold text-[#0d1024] lg:gap-8">
            <nav className="hidden items-center gap-14 md:flex">
              <a href="#products" className="transition-colors hover:text-[#5454ff]">{t('nav.products')}</a>
              <a href="#community" className="transition-colors hover:text-[#5454ff]">{t('nav.community')}</a>
              <a href="#about" className="transition-colors hover:text-[#5454ff]">{t('nav.about')}</a>
            </nav>
            <LanguageToggle className="hidden sm:inline-flex" />
            {user && (
              <div className="hidden max-w-[180px] items-center gap-2 rounded-full border border-[#d9d9ff] bg-[#f7f7ff] px-4 py-2 text-[14px] font-bold text-[#5454ff] sm:flex">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#5454ff] text-[12px] text-white">
                  {(user.username || 'U').slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{user.username || t('common.user')}</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="h-8 rounded-full border border-[#dddff0] bg-white px-3 text-[12px] font-semibold text-[#60637a] transition-colors hover:border-[#c9c9ff] hover:bg-[#f7f7ff] hover:text-[#5454ff]"
            >
              {t('common.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-8 sm:pt-10 lg:px-0">
        <div className="flex justify-center sm:justify-end">
          <LanguageToggle className="mb-4 sm:hidden" />
        </div>

        <div className="flex justify-center sm:justify-end">
          <label className="flex h-11 w-full max-w-[330px] items-center gap-3 rounded-full border-2 border-[#5757ff] bg-white px-4 text-[#5454ff] sm:max-w-[300px]">
            <Search className="size-5 shrink-0 stroke-[3]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('nav.search')}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] font-medium text-[#333655] outline-none placeholder:text-[#a6a6ff]"
              aria-label={t('nav.search')}
            />
          </label>
        </div>

        <section className="relative mt-7 overflow-hidden rounded-[26px] bg-[#eef5ff] shadow-[0_18px_42px_rgba(83,106,255,0.10)]">
          <img
            src={carouselUrl}
            alt={t('nav.bannerAlt')}
            className="block aspect-[10/3] w-full object-contain"
          />
        </section>

        {user ? (
          <section id="products" className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredServices.map((service, index) => {
              const canAccess = hasAccess(service)
              const disabled = !service.isLive || !canAccess
              return (
                <a
                  key={`${service.name}-${index}`}
                  href="#"
                  onClick={(event) => handleServiceClick(service, event)}
                  aria-disabled={disabled}
                  className={`group flex h-[96px] items-center rounded-[26px] border-2 px-5 transition-all sm:h-[104px] sm:px-6 ${
                    disabled
                      ? 'cursor-default border-[#e0e0e8] bg-[#f5f5fa]'
                      : 'cursor-pointer border-[#c9c9ff] bg-white hover:-translate-y-0.5 hover:border-[#5c5cff] hover:shadow-[0_16px_34px_rgba(84,84,255,0.13)]'
                  }`}
                >
                  <div className={`flex size-12 shrink-0 items-center justify-center rounded-[18px] text-[24px] font-extrabold text-white sm:size-14 sm:text-[28px] ${disabled ? 'bg-[#b0b0c0]' : 'bg-[#5454ff]'}`}>
                    {getServiceInitial(service.name)}
                  </div>
                  <div className="ml-4 min-w-0 flex-1">
                    <div className={`truncate text-[18px] font-black leading-tight tracking-[0] sm:text-[20px] ${disabled ? 'text-[#9a9ca7]' : 'text-black'}`}>
                      {service.name}
                      {!service.isLive && (
                        <span className="ml-2 align-middle text-[11px] font-bold text-[#9a9ca7] sm:text-[12px]">
                          {t('common.comingSoon')}
                        </span>
                      )}
                      {service.isLive && !canAccess && (
                        <span className="ml-2 align-middle text-[11px] font-bold text-[#9a9ca7] sm:text-[12px]">
                          {t('common.noAccess')}
                        </span>
                      )}
                    </div>
                    <div className={`mt-1 line-clamp-2 text-[12px] leading-[1.35] font-medium sm:text-[13px] ${disabled ? 'text-[#b0b0c0]' : 'text-[#56596d]'}`}>
                      {t(service.descriptionKey)}
                    </div>
                  </div>
                  <ChevronRight className={`ml-3 size-5 shrink-0 transition-transform group-hover:translate-x-1 ${disabled ? 'text-[#c0c0cc]' : 'text-[#767987]'}`} aria-hidden="true" />
                </a>
              )
            })}
          </section>
        ) : (
          <div className="mt-10 text-center text-sm font-medium text-[#56596d]">
            {t('nav.userLoadFailed')}
          </div>
        )}

        {filteredServices.length === 0 && (
          <div className="mt-10 text-center text-sm font-medium text-[#56596d]">
            {t('nav.noResults')}
          </div>
        )}
      </main>
    </div>
  )
}
