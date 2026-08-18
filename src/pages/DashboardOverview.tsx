import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import ReferralVanish from '../components/ReferralVanish'
import {
  AccountDetailNavigation,
  AccountSectionDeck,
  type AccountDetailOption,
  type AccountSectionOption,
} from '../components/AccountSettingsNavigation'
import CompanyBrainPricing, { type CompanyBrainPlan } from '../components/CompanyBrainPricing'
import CompanyBrainOverview from '../components/CompanyBrainOverview'
import CompanyBrainCommandSearch, { type CompanyBrainCommandSection } from '../components/CompanyBrainCommandSearch'
import CompanyBrainOrganizationSwitcher from '../components/CompanyBrainOrganizationSwitcher'
import MemoryAccountPanel from '../components/MemoryAccountPanel'
import type { MemoryBillingPlan, MemoryInvoice, MemoryReceiptState } from '../components/MemoryBillingPanel'
import SlackHistoryProgress from '../components/SlackHistoryProgress'
import { FloatingDock } from '../components/floating-dock'
import MemCodeSidebar from '../components/MemCodeSidebar'
import { useAuth } from '../contexts/AuthContext'
import { API_URL, BRAIN_API_URL, isAuthenticationRequired } from '../lib/api'
import { getLoginUrl } from '../lib/auth-routing'
import {
  publishBrainOrganizationChange,
  subscribeToBrainOrganizationChanges,
} from '../lib/brain-organizations'
import { organizationScopedHeaders } from '../lib/brain-organization-context'
import {
  BrainDashboardHttpError,
  canViewBrainUsage,
  fetchBrainDashboard,
  isBrainDashboardAuthenticationRequired,
  type BrainDashboard,
} from '../lib/brain-dashboard'
import type { CompanyOnboardingStatus } from '../lib/brain-onboarding'
import {
  CompanyMailboxHttpError,
  fetchCompanyMailboxSummary,
  subscribeToCompanyMailboxChanges,
  type CompanyMailboxSummary,
} from '../lib/brain-company-mailbox'
import { DEMO_BRAIN_DASHBOARD } from '../lib/demo-session'
import {
  readDashboardAppearance,
  type DashboardAppearance,
} from '../lib/dashboard-appearance'
import type {
  CompanyBrainDashboardView,
  OrganizationDashboardState,
} from '../components/CompanyBrainDashboard'
import {
  loadRazorpayCheckout,
  type RazorpayOrder,
  type RazorpaySuccessResponse,
} from '../lib/razorpay'
import {
  BILLING_ERROR_MESSAGES,
  readUserFacingApiError,
  userFacingErrorMessage,
} from '../lib/user-facing-errors'

const CompanyBrainDashboard = lazy(() => import('../components/CompanyBrainDashboard'))
const CompanyBrainManagement = lazy(() => import('../components/CompanyBrainManagement'))
const CompanyBrainOnboarding = lazy(() => import('../components/company-onboarding/CompanyBrainOnboarding'))
const CompanyBrainInbox = lazy(() => import('../components/CompanyBrainInbox'))
const MemoryApiKeysPanel = lazy(() => import('../components/MemoryApiKeysPanel'))
const MemoryBillingPanel = lazy(() => import('../components/MemoryBillingPanel'))
const MemoryWorkspace = lazy(() => import('../components/memory/MemoryWorkspace'))

interface APIKey {
  id: string
  key_prefix: string
  name: string
  scopes?: string[]
  created_at: string
  last_used?: string
  is_active: boolean
}

interface UsageSnapshot {
  memories_written: number
  retrievals: number
  graph_queries: number
  credits_used: number
  credits_limit: number
}

interface BillingSummary {
  plan_id?: string
  plan_name: string
  account_status?: string
  status?: string
  currency?: string
  credit_balance?: number
  available_credits?: number
  current_month?: UsageSnapshot
  current_period_start?: string | null
  current_period_end?: string | null
  next_invoice_paise?: number
  prepaid_balance_paise?: number
  invoices?: MemoryInvoice[]
}

interface BrainOrderEnvelope {
  order?: RazorpayOrder
}

type CompanyBrainSection = 'company' | 'connectors' | 'settings' | 'code' | 'pricing'
type MemoryProductSection = 'overview' | 'memory-graph' | 'memory-documents' | 'api-keys' | 'billing'
type DashboardSection = CompanyBrainSection | MemoryProductSection | 'inbox' | 'usage' | 'account' | 'mcp'
type DemoAccountSection = 'general' | 'people' | 'proactivity' | 'billing'
type DemoAccountDetail =
  | 'profile'
  | 'slack'
  | 'invitation'
  | 'invite'
  | 'members'
  | 'access'
  | 'participation'
  | 'channels'
  | 'limits'
  | 'summary'
  | 'plan'
  | 'refunds'

const DEMO_MEMORY_REFERRAL_CREDITS = 3_750
const DEMO_MEMORY_REFERRAL_CODE = 'MEMORYFREE'

const DEMO_ACCOUNT_SECTIONS: ReadonlyArray<AccountSectionOption<DemoAccountSection>> = [
  { id: 'general', label: 'General', description: 'Workspace identity and connected accounts', icon: 'general' },
  { id: 'people', label: 'People', description: 'Members, roles and invitations', icon: 'people' },
  { id: 'proactivity', label: 'Participation', description: 'Participation rules and limits', icon: 'proactivity' },
  { id: 'billing', label: 'Billing', description: 'Plan, invoices and subscription controls', icon: 'billing' },
]

const DEMO_ACCOUNT_DETAILS: Readonly<Record<DemoAccountSection, ReadonlyArray<AccountDetailOption<DemoAccountDetail>>>> = {
  general: [
    { id: 'slack', label: 'Link approvals', icon: 'slack' },
    { id: 'invitation', label: 'Accept invite', icon: 'invitation' },
  ],
  people: [
    { id: 'invite', label: 'Invite member', icon: 'invite' },
  ],
  proactivity: [
    { id: 'participation', label: 'Enable', icon: 'participation' },
    { id: 'channels', label: 'Channels', icon: 'channels' },
    { id: 'limits', label: 'Limits', icon: 'limits' },
  ],
  billing: [
    { id: 'plan', label: 'Change plan', icon: 'plan' },
    { id: 'refunds', label: 'Request refund', icon: 'refunds' },
  ],
}

const DEMO_ACCOUNT_DEFAULT_DETAILS: Record<DemoAccountSection, DemoAccountDetail | null> = {
  general: null,
  people: null,
  proactivity: null,
  billing: null,
}

const DEMO_ACCOUNT_OVERVIEWS: Record<DemoAccountSection, DemoAccountDetail> = {
  general: 'profile',
  people: 'members',
  proactivity: 'participation',
  billing: 'summary',
}

const COMPANY_BRAIN_DOCK_ITEMS: ReadonlyArray<{
  id: CompanyBrainSection
  label: string
}> = [
  { id: 'company', label: 'Overview' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'settings', label: 'Brain settings' },
  { id: 'code', label: 'Code Mode' },
  { id: 'pricing', label: 'Pricing' },
]

function CompanyBrainDockIcon({ section }: { section: CompanyBrainSection }) {
  if (section === 'company') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />
      </svg>
    )
  }
  if (section === 'connectors') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 12h8M5 8v8M19 8v8M3 8h4v8H3zM17 8h4v8h-4z" />
      </svg>
    )
  }
  if (section === 'settings') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h7M15 17h5" />
        <circle cx="16" cy="7" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="17" r="2" />
      </svg>
    )
  }
  if (section === 'code') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m9 7-5 5 5 5M15 7l5 5-5 5M14 4l-4 16" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 7h14v11H5zM8 7V5h8v2M8 12h8" />
    </svg>
  )
}

function CompanyBrainNavigationDock({
  activeSection,
  onSectionChange,
}: {
  activeSection: CompanyBrainSection
  onSectionChange: (section: CompanyBrainSection) => void
}) {
  return (
    <nav className="floating-dock-shell" aria-label="Company Brain navigation">
      <FloatingDock
        items={COMPANY_BRAIN_DOCK_ITEMS.map((item) => ({
          title: item.label,
          icon: <CompanyBrainDockIcon section={item.id} />,
          active: activeSection === item.id,
          onClick: () => onSectionChange(item.id),
        }))}
      />
    </nav>
  )
}

const MEMORY_DOCK_ITEMS: ReadonlyArray<{ id: MemoryProductSection; label: string }> = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'memory-graph', label: 'Memory graph' },
  { id: 'memory-documents', label: 'Memory documents' },
  { id: 'api-keys', label: 'API keys' },
  { id: 'billing', label: 'Billing' },
]

function MemoryDockIcon({ section }: { section: MemoryProductSection }) {
  if (section === 'overview') {
    return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
  }
  if (section === 'memory-graph') {
    return <svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="m8 7 8-1M7 9l4 7M17 8l-4 8" /></svg>
  }
  if (section === 'memory-documents') {
    return <svg viewBox="0 0 24 24"><path d="M3.5 7.5h7l2-2h8v13h-17z" /><path d="M7 11h10M7 14h7" /></svg>
  }
  if (section === 'api-keys') {
    return <svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>
  }
  return <svg viewBox="0 0 24 24"><path d="M5 7h14v11H5zM5 11h14M8 15h4" /></svg>
}

