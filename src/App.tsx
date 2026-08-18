import { lazy, Suspense, type ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { getLoginUrl } from './lib/auth-routing'
import { useSeo } from './lib/seo'

const DashboardOverview = lazy(() => import('./pages/DashboardOverview'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const OAuthAuthorizePage = lazy(() => import('./pages/OAuthAuthorizePage'))

function NoIndexRoute({ children, title, path }: { children: ReactNode; title: string; path?: string }) {
  useSeo({
    title,
    path,
    noindex: true,
  })

  return <>{children}</>
}

function ProtectedDashboard() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <main className="auth-page auth-page--loading">Loading dashboard...</main>
  }

  if (!isAuthenticated) {
    window.location.replace(getLoginUrl('/dashboard'))
    return <main className="auth-page auth-page--loading">Redirecting to sign in...</main>
  }

  return <DashboardOverview />
}

function AppRoutes() {
  if (window.location.pathname === '/login') {
    return (
      <NoIndexRoute title="Sign In | MemCode" path="/login">
        <LoginPage />
      </NoIndexRoute>
    )
  }

  if (window.location.pathname === '/oauth/authorize') {
    return (
      <NoIndexRoute title="Authorize App | MemCode" path="/oauth/authorize">
        <OAuthAuthorizePage />
      </NoIndexRoute>
    )
  }

  return (
    <NoIndexRoute title="Dashboard | MemCode" path="/dashboard">
      <ProtectedDashboard />
    </NoIndexRoute>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<main className="auth-page auth-page--loading">Loading dashboard...</main>}>
        <AppRoutes />
      </Suspense>
      <Analytics />
      <SpeedInsights />
    </AuthProvider>
  )
}
