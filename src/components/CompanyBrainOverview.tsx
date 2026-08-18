import type { ReactNode } from 'react'
import { canViewBrainUsage, type BrainDashboard } from '../lib/brain-dashboard'
import { MemoryOrb } from './MemoryOrb'

interface CompanyBrainOverviewProps {
  userName?: string
  dashboard: BrainDashboard | null
  memoryCount: number
  activeApiKeys: number
  totalApiKeys: number
  creditBalance: number | null
  planName: string | null
  accountStatus: string | null
  companyBrainEnabled: boolean
  demoMode: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onOpenCompany: () => void
  onOpenAccount: () => void
  onOpenConnectors: () => void
  onStartCompanyBrainSetup: () => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function formatOptionalNumber(value: number | null) {
  return typeof value === 'number' ? formatNumber(value) : 'Unavailable'
}

function formatLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function BentoCard({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  if (onClick) {
    return (
      <button type="button" className={`brain-bento-card ${className}`} onClick={onClick}>
        {children}
      </button>
    )
  }

  return <article className={`brain-bento-card ${className}`}>{children}</article>
}

function MetricIcon({ type }: { type: 'memory' | 'key' | 'plan' | 'account' | 'refresh' }) {
  if (type === 'memory') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5a3 3 0 0 0-5 2v3a3 3 0 0 0 1 5.8V17a3 3 0 0 0 4 2.8M15 5a3 3 0 0 1 5 2v3a3 3 0 0 1-1 5.8V17a3 3 0 0 1-4 2.8M9 5v15M15 5v15M9 9h6M9 15h6" /></svg>
  }
  if (type === 'key') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>
  }
  if (type === 'plan') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v11H5z" /><path d="M8 7V5h8v2M8 12h8" /></svg>
  }
  if (type === 'account') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M6 20c.7-3.8 2.7-5.7 6-5.7s5.3 1.9 6 5.7" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12A8 8 0 0 1 17.7 6.4M18 3v4h-4M6 21v-4h4" /></svg>
}

export default function CompanyBrainOverview({
  userName,
  dashboard,
  memoryCount,
  activeApiKeys,
  totalApiKeys,
  creditBalance,
  planName,
  accountStatus,
  companyBrainEnabled,
  demoMode,
  isRefreshing,
  onRefresh,
  onOpenCompany,
  onOpenAccount,
  onOpenConnectors,
  onStartCompanyBrainSetup,
}: CompanyBrainOverviewProps) {
  const firstName = userName?.split(' ')[0] || 'there'
  const organization = dashboard?.organization
  const companyMemoryCount = dashboard ? dashboard.memory.organization.memory_count : memoryCount
  const spaces = dashboard?.memory.spaces ?? []
  const connectionStatus = dashboard?.memory.connection_status ?? 'pending'
  const subscriptionName = companyBrainEnabled
    ? dashboard?.subscription?.plan_name || planName || 'No active plan'
    : planName || 'Starter plan'
  const canViewUsage = companyBrainEnabled && canViewBrainUsage(dashboard)

  return (
    <section className="brain-overview" aria-labelledby="brain-overview-title">
      <div className="brain-bento-grid">
        <BentoCard className="brain-bento-card--welcome">
          <div className="brain-bento-mark" aria-hidden="true">
            <MemoryOrb size={210} className="brain-bento-orb" />
          </div>
          <div className="brain-bento-card__footer">
            <h1 id="brain-overview-title">Hey, {firstName}</h1>
            <p>{companyBrainEnabled && organization ? `${organization.name} memory infrastructure` : 'Your personal Memory workspace'}</p>
          </div>
        </BentoCard>

        <BentoCard className="brain-bento-card--metric">
          <MetricIcon type="memory" />
          <div><strong>{formatOptionalNumber(companyBrainEnabled ? companyMemoryCount : memoryCount)}</strong><span>{companyBrainEnabled ? 'Shared memories' : 'Saved memories'}</span></div>
        </BentoCard>

        <BentoCard className="brain-bento-card--metric">
          <MetricIcon type="key" />
          <div><strong>{activeApiKeys}</strong><span>Active keys</span></div>
        </BentoCard>

        {companyBrainEnabled ? (
          <BentoCard className="brain-bento-card--connections" onClick={onOpenConnectors}>
            <div className="brain-bento-card__heading">
              <strong>Connected spaces</strong>
              <span className={`brain-status brain-status--${connectionStatus}`}>{formatLabel(connectionStatus)}</span>
            </div>
            <div className="brain-space-pills">
              {spaces.slice(0, 6).map((space) => <span key={space.id}>{space.name}</span>)}
              {!spaces.length ? <small>No spaces returned yet</small> : null}
              {spaces.length > 6 ? <span>+{spaces.length - 6}</span> : null}
            </div>
          </BentoCard>
        ) : (
          <BentoCard className="brain-bento-card--connections brain-bento-card--setup" onClick={onStartCompanyBrainSetup}>
            <div>
              <span>Company Brain</span>
              <strong>Want to set up a Company Brain?</strong>
              <small>Create a shared workspace for your team, then connect its company context.</small>
            </div>
            <span className="brain-bento-card__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" /></svg>
            </span>
          </BentoCard>
        )}

        <BentoCard className="brain-bento-card--plan">
          <MetricIcon type="plan" />
          <div>
            <strong>{companyBrainEnabled && !canViewUsage && organization ? `${formatLabel(organization.role)} access` : subscriptionName}</strong>
            <span>{companyBrainEnabled && !canViewUsage
              ? organization
                ? `Member of ${organization.name}`
                : 'Organization details unavailable'
              : canViewUsage
              ? dashboard?.subscription
                ? formatLabel(dashboard.subscription.status)
                : accountStatus
                  ? formatLabel(accountStatus)
                  : 'Billing unavailable'
              : accountStatus
                ? formatLabel(accountStatus)
                : 'Memory billing'}</span>
          </div>
        </BentoCard>

        {companyBrainEnabled ? (
          <BentoCard className="brain-bento-card--company" onClick={onOpenCompany}>
            <div>
              <span>Company Brain</span>
              <strong>{organization?.name || 'Organization unavailable'}</strong>
              <small>{organization?.domain || 'No domain returned'}</small>
            </div>
            <span className="brain-bento-card__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" /></svg>
            </span>
          </BentoCard>
        ) : null}

        <BentoCard className="brain-bento-card--account" onClick={onOpenAccount}>
          <MetricIcon type="account" />
          <div>
            <strong>{companyBrainEnabled && organization ? formatLabel(organization.role) : 'Memory account'}</strong>
            <span>{totalApiKeys} total credentials{creditBalance === null ? '' : ` · ${formatNumber(creditBalance)} credits`}</span>
          </div>
        </BentoCard>

        <BentoCard className="brain-bento-card--refresh" onClick={demoMode ? undefined : onRefresh}>
          <MetricIcon type="refresh" />
          <span>{demoMode ? 'Demo data' : isRefreshing ? 'Refreshing…' : 'Refresh all'}</span>
        </BentoCard>
      </div>
    </section>
  )
}