function MemoryNavigationDock({
  activeSection,
  onSectionChange,
}: {
  activeSection: MemoryProductSection
  onSectionChange: (section: MemoryProductSection) => void
}) {
  return (
    <nav className="floating-dock-shell" aria-label="Memory dashboard navigation">
      <FloatingDock
        items={MEMORY_DOCK_ITEMS.map((item) => ({
          title: item.label,
          icon: <MemoryDockIcon section={item.id} />,
          active: activeSection === item.id,
          onClick: () => onSectionChange(item.id),
        }))}
      />
    </nav>
  )
}

interface CheckoutNotice {
  tone: 'success' | 'error'
  message: string
}

class CompanyBrainBillingHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'CompanyBrainBillingHttpError'
  }
}

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || ''

interface MemoryCountResponse {
  status: 'ok' | 'error'
  data?: {
    total_memories: number
  }
  error?: string
}

function getCreditBalance(summary: BillingSummary | null) {
  const balance = summary?.available_credits ?? summary?.credit_balance
  return typeof balance === 'number' ? balance : null
}

function getAccountStatus(summary: BillingSummary | null) {
  return summary?.account_status || summary?.status || null
}

function formatStatus(status: string) {
  return status
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getInitialDashboardSection(): DashboardSection {
  const section = new URLSearchParams(window.location.search).get('section')
  if (section === 'company-brain-usage') return 'usage'
  if (section === 'company-brain-settings') return 'account'
  if (
    section === 'overview'
    || section === 'memory-graph'
    || section === 'memory-documents'
    || section === 'api-keys'
    || section === 'billing'
    || section === 'usage'
    || section === 'company'
    || section === 'inbox'
    || section === 'account'
    || section === 'connectors'
    || section === 'settings'
    || section === 'code'
    || section === 'mcp'
    || section === 'pricing'
  ) {
    return section
  }
  return 'overview'
}

function getInitialCompanyBrainSetupRequest() {
  return new URLSearchParams(window.location.search).get('onboarding') === 'company-brain'
}

function razorpayFailureMessage() {
  return 'Payment failed. Please try again or use another payment method.'
}

function CompanyBrainPlanCheckoutButton({
  plan,
  demoMode,
  isProcessing,
  isCurrent,
  checkoutLocked,
  canManageBilling,
  onCheckout,
}: {
  plan: CompanyBrainPlan
  demoMode: boolean
  isProcessing: boolean
  isCurrent: boolean
  checkoutLocked: boolean
  canManageBilling: boolean | null
  onCheckout: (plan: CompanyBrainPlan) => void
}) {
  return (
    <button
      type="button"
      className="dashboard-plan__button"
      disabled={canManageBilling !== true || checkoutLocked || isCurrent}
      onClick={() => onCheckout(plan)}
    >
      {demoMode
        ? 'Checkout unavailable in demo'
        : canManageBilling === null
        ? 'Billing permission unavailable'
        : !canManageBilling
          ? 'Ask an organization admin'
          : isCurrent
            ? 'Current plan'
            : isProcessing
              ? 'Opening checkout…'
              : `Choose ${plan.name}`}
    </button>
  )
}

function PricingPanel({
  currentPlanId,
  processingPackageId,
  isRedeemingReferral,
  notice,
  canManageBilling,
  organizationChangePending,
  demoMode,
  onCheckout,
  onRedeemReferral,
}: {
  currentPlanId?: string
  processingPackageId: string | null
  isRedeemingReferral: boolean
  notice: CheckoutNotice | null
  canManageBilling: boolean | null
  organizationChangePending: boolean
  demoMode: boolean
  onCheckout: (plan: CompanyBrainPlan) => void
  onRedeemReferral: (code: string) => Promise<void>
}) {
  const billingActionLocked = processingPackageId !== null || isRedeemingReferral || organizationChangePending
  const referralDisabled = demoMode || canManageBilling !== true || billingActionLocked

  return (
    <section className="dashboard-pricing" aria-labelledby="company-brain-pricing-title">
      <div className="dashboard-pricing__intro">
        <div>
          <h2 id="company-brain-pricing-title">Choose the Company Brain plan that fits your team.</h2>
        </div>
      </div>

      {notice ? (
        <div className={`dashboard-checkout-notice dashboard-checkout-notice--${notice.tone}`} role="status">
          {notice.message}
        </div>
      ) : null}

      {canManageBilling !== true ? (
        <div className="dashboard-alert" role="status">
          {demoMode
            ? 'Demo mode is read-only. You can review pricing, but checkout and billing changes are disabled.'
            : canManageBilling === null
            ? 'Organization billing permissions are unavailable, so checkout is disabled.'
            : 'You can review plan options, but only an organization admin or owner can start checkout or change billing.'}
        </div>
      ) : null}

      <ReferralVanish
        id="company-brain-referral-code"
        label="Company onboarding code"
        description={demoMode
          ? 'Referral activation is disabled in the read-only demo.'
          : canManageBilling === null
            ? 'Billing permissions must be available before a code can be applied.'
            : canManageBilling
              ? 'Apply a code supplied by Memcode Team to activate its Company Brain plan.'
              : 'Only an organization admin or owner can apply a Company Brain onboarding code.'}
        disabled={referralDisabled}
        isSubmitting={isRedeemingReferral}
        onApply={onRedeemReferral}
      />

      <CompanyBrainPricing
        renderPlanAction={(plan) => (
          <CompanyBrainPlanCheckoutButton
            plan={plan}
            demoMode={demoMode}
            isProcessing={processingPackageId === plan.packageId}
            isCurrent={currentPlanId === plan.packageId}
            checkoutLocked={billingActionLocked}
            canManageBilling={canManageBilling}
            onCheckout={onCheckout}
          />
        )}
      />
    </section>
  )
}

function DemoAccountPanel({
  dashboard,
  onSignOut,
}: {
  dashboard: BrainDashboard
  onSignOut: () => void
}) {
  const [activeSection, setActiveSection] = useState<DemoAccountSection | null>(null)
  const [activeDetails, setActiveDetails] = useState<Record<DemoAccountSection, DemoAccountDetail | null>>(DEMO_ACCOUNT_DEFAULT_DETAILS)
  const [detailDirection, setDetailDirection] = useState<1 | -1>(1)
  const activeDetail = activeSection ? activeDetails[activeSection] : null
  const overviewContent = activeSection
    ? getDemoAccountContent(dashboard, DEMO_ACCOUNT_OVERVIEWS[activeSection])
    : null
  const configurationContent = activeDetail ? getDemoAccountConfigurationContent(dashboard, activeDetail) : null

  const selectSection = (section: DemoAccountSection | null) => {
    setActiveSection(section)
    if (section) setActiveDetails((current) => ({ ...current, [section]: null }))
  }

  const selectDetail = (detail: DemoAccountDetail | null) => {
    if (!activeSection) return
    const options = DEMO_ACCOUNT_DETAILS[activeSection]
    const currentIndex = options.findIndex((option) => option.id === activeDetails[activeSection])
    const nextIndex = options.findIndex((option) => option.id === detail)
    if (detail) setDetailDirection(nextIndex >= currentIndex ? 1 : -1)
    setActiveDetails((current) => (
      current[activeSection] === detail ? current : { ...current, [activeSection]: detail }
    ))
  }

  return (
    <section className={`brain-panel company-brain-settings demo-account-settings ${activeSection ? 'has-active-section' : 'is-section-picker'}`} aria-labelledby="demo-account-title">
      <header className="brain-panel__header">
        <h1 id="demo-account-title">Account</h1>
      </header>

      <div className={`company-brain-settings__layout ${activeSection ? 'has-selection' : 'is-picker'}`}>
        <AccountSectionDeck
          sections={DEMO_ACCOUNT_SECTIONS}
          activeSection={activeSection}
          onSectionChange={selectSection}
          panelId={activeSection ? 'demo-account-settings-panel' : undefined}
        />
        {activeSection && overviewContent ? (
        <div className="company-brain-settings__workspace">
          <div
            id="demo-account-settings-panel"
            className="company-brain-settings__panel company-brain-settings__readout"
            role="tabpanel"
            tabIndex={0}
            aria-labelledby={`account-section-${activeSection}`}
          >
            <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="demo-account-overview-title">
              <div className="company-brain-setting-card__heading">
                <div><span>{overviewContent.eyebrow}</span><h3 id="demo-account-overview-title">{overviewContent.title}</h3></div>
                <span className="company-brain-account-card__role">{overviewContent.status}</span>
              </div>
              <p>{overviewContent.description}</p>
              <div className="company-brain-account-card__details">
                {overviewContent.details.map((detail) => (
                  <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong><small>{detail.note}</small></div>
                ))}
              </div>
              {activeSection === 'general' ? (
                <div className="company-brain-account-card__actions">
                  <div><strong>Account session</strong><small>Sign out of the Company Brain demo on this browser.</small></div>
                  <button type="button" onClick={onSignOut}>Sign out</button>
                </div>
              ) : null}
              <small className="company-brain-settings__dock-hint">Use the dock below to configure this section.</small>
            </section>
          </div>

          <AccountDetailNavigation
            items={DEMO_ACCOUNT_DETAILS[activeSection]}
            activeItem={activeDetail}
            onItemChange={selectDetail}
            label={`${DEMO_ACCOUNT_SECTIONS.find((section) => section.id === activeSection)?.label || 'Account'} configuration`}
            panelId={activeDetail ? 'demo-account-detail-panel' : undefined}
          >
          {activeDetail && configurationContent ? (
            <div
              key={`${activeSection}-${activeDetail}`}
              id="demo-account-detail-panel"
              className="company-brain-settings__detail demo-account-settings__detail"
              data-direction={detailDirection}
              role="tabpanel"
              aria-labelledby={`account-detail-${activeDetail}`}
            >
              <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="demo-account-setting-title">
                <div className="company-brain-setting-card__heading">
                  <div>
                    <h3 id="demo-account-setting-title">{configurationContent.title}</h3>
                  </div>
                </div>
                <div className="demo-account-settings__notice" role="status">
                  This control is disabled in the read-only demo.
                </div>
              </section>
            </div>
          ) : null}
          </AccountDetailNavigation>
        </div>
        ) : null}
      </div>
    </section>
  )
}

interface DemoAccountContent {
  eyebrow: string
  title: string
  description: string
  status: string
  details: Array<{ label: string; value: string; note: string }>
}

function getDemoAccountContent(dashboard: BrainDashboard, detail: DemoAccountDetail): DemoAccountContent {
  const content: Record<DemoAccountDetail, DemoAccountContent> = {
    profile: {
      eyebrow: 'Workspace account',
      title: dashboard.organization.name,
      description: 'Your signed-in identity and organization access, kept together without repeating it in the page header.',
      status: formatStatus(dashboard.organization.role),
      details: [
        { label: 'Signed in as', value: dashboard.viewer.name, note: dashboard.viewer.email },
        { label: 'Organization access', value: formatStatus(dashboard.organization.role), note: 'Can manage organization settings' },
        { label: 'Organizations', value: '1', note: 'One active organization' },
      ],
    },
    slack: {
      eyebrow: 'Connected identity',
      title: 'Slack approvals',
      description: 'Link Slack actions to your verified MemCode identity with a short-lived token.',
      status: 'Not linked',
      details: [
        { label: 'Workspace', value: 'Acme Company', note: 'Organization-scoped' },
        { label: 'Identity', value: dashboard.viewer.name, note: 'Verified account' },
        { label: 'Link token', value: 'Unavailable', note: 'Disabled in demo mode' },
      ],
    },
    invitation: {
      eyebrow: 'Organization access',
      title: 'Accept an invitation',
      description: 'Join another organization with an invitation matching your verified email.',
      status: 'Ready',
      details: [
        { label: 'Verified email', value: dashboard.viewer.email, note: 'Invitation must match' },
        { label: 'Active organization', value: dashboard.organization.name, note: 'Current workspace' },
        { label: 'Session change', value: 'Required', note: 'Rotates after acceptance' },
      ],
    },
    invite: {
      eyebrow: 'People',
      title: 'Invite a verified member',
      description: 'Create role-scoped organization access for a teammate using their work email.',
      status: 'Admin',
      details: [
        { label: 'Default role', value: 'Member', note: 'Least privilege' },
        { label: 'Delivery', value: 'Trusted channel', note: 'Secret shown once' },
        { label: 'Expiry', value: 'Time limited', note: 'Revocable before use' },
      ],
    },
    members: {
      eyebrow: 'Current access',
      title: 'Members and pending invitations',
      description: 'Review who belongs to the organization, their access level and invitations that have not been accepted yet.',
      status: '4 members',
      details: [
        { label: 'Members', value: '4', note: 'Active organization access' },
        { label: 'Owners and admins', value: '2', note: 'Can manage settings' },
        { label: 'Pending invitations', value: '1', note: 'Awaiting acceptance' },
      ],
    },
    access: {
      eyebrow: 'Pending access',
      title: 'Invitations',
      description: 'Track pending invitations and revoke access before a secret is accepted.',
      status: '1 pending',
      details: [
        { label: 'Pending', value: '1', note: 'Awaiting acceptance' },
        { label: 'Accepted', value: '3', note: 'Active members' },
        { label: 'Expired', value: '0', note: 'Nothing to clean up' },
      ],
    },
    participation: {
      eyebrow: 'Channel participation',
      title: 'Proactive participation',
      description: 'Decide whether Company Brain may consider useful untagged messages.',
      status: 'Off',
      details: [
        { label: 'Public channels', value: 'Explicit only', note: 'No automatic discovery' },
        { label: 'Private channels', value: 'Excluded', note: 'Permission boundary' },
        { label: 'Direct messages', value: 'Excluded', note: 'Personal memory remains private' },
      ],
    },
    channels: {
      eyebrow: 'Channel scope',
      title: 'Allowed Slack channels',
      description: 'Choose the exact public channel IDs where proactive participation is allowed.',
      status: '0 selected',
      details: [
        { label: 'Allowed channels', value: 'None', note: 'Add explicit Slack IDs' },
        { label: 'Validation', value: 'Strict', note: 'Public channel format only' },
        { label: 'Default behavior', value: 'Off', note: 'No implicit expansion' },
      ],
    },
    limits: {
      eyebrow: 'Participation limits',
      title: 'Reply pace',
      description: 'Set an hourly ceiling and cooldowns so proactive replies remain deliberate.',
      status: 'Safe defaults',
      details: [
        { label: 'Hourly maximum', value: '6', note: 'Per channel' },
        { label: 'Normal cooldown', value: '3 min', note: 'Between normal replies' },
        { label: 'Low priority', value: '15 min', note: 'Longer quiet period' },
      ],
    },
    summary: {
      eyebrow: 'Subscription',
      title: 'Company Brain Plus',
      description: 'See the active plan, billing state and paid-through date at a glance.',
      status: 'Active',
      details: [
        { label: 'Current plan', value: 'Company Brain Plus', note: 'Monthly billing' },
        { label: 'Status', value: 'Active', note: 'Organization access enabled' },
        { label: 'Next cycle', value: 'Aug 31', note: 'Renews unless changed' },
      ],
    },
    plan: {
      eyebrow: 'Plan controls',
      title: 'Change or cancel',
      description: 'Schedule plan changes at cycle end or apply an authorized change immediately.',
      status: 'Monthly',
      details: [
        { label: 'Current tier', value: 'Plus', note: 'Active package' },
        { label: 'Change timing', value: 'Cycle end', note: 'Recommended default' },
        { label: 'Cancellation', value: 'Not scheduled', note: 'Access remains active' },
      ],
    },
    refunds: {
      eyebrow: 'Invoices',
      title: 'Refund history',
      description: 'Review paid invoices and request a full or partial provider-side refund.',
      status: 'No requests',
      details: [
        { label: 'Paid invoices', value: '1', note: 'Current billing period' },
        { label: 'Refunded', value: '$0', note: 'No completed refunds' },
        { label: 'Pending', value: '$0', note: 'No provider reconciliation' },
      ],
    },
  }

  return content[detail]
}

function getDemoAccountConfigurationContent(dashboard: BrainDashboard, detail: DemoAccountDetail): DemoAccountContent {
  if (detail !== 'participation') return getDemoAccountContent(dashboard, detail)
  return {
    eyebrow: 'Participation settings',
    title: 'Enable proactive participation',
    description: 'Turn consideration of useful untagged public-channel messages on or off.',
    status: 'Off',
    details: [
      { label: 'Current setting', value: 'Off', note: 'No proactive replies' },
      { label: 'When enabled', value: 'Public channels', note: 'Explicit allowlist only' },
      { label: 'Save action', value: 'Admin only', note: 'Organization scoped' },
    ],
  }
}

function OrganizationAccessState({
  title,
  dashboard,
}: {
  title: string
  dashboard: BrainDashboard | null
}) {
  return (
    <section className="brain-panel brain-panel--state" role="status">
      <strong>{title}</strong>
      <p>{dashboard
        ? `You are a member of ${dashboard.organization.name}. Ask an admin or owner if this organization needs billing, usage, or administrative changes.`
        : 'Company Brain could not verify your organization access. Refresh the dashboard and try again.'}</p>
    </section>
  )
}

export default function DashboardOverview() {
  const { user, token, logout, isDemo } = useAuth()
  const [activeSection, setActiveSection] = useState<DashboardSection>(getInitialDashboardSection)
  const [apiKeys, setApiKeys] = useState<APIKey[]>([])
  const [accountBillingSummary, setAccountBillingSummary] = useState<BillingSummary | null>(null)
  const [memoryBillingPlans, setMemoryBillingPlans] = useState<MemoryBillingPlan[]>([])
  const [memoryCheckoutNotice, setMemoryCheckoutNotice] = useState<CheckoutNotice | null>(null)
  const [memoryProcessingPackageId, setMemoryProcessingPackageId] = useState<string | null>(null)
  const [isRedeemingMemoryReferral, setIsRedeemingMemoryReferral] = useState(false)
  const [memoryReceipt, setMemoryReceipt] = useState<MemoryReceiptState | null>(null)
  const [organizationDashboard, setOrganizationDashboard] = useState<BrainDashboard | null>(null)
  const [organizationDashboardState, setOrganizationDashboardState] = useState<OrganizationDashboardState>('loading')
  const [organizationDashboardWarning, setOrganizationDashboardWarning] = useState<string | null>(null)
  const [memoryCount, setMemoryCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [billingWarning, setBillingWarning] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [processingPackageId, setProcessingPackageId] = useState<string | null>(null)
  const [isRedeemingReferral, setIsRedeemingReferral] = useState(false)
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice | null>(null)
  const [isOrganizationChanging, setIsOrganizationChanging] = useState(false)
  const [dashboardAppearance, setDashboardAppearance] = useState<DashboardAppearance>(readDashboardAppearance)
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(false)
  const [companyBrainSetupStatus, setCompanyBrainSetupStatus] = useState<CompanyOnboardingStatus | null>(null)
  const [companyBrainSetupRequested, setCompanyBrainSetupRequested] = useState(getInitialCompanyBrainSetupRequest)
  const [companyBrainOnboardingOpen, setCompanyBrainOnboardingOpen] = useState(false)
  const [companyBrainCreateOpen, setCompanyBrainCreateOpen] = useState(false)
  const [onboardingReopenToken, setOnboardingReopenToken] = useState(0)
  const [slackHistoryRefreshToken, setSlackHistoryRefreshToken] = useState(0)
  const [slackHistoryProgressVisible, setSlackHistoryProgressVisible] = useState(false)
  const [mailboxSummary, setMailboxSummary] = useState<CompanyMailboxSummary | null>(null)
  const organizationRequestId = useRef(0)
  const dashboardMainRef = useRef<HTMLElement>(null)
  const mailboxSummaryRequestRef = useRef<AbortController | null>(null)
  const mailboxSummaryInFlightRef = useRef(false)
  const mailboxSummaryRefreshPendingRef = useRef(false)
  const mailboxRetryUntilRef = useRef(0)
  const mailboxRetryTimerRef = useRef<number | null>(null)
  const memoryReceiptTimerRef = useRef<number | null>(null)
  const demoMemoryReferralRedeemedRef = useRef(false)
  const refreshMailboxSummaryRef = useRef<() => void>(() => undefined)
  const effectiveOrganizationDashboard = isDemo ? DEMO_BRAIN_DASHBOARD : organizationDashboard
  const mailboxOrganizationId = isDemo ? null : effectiveOrganizationDashboard?.organization.id ?? null

  useEffect(() => () => {
    if (memoryReceiptTimerRef.current !== null) window.clearTimeout(memoryReceiptTimerRef.current)
  }, [])

  const activeApiKeys = useMemo(() => apiKeys.filter((key) => key.is_active).length, [apiKeys])

  const handleAuthFailure = useCallback(() => {
    logout()
    window.location.href = getLoginUrl('/dashboard')
  }, [logout])

  const refreshMailboxSummary = useCallback(async () => {
    if (!mailboxOrganizationId) return
    if (mailboxSummaryInFlightRef.current) {
      mailboxSummaryRefreshPendingRef.current = true
      return
    }
    const now = Date.now()
    if (now < mailboxRetryUntilRef.current) return
    mailboxSummaryRefreshPendingRef.current = false
    mailboxSummaryInFlightRef.current = true
    mailboxSummaryRequestRef.current?.abort()
    const controller = new AbortController()
    mailboxSummaryRequestRef.current = controller
    try {
      const next = await fetchCompanyMailboxSummary(mailboxOrganizationId, controller.signal)
      if (controller.signal.aborted || mailboxSummaryRequestRef.current !== controller) return
      setMailboxSummary(next)
      mailboxRetryUntilRef.current = 0
      if (mailboxRetryTimerRef.current !== null) {
        window.clearTimeout(mailboxRetryTimerRef.current)
        mailboxRetryTimerRef.current = null
      }
    } catch (error) {
      if (controller.signal.aborted || mailboxSummaryRequestRef.current !== controller) return
      if (error instanceof CompanyMailboxHttpError && error.status === 401) {
        handleAuthFailure()
        return
      }
      if (error instanceof CompanyMailboxHttpError && error.status === 429 && error.retryAfterMs !== undefined) {
        mailboxRetryUntilRef.current = Date.now() + error.retryAfterMs
        if (mailboxRetryTimerRef.current !== null) window.clearTimeout(mailboxRetryTimerRef.current)
        mailboxRetryTimerRef.current = window.setTimeout(() => {
          mailboxRetryTimerRef.current = null
          mailboxRetryUntilRef.current = 0
          refreshMailboxSummaryRef.current()
        }, error.retryAfterMs)
      }
    } finally {
      if (mailboxSummaryRequestRef.current === controller) {
        mailboxSummaryRequestRef.current = null
        mailboxSummaryInFlightRef.current = false
        if (mailboxSummaryRefreshPendingRef.current) {
          mailboxSummaryRefreshPendingRef.current = false
          refreshMailboxSummaryRef.current()
        }
      }
    }
  }, [handleAuthFailure, mailboxOrganizationId])

  refreshMailboxSummaryRef.current = () => void refreshMailboxSummary()

  useEffect(() => {
    setMailboxSummary(null)
    const previousRequest = mailboxSummaryRequestRef.current
    mailboxSummaryRequestRef.current = null
    previousRequest?.abort()
    mailboxSummaryInFlightRef.current = false
    mailboxSummaryRefreshPendingRef.current = false
    mailboxRetryUntilRef.current = 0
    if (mailboxRetryTimerRef.current !== null) {
      window.clearTimeout(mailboxRetryTimerRef.current)
      mailboxRetryTimerRef.current = null
    }
    if (!mailboxOrganizationId) return undefined

    void refreshMailboxSummary()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshMailboxSummary()
    }, 60_000)
    const refreshOnFocus = () => void refreshMailboxSummary()
    window.addEventListener('focus', refreshOnFocus)
    const unsubscribe = subscribeToCompanyMailboxChanges(refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
      unsubscribe()
      const activeRequest = mailboxSummaryRequestRef.current
      mailboxSummaryRequestRef.current = null
      activeRequest?.abort()
      mailboxSummaryInFlightRef.current = false
      mailboxSummaryRefreshPendingRef.current = false
      if (mailboxRetryTimerRef.current !== null) {
        window.clearTimeout(mailboxRetryTimerRef.current)
        mailboxRetryTimerRef.current = null
      }
    }
  }, [mailboxOrganizationId, refreshMailboxSummary])

  useEffect(() => {
    if (mailboxSummary?.status !== 'provisioning') return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshMailboxSummary()
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [mailboxSummary?.status, refreshMailboxSummary])

  const showSection = useCallback((section: DashboardSection) => {
    setActiveSection(section)
    const url = new URL(window.location.href)
    if (section === 'overview') {
      url.searchParams.delete('section')
    } else {
      url.searchParams.set('section', section)
    }
    window.history.replaceState({}, '', url)
  }, [])

  const requestCompanyBrainSetup = useCallback(() => {
    setCompanyBrainSetupRequested(true)
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('onboarding') !== 'company-brain') return
    url.searchParams.delete('onboarding')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  useEffect(() => {
    if (!companyBrainSetupRequested || organizationDashboardState === 'loading') return
    if (organizationDashboard) {
      if (companyBrainSetupStatus === null) return
      setCompanyBrainSetupRequested(false)
      if (companyBrainSetupStatus === 'completed') {
        showSection('company')
        return
      }
      if (companyBrainSetupStatus === 'not_started') {
        setCompanyBrainCreateOpen(true)
        return
      }
      setCompanyBrainOnboardingOpen(true)
      setOnboardingReopenToken((current) => current + 1)
      return
    }
    setCompanyBrainSetupRequested(false)
    setCompanyBrainCreateOpen(true)
  }, [companyBrainSetupRequested, companyBrainSetupStatus, organizationDashboard, organizationDashboardState, showSection])

  const reopenOnboarding = useCallback(() => {
    setCompanyBrainOnboardingOpen(true)
    setOnboardingReopenToken((current) => current + 1)
  }, [])

  const refreshSlackHistoryProgress = useCallback(() => {
    setSlackHistoryRefreshToken((current) => current + 1)
  }, [])

  const handleMailboxUnreadCountChange = useCallback((count: number, capped: boolean) => {
    setMailboxSummary((current) => current
      ? { ...current, unreadCount: count, unreadCountCapped: capped }
      : current)
  }, [])

  useEffect(() => {
    setOnboardingIncomplete(false)
    setCompanyBrainSetupStatus(null)
    setOnboardingReopenToken(0)
    setSlackHistoryRefreshToken(0)
    setSlackHistoryProgressVisible(false)
  }, [effectiveOrganizationDashboard?.organization.id])

  const signOut = useCallback(() => {
    logout()
    window.location.href = '/'
  }, [logout])

  useEffect(() => {
    dashboardMainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [activeSection])

  const fetchApiKeys = useCallback(async () => {
    if (!token) return
    const response = await fetch(`${API_URL}/api/keys`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      if (isAuthenticationRequired(response.status)) {
        handleAuthFailure()
        return
      }
      throw new Error('Failed to load API keys.')
    }

    const data = (await response.json()) as { keys?: APIKey[] }
    setApiKeys(data.keys || [])
  }, [handleAuthFailure, token])

  const fetchAccountBillingSummary = useCallback(async () => {
    if (!token) return
    let response: Response
    try {
      response = await fetch(`${API_URL}/api/billing/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      setAccountBillingSummary(null)
      setMemoryBillingPlans([])
      setBillingWarning('Account billing is temporarily unavailable.')
      return
    }

    if (!response.ok) {
      if (isAuthenticationRequired(response.status)) {
        handleAuthFailure()
        return
      }
      setAccountBillingSummary(null)
      setMemoryBillingPlans([])
      setBillingWarning('Account billing is temporarily unavailable.')
      return
    }

    try {
      const payload = await response.json() as {
        summary?: BillingSummary | null
        plans?: MemoryBillingPlan[]
      }
      const summary = Object.prototype.hasOwnProperty.call(payload, 'summary')
        ? payload.summary ?? null
        : payload as BillingSummary
      setAccountBillingSummary(summary)
      setMemoryBillingPlans(Array.isArray(payload.plans) ? payload.plans : [])
      setBillingWarning(summary ? null : 'Account billing is temporarily unavailable.')
    } catch {
      setAccountBillingSummary(null)
      setMemoryBillingPlans([])
      setBillingWarning('Account billing is temporarily unavailable.')
    }
  }, [handleAuthFailure, token])

  const fetchOrganizationDashboard = useCallback(async (
    force = false,
    expectedOrganizationId?: string,
  ) => {
    const requestId = ++organizationRequestId.current
    setOrganizationDashboardState('loading')

    try {
      const dashboard = await fetchBrainDashboard({ dedupe: !force, expectedOrganizationId })
      if (organizationRequestId.current !== requestId) return null
      setOrganizationDashboard(dashboard)
      setOrganizationDashboardState('ready')
      setOrganizationDashboardWarning(null)
      return dashboard
    } catch (err) {
      if (organizationRequestId.current !== requestId) return null
      if (isBrainDashboardAuthenticationRequired(err)) {
        handleAuthFailure()
        return null
      }
      setOrganizationDashboard(null)
      setOrganizationDashboardState('unavailable')
      const missing = err instanceof BrainDashboardHttpError && err.status === 404
      setOrganizationDashboardWarning(missing
        ? null
        : userFacingErrorMessage(err, 'The organization dashboard is temporarily unavailable.'))
      return null
    }
  }, [handleAuthFailure])

  const handleCompanyBrainOrganizationChanged = useCallback(async (
    expectedOrganizationId?: string,
    publishChange = true,
  ) => {
    // Invalidate any response that began under the previous session-bound organization.
    setIsOrganizationChanging(true)
    organizationRequestId.current += 1
    setOrganizationDashboard(null)
    setOrganizationDashboardState('loading')
    setOrganizationDashboardWarning(null)
    setCheckoutNotice(null)
    setProcessingPackageId(null)
    setIsRedeemingReferral(false)
    if (publishChange) publishBrainOrganizationChange(expectedOrganizationId)
    try {
      await fetchOrganizationDashboard(true, expectedOrganizationId)
    } finally {
      setIsOrganizationChanging(false)
    }
  }, [fetchOrganizationDashboard])

  const handleCompanyBrainBillingChanged = useCallback(async () => {
    await fetchOrganizationDashboard(true)
  }, [fetchOrganizationDashboard])

  const handleCompanyBrainOrganizationCreated = useCallback(() => {
    setCompanyBrainOnboardingOpen(true)
    setOnboardingReopenToken((current) => current + 1)
  }, [])

  const fetchMemoryCount = useCallback(async () => {
    if (!token) return
    const params = new URLSearchParams({ limit: '1', offset: '0' })
    const response = await fetch(`${API_URL}/api/memory-graph?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      if (isAuthenticationRequired(response.status)) {
        handleAuthFailure()
        return
      }
      throw new Error('Failed to load memory count.')
    }

    const result = (await response.json()) as MemoryCountResponse
    if (result.status === 'error') {
      throw new Error('Failed to load memory count.')
    }

    setMemoryCount(result.data?.total_memories || 0)
  }, [handleAuthFailure, token])

  const refreshDashboard = useCallback(async () => {
    if (!token) return
    setIsRefreshing(true)
    setError(null)

    try {
      await Promise.all([
        fetchApiKeys(),
        fetchAccountBillingSummary(),
        fetchMemoryCount(),
        fetchOrganizationDashboard(),
      ])
    } catch (err) {
      setError(userFacingErrorMessage(err, 'Failed to refresh dashboard.'))
    } finally {
      setIsRefreshing(false)
    }
  }, [fetchAccountBillingSummary, fetchApiKeys, fetchMemoryCount, fetchOrganizationDashboard, token])

  useEffect(() => {
    void refreshDashboard()
  }, [refreshDashboard])

  useEffect(() => {
    if (isDemo) return undefined
    return subscribeToBrainOrganizationChanges((organizationId) => {
      void handleCompanyBrainOrganizationChanged(organizationId, false)
    })
  }, [handleCompanyBrainOrganizationChanged, isDemo])

  const printMemoryInvoice = useCallback((
    packageLabel: string,
    invoice: MemoryInvoice,
    source: 'razorpay' | 'referral',
    message: string,
  ) => {
    setMemoryReceipt({ stage: 'printing', packageLabel, invoice, source })
    setMemoryCheckoutNotice({ tone: 'success', message })
    if (memoryReceiptTimerRef.current !== null) window.clearTimeout(memoryReceiptTimerRef.current)
    memoryReceiptTimerRef.current = window.setTimeout(() => {
      setMemoryReceipt({ stage: 'complete', packageLabel, invoice, source })
      memoryReceiptTimerRef.current = null
    }, 1_850)
  }, [])

  const verifyMemoryPayment = useCallback(async (
    payment: RazorpaySuccessResponse,
    plan: MemoryBillingPlan,
    packageLabel: string,
  ) => {
    if (!token) return
    setMemoryReceipt({ stage: 'processing', packageLabel, invoice: null })
    try {
      const response = await fetch(`${API_URL}/api/billing/razorpay/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payment, package_id: plan.id }),
      })
      if (response.status === 401) {
        setMemoryReceipt(null)
        handleAuthFailure()
        return
      }
      if (!response.ok) throw new Error('Payment verification failed. Contact support if you were charged.')

      const payload = await response.json() as { summary?: BillingSummary }
      if (!payload.summary) throw new Error('Payment verification returned no billing summary.')
      setAccountBillingSummary(payload.summary)
      setBillingWarning(null)
      const invoice = payload.summary.invoices?.find((candidate) => (
        candidate.id === payment.razorpay_payment_id
        || candidate.razorpay_payment_id === payment.razorpay_payment_id
      )) || payload.summary.invoices?.[0] || null
      if (!invoice) throw new Error('Payment verification returned no invoice.')
      printMemoryInvoice(
        packageLabel,
        invoice,
        'razorpay',
        `${packageLabel} credits are ready. Your invoice has been saved below.`,
      )
    } catch (nextError) {
      setMemoryReceipt(null)
      setMemoryCheckoutNotice({
        tone: 'error',
        message: userFacingErrorMessage(nextError, 'Payment needs verification. Contact support if you were charged.'),
      })
    } finally {
      setMemoryProcessingPackageId(null)
    }
  }, [handleAuthFailure, printMemoryInvoice, token])

  const startMemoryCheckout = useCallback(async (plan: MemoryBillingPlan, packageLabel: string) => {
    if (!token || isDemo) {
      setMemoryCheckoutNotice({ tone: 'error', message: 'Checkout is disabled in the read-only demo.' })
      return
    }
    setMemoryProcessingPackageId(plan.id)
    setMemoryCheckoutNotice(null)
    try {
      const response = await fetch(`${API_URL}/api/billing/razorpay/order`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ package_id: plan.id }),
      })
      if (response.status === 401) {
        setMemoryProcessingPackageId(null)
        handleAuthFailure()
        return
      }
      if (!response.ok) throw new Error('Checkout could not be started. Please try again.')

      const order = await response.json() as RazorpayOrder
      const orderId = order.order_id || order.id
      const publicKey = order.key_id || RAZORPAY_KEY_ID
      if (!orderId || !publicKey || !Number.isFinite(order.amount) || order.amount <= 0 || !order.currency) {
        throw new Error('Checkout returned an invalid Razorpay order.')
      }

      await loadRazorpayCheckout()
      if (!window.Razorpay) throw new Error('Razorpay could not be loaded. Refresh and try again.')
      const checkout = new window.Razorpay({
        key: publicKey,
        order_id: orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'MemCode Memory',
        description: `${packageLabel} memory credits`,
        prefill: { name: user?.name, email: user?.email },
        notes: { package_id: plan.id, product: 'memory' },
        theme: { color: '#2f7dff' },
        handler: (payment) => void verifyMemoryPayment(payment, plan, packageLabel),
        modal: { ondismiss: () => setMemoryProcessingPackageId(null) },
      })
      checkout.on('payment.failed', () => {
        setMemoryProcessingPackageId(null)
        setMemoryCheckoutNotice({ tone: 'error', message: razorpayFailureMessage() })
      })
      checkout.open()
    } catch (nextError) {
      setMemoryProcessingPackageId(null)
      setMemoryCheckoutNotice({
        tone: 'error',
        message: userFacingErrorMessage(nextError, 'Unable to start checkout. Please try again.'),
      })
    }
  }, [handleAuthFailure, isDemo, token, user?.email, user?.name, verifyMemoryPayment])

  const redeemMemoryReferral = useCallback(async (code: string) => {
    if (!token && !isDemo) return
    if (isDemo && code.trim().toUpperCase() !== DEMO_MEMORY_REFERRAL_CODE) {
      setMemoryReceipt(null)
      setMemoryCheckoutNotice({ tone: 'error', message: 'That referral code could not be applied.' })
      return
    }
    setIsRedeemingMemoryReferral(true)
    setMemoryCheckoutNotice(null)
    if (isDemo && demoMemoryReferralRedeemedRef.current) {
      setMemoryCheckoutNotice({ tone: 'success', message: 'This referral code was already applied to your account.' })
      setIsRedeemingMemoryReferral(false)
      return
    }
    setMemoryReceipt({ stage: 'processing', packageLabel: 'Pro', invoice: null, source: 'referral' })
    try {
      if (isDemo) {
        await new Promise((resolve) => window.setTimeout(resolve, 450))
        const invoice: MemoryInvoice = {
          id: `demo-referral-${Date.now()}`,
          date: new Date().toISOString(),
          amount_minor_units: 0,
          amount_paise: 0,
          currency: 'USD',
          status: 'paid',
          credits: DEMO_MEMORY_REFERRAL_CREDITS,
          package_id: 'memory_referral',
        }
        setAccountBillingSummary((current) => {
          const previous = current ?? {
            plan_name: 'Free Trial',
            status: 'trialing',
            currency: 'USD',
          }
          const currentBalance = previous.available_credits ?? previous.credit_balance ?? 0
          return {
            ...previous,
            credit_balance: currentBalance + DEMO_MEMORY_REFERRAL_CREDITS,
            available_credits: currentBalance + DEMO_MEMORY_REFERRAL_CREDITS,
            invoices: [invoice, ...(previous.invoices || [])],
          }
        })
        demoMemoryReferralRedeemedRef.current = true
        printMemoryInvoice(
          'Pro',
          invoice,
          'referral',
          'Pro credits added. Your invoice has been saved below.',
        )
        return
      }

      const response = await fetch(`${API_URL}/api/billing/referrals/redeem`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })
      if (response.status === 401) {
        handleAuthFailure()
        return
      }
      if (!response.ok) throw new Error('That referral code could not be applied.')
      const payload = await response.json() as {
        summary?: BillingSummary
        credits_granted?: number
        already_redeemed?: boolean
      }
      if (!payload.summary) throw new Error('Referral activation returned no billing summary.')
      setAccountBillingSummary(payload.summary)
      if (payload.already_redeemed) {
        setMemoryReceipt(null)
        setMemoryCheckoutNotice({ tone: 'success', message: 'This referral code was already applied to your account.' })
        return
      }
      const invoice = payload.summary.invoices?.find((candidate) => candidate.package_id === 'memory_referral')
      if (!invoice) throw new Error('Referral activation returned no invoice.')
      printMemoryInvoice(
        'Pro',
        invoice,
        'referral',
        `Referral code applied${payload.credits_granted ? ` · ${payload.credits_granted.toLocaleString()} credits added` : ''}. Your invoice has been saved below.`,
      )
    } catch (nextError) {
      setMemoryReceipt(null)
      setMemoryCheckoutNotice({ tone: 'error', message: userFacingErrorMessage(nextError, 'The referral code could not be applied.') })
    } finally {
      setIsRedeemingMemoryReferral(false)
    }
  }, [handleAuthFailure, isDemo, printMemoryInvoice, token])

  const verifyRazorpayPayment = useCallback(async (
    payment: RazorpaySuccessResponse,
    plan: CompanyBrainPlan,
    organizationId: string,
  ) => {
    const packageId = plan.packageId
    try {
      const response = await fetch(`${BRAIN_API_URL}/api/billing/razorpay/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: organizationScopedHeaders({
          'Content-Type': 'application/json',
        }, organizationId),
        body: JSON.stringify({
          ...payment,
          package_id: packageId,
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          handleAuthFailure()
          return
        }
        const details = await readUserFacingApiError(response, {
          fallback: 'Payment verification failed. Please contact support if you were charged.',
          messages: BILLING_ERROR_MESSAGES,
        })
        throw new CompanyBrainBillingHttpError(details.message, response.status, details.code)
      }

      const refreshedDashboard = await fetchOrganizationDashboard(true, organizationId)
      setCheckoutNotice({
        tone: 'success',
        message: `${plan.name} is active. Your onboarding team will arrange the one-time $50 Codex credit after payment verification.`,
      })
      if (refreshedDashboard) showSection('usage')
    } catch (err) {
      setCheckoutNotice({
        tone: 'error',
        message: `Your payment needs verification: ${userFacingErrorMessage(
          err,
          'Please contact support if you were charged.',
        )}`,
      })
    } finally {
      setProcessingPackageId(null)
    }
  }, [fetchOrganizationDashboard, handleAuthFailure, showSection])

  const startCompanyBrainCheckout = useCallback(async (plan: CompanyBrainPlan) => {
    if (isOrganizationChanging) {
      setCheckoutNotice({ tone: 'error', message: 'Wait for the organization switch to finish before opening checkout.' })
      return
    }
    if (!effectiveOrganizationDashboard
      || effectiveOrganizationDashboard.organization.role === 'member'
      || !effectiveOrganizationDashboard.permissions.manage_billing) {
      setCheckoutNotice({
        tone: 'error',
        message: isDemo
          ? 'Checkout is disabled in the read-only demo.'
          : effectiveOrganizationDashboard
          ? 'Only an organization admin or owner can start Company Brain checkout.'
          : 'Organization billing permissions could not be verified, so checkout is disabled.',
      })
      return
    }

    const packageId = plan.packageId
    const organizationId = effectiveOrganizationDashboard.organization.id
    setProcessingPackageId(packageId)
    setCheckoutNotice(null)

    try {
      const response = await fetch(`${BRAIN_API_URL}/api/billing/razorpay/order`, {
        method: 'POST',
        credentials: 'include',
        headers: organizationScopedHeaders({
          'Content-Type': 'application/json',
        }, organizationId),
        body: JSON.stringify({ package_id: packageId }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          setProcessingPackageId(null)
          handleAuthFailure()
          return
        }
        const details = await readUserFacingApiError(response, {
          fallback: 'Checkout could not be started. Please try again.',
          messages: BILLING_ERROR_MESSAGES,
        })
        throw new CompanyBrainBillingHttpError(details.message, response.status, details.code)
      }

      const payload = await response.json() as RazorpayOrder & BrainOrderEnvelope
      const order = payload.order || payload
      const orderId = order.order_id || order.id
      const publicKey = order.key_id || RAZORPAY_KEY_ID

      if (!orderId) throw new Error('Checkout could not be started. Please try again.')
      if (!Number.isFinite(order.amount) || order.amount <= 0 || !order.currency) {
        throw new Error('Checkout could not be started. Please try again.')
      }
      if (!publicKey) throw new Error('Checkout is temporarily unavailable. Please try again later.')

      await loadRazorpayCheckout()
      if (!window.Razorpay) throw new Error('Checkout could not be loaded. Refresh the page and try again.')

      const checkout = new window.Razorpay({
        key: publicKey,
        order_id: orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'MemCode Company Brain',
        description: `${plan.name} · one month access`,
        prefill: {
          name: effectiveOrganizationDashboard.viewer.name || user?.name,
          email: effectiveOrganizationDashboard.viewer.email || user?.email,
        },
        notes: {
          package_id: packageId,
          product: 'company_brain',
          plan_id: plan.id,
          billing_cycle: 'monthly',
        },
        theme: { color: '#2f7dff' },
        handler: (payment) => {
          void verifyRazorpayPayment(payment, plan, organizationId)
        },
        modal: {
          ondismiss: () => setProcessingPackageId(null),
        },
      })

      checkout.on('payment.failed', () => {
        setProcessingPackageId(null)
        setCheckoutNotice({
          tone: 'error',
          message: razorpayFailureMessage(),
        })
      })
      checkout.open()
    } catch (err) {
      setProcessingPackageId(null)
      setCheckoutNotice({
        tone: 'error',
        message: userFacingErrorMessage(err, 'Unable to start checkout. Please try again.'),
      })
    }
  }, [effectiveOrganizationDashboard, handleAuthFailure, isDemo, isOrganizationChanging, user?.email, user?.name, verifyRazorpayPayment])

  const redeemCompanyBrainReferral = useCallback(async (referralCode: string) => {
    if (isOrganizationChanging) {
      setCheckoutNotice({ tone: 'error', message: 'Wait for the organization switch to finish before applying a code.' })
      return
    }
    if (!effectiveOrganizationDashboard
      || effectiveOrganizationDashboard.organization.role === 'member'
      || !effectiveOrganizationDashboard.permissions.manage_billing
      || isDemo) {
      setCheckoutNotice({
        tone: 'error',
        message: isDemo
          ? 'Referral activation is disabled in the read-only demo.'
          : 'Only an organization admin or owner can apply a Company Brain onboarding code.',
      })
      return
    }

    setIsRedeemingReferral(true)
    setCheckoutNotice(null)
    const organizationId = effectiveOrganizationDashboard.organization.id
    try {
      const response = await fetch(`${BRAIN_API_URL}/api/billing/referrals/redeem`, {
        method: 'POST',
        credentials: 'include',
        headers: organizationScopedHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        }, organizationId),
        body: JSON.stringify({ referral_code: referralCode }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          handleAuthFailure()
          return
        }
        const details = await readUserFacingApiError(response, {
          fallback: 'The onboarding code could not be applied. Check the code and try again.',
          messages: BILLING_ERROR_MESSAGES,
        })
        throw new CompanyBrainBillingHttpError(details.message, response.status, details.code)
      }

      const payload = await response.json() as { status?: string; billing?: unknown }
      if (payload.status !== 'ok' || !payload.billing) {
        throw new Error('The onboarding code response was invalid.')
      }

      await fetchOrganizationDashboard(true, organizationId)
      setCheckoutNotice({
        tone: 'success',
        message: 'Onboarding code applied. Company Brain is active for your organization.',
      })
      showSection('usage')
    } catch (err) {
      setCheckoutNotice({
        tone: 'error',
        message: userFacingErrorMessage(err, 'The onboarding code could not be applied.'),
      })
    } finally {
      setIsRedeemingReferral(false)
    }
  }, [effectiveOrganizationDashboard, fetchOrganizationDashboard, handleAuthFailure, isDemo, isOrganizationChanging, showSection])

  const planName = accountBillingSummary?.plan_name ?? null
  const creditBalance = getCreditBalance(accountBillingSummary)
  const accountStatus = getAccountStatus(accountBillingSummary)
  const companyBrainEnabled = isDemo || companyBrainSetupStatus === 'completed'
  const organizationRole = effectiveOrganizationDashboard?.organization.role
  const isOrganizationManager = organizationRole === 'admin' || organizationRole === 'owner'
  const canViewCompanyBrainUsage = companyBrainEnabled && canViewBrainUsage(effectiveOrganizationDashboard)
  const canManageBilling = effectiveOrganizationDashboard
    ? isOrganizationManager && effectiveOrganizationDashboard.permissions.manage_billing
    : null
  const canAdministerOrganization = Boolean(effectiveOrganizationDashboard
    && isOrganizationManager
    && effectiveOrganizationDashboard.permissions.manage_spaces)
  const currentSubscription = effectiveOrganizationDashboard?.subscription
  const currentCompanyBrainPlanId = currentSubscription
    && !['canceled', 'cancelled', 'completed'].includes(currentSubscription.status.toLowerCase())
    ? currentSubscription.plan_id.endsWith(`-${currentSubscription.billing_cycle}`)
      ? currentSubscription.plan_id
      : `${currentSubscription.plan_id}-${currentSubscription.billing_cycle}`
    : undefined
  const dashboardViewer = effectiveOrganizationDashboard?.viewer
  const mailboxReady = companyBrainEnabled && mailboxSummary?.status === 'ready' && Boolean(mailboxSummary.address)
  const companyBrainSection: CompanyBrainSection | null = activeSection === 'company'
    || activeSection === 'connectors'
    || activeSection === 'settings'
    || activeSection === 'code'
    || activeSection === 'pricing'
    ? activeSection
    : null
  const memoryProductSection: MemoryProductSection | null = activeSection === 'overview'
    || activeSection === 'memory-graph'
    || activeSection === 'memory-documents'
    || activeSection === 'api-keys'
    || activeSection === 'billing'
    ? activeSection
    : null
  const isMemoryUtilitySection = activeSection === 'memory-graph'
    || activeSection === 'memory-documents'
    || activeSection === 'api-keys'
    || activeSection === 'billing'
  const sidebarContextLabel = activeSection === 'connectors'
    ? 'Integrations'
    : activeSection === 'mcp'
      ? 'MCP'
    : activeSection === 'settings'
      ? 'Brain settings'
    : activeSection === 'code'
      ? 'Code Mode'
    : activeSection === 'pricing'
      ? 'Pricing'
    : activeSection === 'memory-graph'
      ? 'Memory graph'
    : activeSection === 'memory-documents'
      ? 'Memory documents'
    : activeSection === 'api-keys'
      ? 'API keys'
    : activeSection === 'billing'
      ? 'Billing'
    : activeSection === 'inbox'
      ? 'Inbox'
      : activeSection === 'company'
        ? 'Company Brain'
        : 'MemCode'
  const dashboardBackgroundStyle = {
    '--dashboard-frame': dashboardAppearance.color,
    '--dashboard-background-image': dashboardAppearance.image ? `url("${dashboardAppearance.image}")` : 'none',
    '--sidebar-icon-color': dashboardAppearance.sidebarIconColor,
    '--sidebar-active-color': dashboardAppearance.sidebarActiveColor,
  } as CSSProperties

  useEffect(() => {
    const capabilityResolved = isDemo
      || companyBrainSetupStatus !== null
      || organizationDashboardState === 'unavailable'
    if (!capabilityResolved || companyBrainEnabled) return
    if (
      activeSection === 'company'
      || activeSection === 'connectors'
      || activeSection === 'settings'
      || activeSection === 'code'
      || activeSection === 'pricing'
      || activeSection === 'inbox'
      || activeSection === 'usage'
      || activeSection === 'mcp'
    ) showSection('overview')
  }, [activeSection, companyBrainEnabled, companyBrainSetupStatus, isDemo, organizationDashboardState, showSection])

  return (
    <main
      className={`dashboard-shell dashboard-shell--brain ${companyBrainSection ? 'dashboard-shell--company-brain' : memoryProductSection ? 'dashboard-shell--memory-product' : 'dashboard-shell--memcode'}${dashboardAppearance.image ? ' has-background-image' : ''}`}
      style={dashboardBackgroundStyle}
    >
      <MemCodeSidebar
        activeSection={companyBrainSection ? 'company' : memoryProductSection ? 'overview' : activeSection}
        contextLabel={sidebarContextLabel}
        companyBrainEnabled={companyBrainEnabled}
        canViewUsage={canViewCompanyBrainUsage}
        showInbox={mailboxReady}
        inboxUnreadCount={mailboxSummary?.unreadCount ?? 0}
        inboxUnreadCountCapped={mailboxSummary?.unreadCountCapped ?? false}
        showOnboarding={canAdministerOrganization && (onboardingIncomplete || mailboxSummary?.status === 'skipped')}
        appearance={dashboardAppearance}
        onAppearanceChange={setDashboardAppearance}
        onOpenOnboarding={reopenOnboarding}
        onSectionChange={showSection}
      />
      <section ref={dashboardMainRef} className={`dashboard-main dashboard-main--brain${activeSection === 'connectors' || activeSection === 'mcp' ? ' dashboard-main--connectors' : ''}${activeSection === 'inbox' ? ' dashboard-main--inbox' : ''}`}>
        {companyBrainEnabled && !isMemoryUtilitySection ? <header className={`brain-dashboard-header${slackHistoryProgressVisible ? ' has-slack-history-progress' : ''}`}>
          <CompanyBrainOrganizationSwitcher
            activeOrganization={effectiveOrganizationDashboard?.organization ?? null}
            viewerName={dashboardViewer?.name || user?.name}
            demoMode={isDemo}
            disabled={processingPackageId !== null || isRedeemingReferral}
            disabledReason={processingPackageId !== null || isRedeemingReferral
              ? 'Finish the current billing action before changing organizations.'
              : undefined}
            onAuthenticationRequired={handleAuthFailure}
            onActionStateChange={setIsOrganizationChanging}
            onOrganizationChanged={handleCompanyBrainOrganizationChanged}
          />
          {!isDemo && organizationDashboard && canAdministerOrganization ? (
            <SlackHistoryProgress
              organizationId={organizationDashboard.organization.id}
              refreshToken={slackHistoryRefreshToken}
              onAuthenticationRequired={handleAuthFailure}
              onVisibilityChange={setSlackHistoryProgressVisible}
            />
          ) : null}
          <CompanyBrainCommandSearch
            activeSection={(memoryProductSection ? 'overview' : activeSection) as CompanyBrainCommandSection}
            showInbox={mailboxReady}
            onNavigate={showSection}
          />
        </header> : null}

        <div className="brain-dashboard-content">
          {billingWarning && canViewCompanyBrainUsage && !isMemoryUtilitySection ? (
            <div className="dashboard-alert" role="status">{billingWarning}</div>
          ) : null}

          {activeSection === 'overview' ? (
            <>
              {error ? <div className="dashboard-alert" role="alert">{error}</div> : null}
              {!isDemo && companyBrainEnabled && organizationDashboardWarning ? (
                <div className="dashboard-alert" role="status">{organizationDashboardWarning}</div>
              ) : null}
              <CompanyBrainOverview
                userName={dashboardViewer?.name || user?.name}
                dashboard={effectiveOrganizationDashboard}
                memoryCount={memoryCount}
                activeApiKeys={isDemo ? 3 : activeApiKeys}
                totalApiKeys={isDemo ? 4 : apiKeys.length}
                creditBalance={creditBalance}
                planName={planName}
                accountStatus={accountStatus}
                companyBrainEnabled={companyBrainEnabled}
                demoMode={isDemo}
                isRefreshing={isRefreshing}
                onRefresh={() => void refreshDashboard()}
                onOpenCompany={() => showSection('company')}
                onOpenAccount={() => showSection('account')}
                onOpenConnectors={() => showSection('connectors')}
                onStartCompanyBrainSetup={requestCompanyBrainSetup}
              />
            </>
          ) : activeSection === 'memory-graph' || activeSection === 'memory-documents' ? (
            <Suspense fallback={<div className="memory-workspace memory-workspace--state" role="status">Loading Memory…</div>}>
              <MemoryWorkspace
                mode={activeSection === 'memory-graph' ? 'graph' : 'documents'}
                token={token}
                demoMode={isDemo}
                onAuthenticationRequired={handleAuthFailure}
              />
            </Suspense>
          ) : activeSection === 'api-keys' ? (
            <Suspense fallback={<div className="memory-workspace memory-workspace--state" role="status">Loading API keys…</div>}>
              <MemoryApiKeysPanel
                keys={apiKeys}
                token={token}
                demoMode={isDemo}
                loading={isRefreshing}
                onAuthenticationRequired={handleAuthFailure}
                onReload={fetchApiKeys}
              />
            </Suspense>
          ) : activeSection === 'billing' ? (
            <Suspense fallback={<div className="memory-workspace memory-workspace--state" role="status">Loading billing…</div>}>
              <MemoryBillingPanel
                summary={accountBillingSummary}
                plans={memoryBillingPlans}
                warning={billingWarning}
                notice={memoryCheckoutNotice}
                processingPackageId={memoryProcessingPackageId}
                redeemingReferral={isRedeemingMemoryReferral}
                receipt={memoryReceipt}
                demoMode={isDemo}
                onCheckout={startMemoryCheckout}
                onRedeemReferral={redeemMemoryReferral}
                onDismissReceipt={() => setMemoryReceipt(null)}
              />
            </Suspense>
          ) : activeSection === 'inbox' && mailboxReady && mailboxSummary?.address && mailboxOrganizationId ? (
            <Suspense fallback={<div className="brain-panel brain-panel--state" role="status">Loading company inbox…</div>}>
              <CompanyBrainInbox
                key={mailboxOrganizationId}
                organizationId={mailboxOrganizationId}
                address={mailboxSummary.address}
                onAuthenticationRequired={handleAuthFailure}
                onUnreadCountChange={handleMailboxUnreadCountChange}
              />
            </Suspense>
          ) : activeSection === 'inbox' ? (
            <OrganizationAccessState
              title="Company inbox is not available for this organization."
              dashboard={effectiveOrganizationDashboard}
            />
          ) : activeSection === 'usage' && effectiveOrganizationDashboard && !canViewCompanyBrainUsage ? (
            <OrganizationAccessState
              title="Company Brain usage is available to admins and owners."
              dashboard={effectiveOrganizationDashboard}
            />
          ) : activeSection === 'usage' || activeSection === 'company' || activeSection === 'connectors' || activeSection === 'settings' || activeSection === 'code' || activeSection === 'mcp' ? (
            <Suspense fallback={<div className="brain-panel brain-panel--state" role="status">Loading organization view…</div>}>
              <CompanyBrainDashboard
                key={effectiveOrganizationDashboard?.organization.id || 'organization-loading'}
                dashboard={effectiveOrganizationDashboard}
                state={isDemo ? 'ready' : organizationDashboardState}
                warning={isDemo ? null : organizationDashboardWarning}
                view={activeSection as CompanyBrainDashboardView}
                demoMode={isDemo}
                onAuthenticationRequired={handleAuthFailure}
                onOpenPricing={() => showSection('pricing')}
              />
            </Suspense>
          ) : activeSection === 'account' ? (
            companyBrainEnabled ? (
              isDemo ? (
                <DemoAccountPanel dashboard={DEMO_BRAIN_DASHBOARD} onSignOut={signOut} />
              ) : (
                <Suspense fallback={<div className="brain-panel brain-panel--state" role="status">Loading Company Brain account settings…</div>}>
                  <CompanyBrainManagement
                    key={effectiveOrganizationDashboard?.organization.id || 'organization-loading'}
                    onAuthenticationRequired={handleAuthFailure}
                    onBillingChanged={handleCompanyBrainBillingChanged}
                    onOrganizationChanged={handleCompanyBrainOrganizationChanged}
                    onSignOut={signOut}
                  />
                </Suspense>
              )
            ) : (
              <MemoryAccountPanel
                user={user}
                billing={{
                  planName,
                  status: accountStatus,
                  creditsRemaining: creditBalance,
                  creditsUsed: accountBillingSummary?.current_month?.credits_used ?? null,
                  creditsLimit: accountBillingSummary?.current_month?.credits_limit ?? null,
                  periodEnd: accountBillingSummary?.current_period_end ?? null,
                }}
                memoryCount={memoryCount}
                activeApiKeys={activeApiKeys}
                totalApiKeys={apiKeys.length}
                warning={billingWarning}
                demoMode={false}
                onOpenApiKeys={() => showSection('api-keys')}
                onOpenBilling={() => showSection('billing')}
                onSignOut={signOut}
              />
            )
          ) : !isDemo && effectiveOrganizationDashboard && canManageBilling !== true ? (
            <OrganizationAccessState
              title="Company Brain billing is available to admins and owners."
              dashboard={effectiveOrganizationDashboard}
            />
          ) : !isDemo && organizationDashboardState === 'loading' && !effectiveOrganizationDashboard ? (
            <div className="brain-panel brain-panel--state" role="status">Loading organization access…</div>
          ) : !isDemo && canManageBilling !== true ? (
            <OrganizationAccessState
              title="Company Brain billing access could not be verified."
              dashboard={effectiveOrganizationDashboard}
            />
          ) : (
            <PricingPanel
              currentPlanId={currentCompanyBrainPlanId}
              processingPackageId={processingPackageId}
              isRedeemingReferral={isRedeemingReferral}
              notice={checkoutNotice}
              canManageBilling={isDemo ? false : canManageBilling}
              organizationChangePending={isOrganizationChanging}
              demoMode={isDemo}
              onCheckout={startCompanyBrainCheckout}
              onRedeemReferral={redeemCompanyBrainReferral}
            />
          )}
        </div>
      </section>
      {companyBrainSection ? (
        <CompanyBrainNavigationDock
          activeSection={companyBrainSection}
          onSectionChange={showSection}
        />
      ) : memoryProductSection ? (
        <MemoryNavigationDock
          activeSection={memoryProductSection}
          onSectionChange={showSection}
        />
      ) : null}
      {!isDemo && !companyBrainEnabled ? (
        <CompanyBrainOrganizationSwitcher
          activeOrganization={organizationDashboard?.organization ?? null}
          viewerName={organizationDashboard?.viewer.name || user?.name}
          demoMode={false}
          showControl={false}
          createOpen={companyBrainCreateOpen}
          disabled={isOrganizationChanging}
          onCreateOpenChange={setCompanyBrainCreateOpen}
          onAuthenticationRequired={handleAuthFailure}
          onActionStateChange={setIsOrganizationChanging}
          onOrganizationChanged={handleCompanyBrainOrganizationChanged}
          onOrganizationCreated={handleCompanyBrainOrganizationCreated}
        />
      ) : null}
      {!isDemo && organizationDashboard ? (
        <Suspense fallback={null}>
          <CompanyBrainOnboarding
            key={organizationDashboard.organization.id}
            organizationId={organizationDashboard.organization.id}
            initialDomain={organizationDashboard.organization.domain}
            initialOrganizationName={organizationDashboard.organization.name}
            reopenToken={onboardingReopenToken}
            openRequested={companyBrainOnboardingOpen}
            onAuthenticationRequired={handleAuthFailure}
            onCompleted={() => {
              setCompanyBrainOnboardingOpen(false)
              return fetchOrganizationDashboard(true)
            }}
            onIncompleteChange={setOnboardingIncomplete}
            onOpenChange={setCompanyBrainOnboardingOpen}
            onSetupStatusChange={setCompanyBrainSetupStatus}
            onOpenAccount={() => showSection('account')}
            onOpenConnectors={() => showSection('connectors')}
            onSlackHistoryStarted={refreshSlackHistoryProgress}
          />
        </Suspense>
      ) : null}
    </main>
  )
}
