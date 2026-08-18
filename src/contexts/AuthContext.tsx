import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { API_URL, BRAIN_API_URL } from '../lib/api'
import { DEMO_SESSION_STORAGE_KEY, DEMO_USER } from '../lib/demo-session'

export interface User {
  id: string
  email: string
  name: string
  username?: string
  picture?: string
  created_at?: string
  last_login?: string
}

interface AuthContextValue {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isDemo: boolean
  isLoading: boolean
  login: (token: string, user: User) => void
  loginDemo: () => void
  logout: () => void
  refreshUser: () => Promise<void>
}

interface JwtPayload {
  exp?: number
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
const TOKEN_KEY = 'memory_auth_token'
const BRAIN_TOKEN_KEY = 'memcode_brain_auth_token'
const USER_KEY = 'memory_user'

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    return JSON.parse(window.atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

function isTokenValid(token: string) {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return false
  return payload.exp > Date.now() / 1000
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const storedDemoSession = sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY) === 'active'
        const storedToken = localStorage.getItem(TOKEN_KEY)
        const legacyBrainToken = localStorage.getItem(BRAIN_TOKEN_KEY)
        const storedUser = localStorage.getItem(USER_KEY)

        if (storedDemoSession) {
          if (!active) return
          setIsDemo(true)
          setUser(DEMO_USER)
        } else if (storedToken && storedUser && isTokenValid(storedToken)) {
          if (legacyBrainToken) {
            await fetch(`${BRAIN_API_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${legacyBrainToken}` },
              credentials: 'include',
              signal: AbortSignal.timeout(5_000),
            }).catch(() => undefined)
          }
          if (!active) return
          setToken(storedToken)
          setUser(JSON.parse(storedUser) as User)
        } else {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(USER_KEY)
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      } finally {
        localStorage.removeItem(BRAIN_TOKEN_KEY)
        if (active) setIsLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const login = useCallback((newToken: string, newUser: User) => {
    sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY)
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(newUser))
    setIsDemo(false)
    setToken(newToken)
    setUser(newUser)
  }, [])

  const loginDemo = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(BRAIN_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, 'active')
    setToken(null)
    setIsDemo(true)
    setUser(DEMO_USER)
  }, [])

  const logout = useCallback(() => {
    if (!isDemo) {
      void fetch(`${BRAIN_API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }).catch(() => undefined)
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(BRAIN_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY)
    setToken(null)
    setIsDemo(false)
    setUser(null)
  }, [isDemo])

  const refreshUser = useCallback(async () => {
    if (!token || isDemo) return

    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const nextUser = (await response.json()) as User
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
        setUser(nextUser)
      } else if (response.status === 401) {
        logout()
      }
    } catch {
      return
    }
  }, [isDemo, logout, token])

  useEffect(() => {
    if (!token) return
    const timer = window.setInterval(() => {
      void refreshUser()
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refreshUser, token])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && (token || isDemo)),
      isDemo,
      isLoading,
      login,
      loginDemo,
      logout,
      refreshUser,
    }),
    [isDemo, isLoading, login, loginDemo, logout, refreshUser, token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
