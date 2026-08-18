import { useMemo, useState } from 'react'
import type { User } from '../contexts/AuthContext'
import {
  AccountSectionDeck,
  type AccountSectionOption,
} from './AccountSettingsNavigation'

export interface MemoryAccountBillingSummary {
  planName: string | null
  status: string | null
  creditsRemaining: number | null
  creditsUsed: number | null
  creditsLimit: number | null
  periodEnd: string | null
}

type MemoryAccountSection = 'general' | 'usage' | 'billing'

interface MemoryAccountPanelProps {
  user: User | null
  billing: MemoryAccountBillingSummary
  memoryCount: number
  activeApiKeys: number
  totalApiKeys: number
  warning: string | null
  demoMode: boolean
  onOpenApiKeys: () => void
  onOpenBilling: () => void
  onSignOut: () => void
}

const MEMORY_ACCOUNT_SECTIONS: ReadonlyArray<AccountSectionOption<MemoryAccountSection>> = [
  { id: 'general', label: 'General', description: 'Your Memory profile and credentials', icon: 'general' },
  { id: 'usage', label: 'Memory usage', description: 'Credits and stored memories', icon: 'usage' },
  { id: 'billing', label: 'Billing', description: 'Plan, balance and invoices', icon: 'billing' },
]

function formatNumber(value: number | null) {
  return value === null ? 'Unavailable' : new Intl.NumberFormat('en-IN').format(value)
}

function formatStatus(value: string | null) {
  if (!value) return 'Unavailable'
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatDate(value: string | null) {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export default function MemoryAccountPanel({
  user,
  billing,
  memoryCount,
  activeApiKeys,
  totalApiKeys,
  warning,
  demoMode,
  onOpenApiKeys,
  onOpenBilling,
  onSignOut,
}: MemoryAccountPanelProps) {
  const [activeSection, setActiveSection] = useState<MemoryAccountSection | null>(null)
  const creditsUsed = billing.creditsUsed
  const creditsLimit = billing.creditsLimit
  const usagePercent = useMemo(() => {
    if (creditsUsed === null || creditsLimit === null || creditsLimit <= 0) return null
    return Math.min(100, Math.max(0, Math.round((creditsUsed / creditsLimit) * 100)))
  }, [creditsLimit, creditsUsed])

  return (
    <section
      className={`brain-panel company-brain-settings memory-account-settings ${activeSection ? 'has-active-section' : 'is-section-picker'}`}
      aria-labelledby="memory-account-title"
    >
      <header className="brain-panel__header">
        <h1 id="memory-account-title">Account</h1>
      </header>

      <div className={`company-brain-settings__layout ${activeSection ? 'has-selection' : 'is-picker'}`}>
        <AccountSectionDeck
          sections={MEMORY_ACCOUNT_SECTIONS}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          panelId={activeSection ? 'memory-account-panel' : undefined}
        />

        {activeSection ? (
          <div className="company-brain-settings__workspace">
            <div
              id="memory-account-panel"
              className="company-brain-settings__panel company-brain-settings__readout"
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`account-section-${activeSection}`}
            >
              {activeSection === 'general' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Memory account</span><h3>{user?.name || 'Your account'}</h3></div>
                    <span className="company-brain-account-card__role">{demoMode ? 'Demo' : 'Active'}</span>
                  </div>
                  <p>Your identity and Memory access live here. Company Brain settings appear only after you set up a workspace.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Email</span><strong>{user?.email || 'Unavailable'}</strong><small>Signed-in account</small></div>
                    <div><span>Saved memories</span><strong>{formatNumber(memoryCount)}</strong><small>Across your Memory account</small></div>
                    <div><span>API keys</span><strong>{activeApiKeys} active</strong><small>{totalApiKeys} total credentials</small></div>
                  </div>
                  <div className="memory-account-settings__actions">
                    <button type="button" onClick={onOpenApiKeys}>Manage API keys</button>
                    <button type="button" className="is-muted" onClick={onSignOut}>Sign out</button>
                  </div>
                </section>
              ) : null}

              {activeSection === 'usage' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Memory usage</span><h3>{formatNumber(billing.creditsRemaining)} credits left</h3></div>
                    <span className="company-brain-account-card__role">{usagePercent === null ? 'Current' : `${usagePercent}% used`}</span>
                  </div>
                  <p>Credits cover Memory writes, retrievals, and graph operations for your account.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Credits remaining</span><strong>{formatNumber(billing.creditsRemaining)}</strong><small>Available now</small></div>
                    <div><span>Credits used</span><strong>{formatNumber(creditsUsed)}</strong><small>Current period</small></div>
                    <div><span>Period allowance</span><strong>{formatNumber(creditsLimit)}</strong><small>Resets {formatDate(billing.periodEnd)}</small></div>
                  </div>
                  {usagePercent !== null ? (
                    <div className="memory-account-settings__meter" aria-label={`${usagePercent}% of Memory credits used`}>
                      <span style={{ width: `${usagePercent}%` }} />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeSection === 'billing' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Memory billing</span><h3>{billing.planName || 'Starter plan'}</h3></div>
                    <span className="company-brain-account-card__role">{formatStatus(billing.status)}</span>
                  </div>
                  <p>Review your Memory plan, add credits, apply a referral code, and open saved invoices.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Current plan</span><strong>{billing.planName || 'Starter plan'}</strong><small>{formatStatus(billing.status)}</small></div>
                    <div><span>Credit balance</span><strong>{formatNumber(billing.creditsRemaining)}</strong><small>Available to use</small></div>
                    <div><span>Current period</span><strong>{formatDate(billing.periodEnd)}</strong><small>Billing period end</small></div>
                  </div>
                  <div className="memory-account-settings__actions">
                    <button type="button" onClick={onOpenBilling}>Open billing</button>
                  </div>
                  {warning ? <p className="memory-account-settings__warning" role="status">{warning}</p> : null}
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
