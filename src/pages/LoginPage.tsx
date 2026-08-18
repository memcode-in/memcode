import { type FormEvent, useEffect, useRef, useState } from 'react'
import { API_URL, BRAIN_API_URL } from '../lib/api'
import { User, useAuth } from '../contexts/AuthContext'
import { isValidDemoCredentials } from '../lib/demo-session'
import { getLandingUrl } from '../lib/auth-routing'
import {
  AUTH_ERROR_MESSAGES,
  readUserFacingApiError,
  userFacingErrorMessage,
} from '../lib/user-facing-errors'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: GoogleCredentialResponse) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: {
              theme: 'filled_black' | 'outline'
              size: 'large' | 'medium' | 'small'
              text: 'signin_with' | 'continue_with'
              shape: 'rectangular' | 'pill'
              width?: number
            },
          ) => void
        }
      }
    }
  }
}

interface GoogleCredentialResponse {
  credential?: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function getReturnUrl() {
  const params = new URLSearchParams(window.location.search)
  const candidate = params.get('returnUrl')
  const onboardingRequested = params.has('onboarding')
  const addOnboardingIntent = (path: string) => {
    if (!onboardingRequested) return path
    const resolved = new URL(path, window.location.origin)
    resolved.searchParams.set('onboarding', 'company-brain')
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  }
  if (!candidate) return addOnboardingIntent('/dashboard')
  try {
    const resolved = new URL(candidate, window.location.origin)
    if (resolved.origin !== window.location.origin) return addOnboardingIntent('/dashboard')
    return addOnboardingIntent(`${resolved.pathname}${resolved.search}${resolved.hash}`)
  } catch {
    return addOnboardingIntent('/dashboard')
  }
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google sign-in failed to load')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in failed to load'))
    document.head.appendChild(script)
  })
}

export default function LoginPage() {
  const { isAuthenticated, login, loginDemo } = useAuth()
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoEmail, setDemoEmail] = useState('')
  const [demoPassword, setDemoPassword] = useState('')
  const returnUrl = getReturnUrl()

  const handleDemoSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!isValidDemoCredentials(demoEmail, demoPassword)) {
      setError('Invalid demo email or password.')
      return
    }

    loginDemo()
    window.location.href = returnUrl
  }

  useEffect(() => {
    if (isAuthenticated) {
      window.location.replace(returnUrl)
    }
  }, [isAuthenticated, returnUrl])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || isAuthenticated) return

    let cancelled = false

    const handleCredential = async (credentialResponse: GoogleCredentialResponse) => {
      setIsSubmitting(true)
      setError(null)

      if (!credentialResponse.credential) {
        setError('No credential received from Google.')
        setIsSubmitting(false)
        return
      }

      try {
        const request: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: credentialResponse.credential,
            client_id: GOOGLE_CLIENT_ID,
          }),
        }
        const [accountResponse, brainResponse] = await Promise.all([
          fetch(`${API_URL}/auth/google`, request),
          fetch(`${BRAIN_API_URL}/api/auth/google`, { ...request, credentials: 'include' }),
        ])

        if (!accountResponse.ok || !brainResponse.ok) {
          const failedResponse = accountResponse.ok ? brainResponse : accountResponse
          const failure = await readUserFacingApiError(failedResponse, {
            fallback: 'Sign-in could not be completed. Please try again.',
            messages: AUTH_ERROR_MESSAGES,
          })
          throw new Error(failure.message)
        }

        const data = await accountResponse.json() as TokenResponse
        await brainResponse.json().catch(() => null)
        login(data.access_token, data.user)
        window.location.href = returnUrl
      } catch (err) {
        setError(userFacingErrorMessage(err, 'Sign-in could not be completed. Please try again.'))
      } finally {
        setIsSubmitting(false)
      }
    }

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google?.accounts?.id) return
        const buttonWidth = Math.min(320, Math.max(220, Math.floor(buttonRef.current.getBoundingClientRect().width)))
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
        })
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: buttonWidth,
        })
      })
      .catch((err: Error) => setError(userFacingErrorMessage(err, 'Google sign-in failed to load. Please try again.')))

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, login, returnUrl])

  return (
    <main className="auth-page">
      <a className="auth-back" href={getLandingUrl()}>
        Back to home
      </a>

      <section className="auth-card auth-card--login" aria-labelledby="login-title">
        <div className="brand auth-card__brand">
          <span className="brand__mark"><img src="/logo.jpeg" alt="" /></span>
          <span className="brand__name">memCode</span>
        </div>

        <div className="auth-card__header">
          <h1 id="login-title">Sign in</h1>
          <p>Use Google to continue to your MemCode dashboard.</p>
        </div>

        <div className="auth-card__panel">
          {error ? (
            <div className="auth-alert" role="alert">
              {error}
            </div>
          ) : null}

          {isSubmitting ? (
            <div className="auth-loading">Signing in...</div>
          ) : GOOGLE_CLIENT_ID ? (
            <div className="google-button-shell" ref={buttonRef} />
          ) : (
            <div className="auth-alert auth-alert--warn" role="alert">
              <strong>Google sign-in is temporarily unavailable.</strong>
              <span>Please try again later.</span>
            </div>
          )}

          <small>
            Secure Google sign-in. New accounts are created automatically.
          </small>

          <div className={`auth-demo ${demoOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="auth-demo__toggle"
              aria-expanded={demoOpen}
              aria-controls="demo-login-form"
              onClick={() => {
                setDemoOpen((current) => !current)
                setError(null)
              }}
            >
              Sign in as demo
            </button>

            {demoOpen ? (
              <form id="demo-login-form" className="auth-demo__form" onSubmit={handleDemoSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={demoEmail}
                    autoComplete="username"
                    onChange={(event) => setDemoEmail(event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={demoPassword}
                    autoComplete="current-password"
                    onChange={(event) => setDemoPassword(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="auth-demo__submit">Enter demo dashboard</button>
                <p>Read-only demo access. No billing or organization changes are allowed.</p>
              </form>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}
