import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { BASE } from '@/api/client'
import Workspace from './pages/Workspace'
import AgentProfileWorkflow from './pages/AgentProfileWorkflow'
import AdminPage from './pages/AdminPage'
import LoginPage from './pages/LoginPage'
import SkillFirstWorkspace from './pages/SkillFirstWorkspace'
import { useAuthStore } from './stores/auth'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              EduSkill Workspace
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">Loading your workspace...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>} />
      <Route path="/skills" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>} />
      <Route path="/legacy" element={<RequireAuth><Workspace /></RequireAuth>} />
      <Route path="/workflow" element={<RequireAuth><AgentProfileWorkflow /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
    </Routes>
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
