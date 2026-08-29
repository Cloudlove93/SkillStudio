import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { BASE } from '@/api/client'
import { useAuthStore } from './stores/auth'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SkillFirstWorkspace = lazy(() => import('./pages/SkillFirstWorkspace'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      正在加载…
    </div>
  )
}

function NotFoundPage() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <section className="card-premium w-full max-w-md rounded-[20px] p-7 text-center">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-muted-foreground">404</p>
        <h1 className="mt-2 text-xl font-semibold">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">这个地址可能已经变更，返回工作区可以继续使用 Skill。</p>
        <Link className="mt-5 inline-flex rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" to="/">
          返回工作区
        </Link>
      </section>
    </main>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {children}
    </>
  )
}

function AppRoutes() {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    checkAuth().finally(() => setChecking(false))
  }, [checkAuth])

  if (checking) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
        <div className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-80" />
        <div className="card-premium relative z-10 flex w-full max-w-md items-center gap-4 rounded-[20px] px-6 py-5">
          <img src={`${BASE}/logo.png`} alt="EduSkill" className="size-12 rounded-[14px]" />
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              EduSkill Workspace
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">Loading your workspace...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>} />
        <Route path="/skills" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>} />
        <Route path="/legacy" element={<Navigate to="/" replace />} />
        <Route path="/workflow" element={<Navigate to="/" replace />} />
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

function AppToaster() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <Toaster
      position="top-right"
      richColors
      closeButton
      style={{ zIndex: 2147483647 }}
      toastOptions={{ style: { zIndex: 2147483647 } }}
    />,
    document.body,
  )
}

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <BrowserRouter basename={BASE || '/'}>
          <AppRoutes />
        </BrowserRouter>
        <AppToaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
