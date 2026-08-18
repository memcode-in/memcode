import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { API_URL } from '../lib/api'
import { getLoginUrl } from '../lib/auth-routing'
import SmoothInput from '../components/SmoothInput'
import {
  AUTH_ERROR_MESSAGES,
  readUserFacingApiError,
  userFacingErrorMessage,
} from '../lib/user-facing-errors'

const permissions = [
  ['Read and search memories', 'Semantic recall and relevant code context'],
  ['Save new memories', 'Persist durable agent decisions and project facts'],
  ['Access code indexes', 'Query scanned repositories and snippets'],
]

function getClientInfo(clientId: string | null, redirectUri: string | null) {
  if (clientId === 'memcode') return 'MemCode CLI'
  if (clientId === 'memcode') return 'MemCode'
  if (redirectUri?.includes('chatgpt.com') || clientId === 'memcode-mcp') return 'ChatGPT'
  return clientId || 'External app'
}

export default function OAuthAuthorizePage() {
  const { isAuthenticated, isLoading: authLoading, user, token } = useAuth()
  const [isApproving, setIsApproving] = useState(false)
  const [isVerifyingReferral, setIsVerifyingReferral] = useState(false)
  const [referralCode, setReferralCode] = useState('')
  const [isReferralVerified, setIsReferralVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const state = params.get('state')
  const clientName = getClientInfo(clientId, redirectUri)
  const requiresReferralCode = clientId === 'memcode'

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      const returnUrl = `${window.location.pathname}${window.location.search}`
      window.location.href = getLoginUrl(returnUrl)
    }
  }, [authLoading, isAuthenticated])

  const verifyReferralCode = async () => {
    if (!clientId || !token) return

    const trimmedCode = referralCode.trim()
    if (!trimmedCode) {
      setError('Enter your referral code to continue.')
      setIsReferralVerified(false)
      return
    }

    setIsVerifyingReferral(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/auth/referrals/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          client_id: clientId,
          referral_code: trimmedCode,
        }),
      })

      if (!response.ok) {
        const failure = await readUserFacingApiError(response, {
          fallback: "That referral code couldn't be verified. Check the code and try again.",
          messages: AUTH_ERROR_MESSAGES,
        })
        throw new Error(failure.message)
      }

      setIsReferralVerified(true)
    } catch (err) {
      setIsReferralVerified(false)
      setError(userFacingErrorMessage(err, 'Referral verification failed. Please try again.'))
    } finally {
      setIsVerifyingReferral(false)
    }
  }

  const approve = async () => {
    if (!clientId || !redirectUri || !token) return
    if (requiresReferralCode && !isReferralVerified) {
      setError('Verify your referral code before authorizing.')
      return
    }

    setIsApproving(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/auth/oauth/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          ...(requiresReferralCode
            ? { referral_code: referralCode.trim() }
            : {}),
        }),
      })

      if (!response.ok) {
        const failure = await readUserFacingApiError(response, {
          fallback: 'Authorization could not be completed. Please try again.',
          messages: AUTH_ERROR_MESSAGES,
        })
        throw new Error(failure.message)
      }

      const data = (await response.json()) as { code: string }
      const redirectUrl = new URL(redirectUri)
      redirectUrl.searchParams.append('code', data.code)
      if (state) redirectUrl.searchParams.append('state', state)
      window.location.href = redirectUrl.toString()
    } catch (err) {
      setError(userFacingErrorMessage(err, 'Authorization failed. Please try again.'))
      setIsApproving(false)
    }
  }

  if (authLoading || !isAuthenticated) {
    return <main className="auth-page auth-page--loading">Loading authorization...</main>
  }

  if (!clientId || !redirectUri) {
    return (
      <main className="auth-page">
        <section className="auth-card auth-card--compact">
          <div className="auth-alert" role="alert">
            This authorization request is incomplete. Start it again from the app you are connecting.
          </div>
          <a className="btn btn--primary btn--full" href="/dashboard">
            Go to dashboard
          </a>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <section className="oauth-card" aria-labelledby="oauth-title">
        <div className="oauth-brand">
          <span className="oauth-brand__icon">
            <img src="/logo.jpeg" alt="" />
          </span>
          <div>
            <strong>MemCode</strong>
            <small>Secure authorization</small>
          </div>
        </div>

        <h1 id="oauth-title">Authorize {clientName}</h1>
        <p>{clientName} wants permission to connect to your MemCode account.</p>

        <div className="oauth-user">
          {user?.picture ? <img src={user.picture} alt={user.name} /> : <span>{user?.name?.charAt(0) || '?'}</span>}
          <div>
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </div>
        </div>

        <div className="oauth-permissions">
          <span>Permissions requested</span>
          {permissions.map(([label, detail]) => (
            <div className="oauth-permission" key={label}>
              <i aria-hidden="true" />
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            </div>
          ))}
        </div>

        {requiresReferralCode ? (
          <div className="oauth-referral">
            <label htmlFor="referral-code">Referral code</label>
            <div className="oauth-referral__row">
              <SmoothInput
                id="referral-code"
                type="text"
                value={referralCode}
                onChange={(event) => {
                  setReferralCode(event.target.value)
                  setIsReferralVerified(false)
                }}
                autoComplete="off"
                placeholder="ABC123"
              />
              <button
                type="button"
                className="btn btn--ghost"
                onClick={verifyReferralCode}
                disabled={isVerifyingReferral || !referralCode.trim()}
              >
                {isVerifyingReferral ? 'Verifying...' : 'Verify'}
              </button>
            </div>
            <small className={isReferralVerified ? 'oauth-referral__ok' : undefined}>
              {isReferralVerified
                ? 'Referral code verified for this account.'
                : 'Required for MemCode CLI access.'}
            </small>
          </div>
        ) : null}

        {error ? (
          <div className="auth-alert" role="alert">
            {error}
          </div>
        ) : null}

        <div className="oauth-actions">
          <a className="btn btn--ghost" href="/dashboard">
            Cancel
          </a>
          <button
            type="button"
            className="btn btn--primary"
            onClick={approve}
            disabled={isApproving || (requiresReferralCode && !isReferralVerified)}
          >
            {isApproving ? 'Authorizing...' : 'Approve'}
          </button>
        </div>
      </section>
    </main>
  )
}
