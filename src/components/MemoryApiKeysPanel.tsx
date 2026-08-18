import { useMemo, useState, type FormEvent } from 'react'
import { API_URL } from '../lib/api'
import { userFacingErrorMessage } from '../lib/user-facing-errors'

export interface MemoryApiKey {
  id: string
  key_prefix: string
  name: string
  scopes?: string[]
  created_at: string
  last_used?: string
  is_active: boolean
}

interface NewMemoryApiKey {
  key: string
  key_id: string
  name: string
  created_at: string
}

interface MemoryApiKeysPanelProps {
  keys: MemoryApiKey[]
  token: string | null
  demoMode: boolean
  loading: boolean
  onAuthenticationRequired: () => void
  onReload: () => Promise<void>
}

const DEMO_KEYS: MemoryApiKey[] = [
  { id: 'demo-production', key_prefix: 'mem_prod', name: 'Production', scopes: ['*'], created_at: '2026-08-01T00:00:00Z', last_used: '2026-08-14T08:00:00Z', is_active: true },
  { id: 'demo-local', key_prefix: 'mem_local', name: 'Local development', scopes: ['memory:read', 'memory:write'], created_at: '2026-08-05T00:00:00Z', last_used: '2026-08-13T14:30:00Z', is_active: true },
  { id: 'demo-ci', key_prefix: 'mem_ci', name: 'CI scanner', scopes: ['scanner:write'], created_at: '2026-08-09T00:00:00Z', is_active: true },
]

function formatDate(value?: string) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function KeyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>
}

export default function MemoryApiKeysPanel({
  keys,
  token,
  demoMode,
  loading,
  onAuthenticationRequired,
  onReload,
}: MemoryApiKeysPanelProps) {
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<NewMemoryApiKey | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [revokeConfirmation, setRevokeConfirmation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visibleKeys = demoMode ? DEMO_KEYS : keys
  const activeCount = useMemo(() => visibleKeys.filter((key) => key.is_active).length, [visibleKeys])

  const createKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || !newKeyName.trim() || demoMode) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/api/keys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: ['*'] }),
      })
      if (response.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (!response.ok) throw new Error('The API key could not be created.')
      setNewKey(await response.json() as NewMemoryApiKey)
      setNewKeyName('')
      await onReload()
    } catch (nextError) {
      setError(userFacingErrorMessage(nextError, 'The API key could not be created.'))
    } finally {
      setSubmitting(false)
    }
  }

  const revokeKey = async (keyId: string) => {
    if (!token || demoMode) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`${API_URL}/api/keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (!response.ok) throw new Error('The API key could not be revoked.')
      setRevokeConfirmation(null)
      await onReload()
    } catch (nextError) {
      setError(userFacingErrorMessage(nextError, 'The API key could not be revoked.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="memory-keys" aria-labelledby="memory-keys-title">
      <header className="memory-surface-header memory-surface-header--keys">
        <div>
          <span>Developer access</span>
          <h1 id="memory-keys-title">API keys</h1>
          <p>Create and manage keys for your integrations.</p>
        </div>
        <button type="button" onClick={() => setCreating((value) => !value)} disabled={demoMode}>
          {creating ? 'Cancel' : 'Create key'}
        </button>
      </header>

      {error ? <div className="dashboard-alert" role="alert">{error}</div> : null}

      {creating ? (
        <form className="memory-keys__create" onSubmit={(event) => void createKey(event)}>
          <div>
            <label htmlFor="memory-key-name">Key name</label>
            <small>Use a name that identifies where this credential lives.</small>
          </div>
          <input
            id="memory-key-name"
            value={newKeyName}
            autoFocus
            placeholder="Production API"
            onChange={(event) => setNewKeyName(event.target.value)}
          />
          <button type="submit" disabled={submitting || !newKeyName.trim()}>{submitting ? 'Creating…' : 'Generate'}</button>
        </form>
      ) : null}

      {newKey ? (
        <section className="memory-keys__reveal" aria-labelledby="new-memory-key-title">
          <div>
            <span>Shown once</span>
            <strong id="new-memory-key-title">Save this key now</strong>
            <p>For your security, the full value cannot be retrieved again.</p>
          </div>
          <code>{newKey.key}</code>
          <div>
            <button type="button" onClick={() => void navigator.clipboard.writeText(newKey.key)}>Copy key</button>
            <button type="button" onClick={() => setNewKey(null)}>I saved it</button>
          </div>
        </section>
      ) : null}

      <div className="memory-keys__list" aria-busy={loading}>
        <header className="memory-keys__list-header">
          <div>
            <KeyIcon />
            <h2>Keys</h2>
            <span>{activeCount} active</span>
          </div>
          {demoMode ? <small>Demo · read-only</small> : null}
        </header>
        {loading && !visibleKeys.length ? <p>Loading credentials…</p> : null}
        {!loading && !visibleKeys.length ? <p>No API keys yet. Create one when your first integration is ready.</p> : null}
        {visibleKeys.map((key) => (
          <article key={key.id} className={!key.is_active ? 'is-inactive' : ''}>
            <span className="memory-keys__icon"><KeyIcon /></span>
            <div className="memory-keys__identity">
              <strong>{key.name}</strong>
              <code>{key.key_prefix}<i>••••••••••••••••</i></code>
            </div>
            <div className="memory-keys__meta">
              <span>{key.scopes?.includes('*') ? 'Full access' : `${key.scopes?.length || 0} scopes`}</span>
              <small>Created {formatDate(key.created_at)} · Used {formatDate(key.last_used)}</small>
            </div>
            {revokeConfirmation === key.id ? (
              <div className="memory-keys__confirm">
                <button type="button" onClick={() => setRevokeConfirmation(null)}>Keep</button>
                <button type="button" disabled={submitting} onClick={() => void revokeKey(key.id)}>Confirm revoke</button>
              </div>
            ) : (
              <button type="button" className="memory-keys__revoke" disabled={demoMode || !key.is_active} onClick={() => setRevokeConfirmation(key.id)}>Revoke</button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
