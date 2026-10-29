import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import { useEffect, useState } from 'react'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { AuthI18nProvider, useAuthI18n } from '@/i18n/auth-i18n'
import { useAuthStore } from '@/stores/auth'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { NavPage } from '@/pages/NavPage'


function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  const { t } = useAuthI18n()
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    checkAuth().finally(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-[28px] border border-border/70 bg-card/88 px-8 py-6 shadow-lg backdrop-blur">
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-muted-foreground/60">
            {t('common.loadingEyebrow')}
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">{t('common.loading')}</div>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/nav" replace /> : <LoginPage />
      } />
      <Route path="/register" element={
        isAuthenticated ? <Navigate to="/nav" replace /> : <RegisterPage />
      } />
      <Route path="/nav" element={
        <RequireAuth><NavPage /></RequireAuth>
      } />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/portal" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <AuthI18nProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthI18nProvider>
    </ThemeProvider>
  )
}
