import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AccountDetailNavigation,
  AccountSectionDeck,
  type AccountDetailOption,
  type AccountSectionOption,
} from './AccountSettingsNavigation'
import { BRAIN_API_URL } from '../lib/api'
import {
  organizationScopedHeaders,
  setActiveBrainOrganizationId,
} from '../lib/brain-organization-context'
import {
  CompanyOnboardingHttpError,
  fetchSlackHistoryChannels,
  type SlackHistoryChannel,
  type SlackHistoryChannels,
} from '../lib/brain-onboarding'
import {
  BILLING_ERROR_MESSAGES,
  ONBOARDING_ERROR_MESSAGES,
  ORGANIZATION_ERROR_MESSAGES,
  readUserFacingApiError,
  userFacingErrorMessage,
} from '../lib/user-facing-errors'

type OrganizationRole = 'member' | 'admin' | 'owner'

interface BrainOrganization {
  id: string
  name: string
  role: OrganizationRole
  is_default?: boolean
}

interface BrainIdentity {
  user: {
    id: string
    email: string
    name: string
  }
  organization: BrainOrganization
}

interface OrganizationMember {
  user_id: string
  email: string
  name: string
  picture?: string
  role: OrganizationRole
  joined_at: string
}

interface OrganizationInvitation {
  id: string
  email: string
  role: OrganizationRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
  expires_at: string
  accepted_at?: string
  revoked_at?: string
}

interface Notice {
  tone: 'success' | 'error'
  message: string
}

interface InvitationSecret {
  token: string
  email: string
}

type CompanyBrainPlanId =
  | 'company-brain-monthly'
  | 'company-brain-yearly'
  | 'company-brain-plus-monthly'
  | 'company-brain-plus-yearly'

interface ManagedBillingSummary {
  plan_id: CompanyBrainPlanId
  plan_name: string
  billing_cycle: 'monthly' | 'yearly'
  renewal_mode?: 'manual' | 'recurring'
  status: 'pending' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'completed'
  period_end: string
  currency: string
  total_charged_minor: number
  refunded_minor: number
  net_charged_minor: number
  cancel_at_period_end: boolean
  cancellation_requested_at?: string
  pending_plan_id?: CompanyBrainPlanId
  pending_plan_effective_at?: string
}

interface ManagedInvoice {
  id: string
  plan_id: CompanyBrainPlanId
  status: 'paid' | 'failed' | 'refund_pending' | 'partially_refunded' | 'refunded' | 'disputed'
  currency: string
  total_charged_minor: number
  refunded_minor: number
  refund_pending_minor: number
  net_charged_minor: number
  period_start: string
  period_end: string
  paid_at?: string
}

interface BillingActionPayload {
  billing: ManagedBillingSummary | null
  invoice?: ManagedInvoice
}

type CompanyBrainSettingsTab = 'general' | 'people' | 'proactivity' | 'billing'
type CompanyBrainSettingsDetail =
  | 'profile'
  | 'slack'
  | 'invitation'
  | 'invite'
  | 'members'
  | 'access'
  | 'participation'
  | 'channels'
  | 'limits'
  | 'overview'
  | 'plan'
  | 'refunds'

interface ProactivityPolicy {
  orgId: string
  enabled: boolean
  allowedChannelIds: string[]
  hourlyLimit: number
  normalMinimumIntervalMs: number
  lowMinimumIntervalMs: number
  updatedAt: string
  updatedByUserId: string
}

interface ProactivityDraft {
  enabled: boolean
  allowedChannelIds: string[]
  hourlyLimit: number
  normalMinimumIntervalMs: number
  lowMinimumIntervalMs: number
}

export interface CompanyBrainManagementProps {
  onAuthenticationRequired: () => void
  onBillingChanged: () => Promise<unknown>
  onOrganizationChanged: (organizationId?: string) => Promise<unknown>
  onSignOut: () => void
}

const MANAGER_ROLES = new Set<OrganizationRole>(['admin', 'owner'])
const SETTINGS_TABS: ReadonlyArray<AccountSectionOption<CompanyBrainSettingsTab>> = [
  { id: 'general', label: 'General', description: 'Workspace identity and connected accounts', icon: 'general' },
  { id: 'people', label: 'People', description: 'Members, roles and invitations', icon: 'people' },
  { id: 'proactivity', label: 'Participation', description: 'Participation rules and limits', icon: 'proactivity' },
  { id: 'billing', label: 'Billing', description: 'Plan, invoices and subscription controls', icon: 'billing' },
]
const SETTINGS_DETAILS: Readonly<Record<CompanyBrainSettingsTab, ReadonlyArray<AccountDetailOption<CompanyBrainSettingsDetail>>>> = {
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
const DEFAULT_SETTINGS_DETAILS: Record<CompanyBrainSettingsTab, CompanyBrainSettingsDetail | null> = {
  general: null,
  people: null,
  proactivity: null,
  billing: null,
}
const DEFAULT_PROACTIVITY_POLICY: ProactivityDraft = {
  enabled: false,
  allowedChannelIds: [],
  hourlyLimit: 6,
  normalMinimumIntervalMs: 3 * 60_000,
  lowMinimumIntervalMs: 15 * 60_000,
}
const COMPANY_BRAIN_PLANS: Array<{ id: CompanyBrainPlanId; name: string }> = [
  { id: 'company-brain-monthly', name: 'Company Brain monthly' },
  { id: 'company-brain-yearly', name: 'Company Brain yearly' },
  { id: 'company-brain-plus-monthly', name: 'Company Brain Plus monthly' },
  { id: 'company-brain-plus-yearly', name: 'Company Brain Plus yearly' },
]
const MANAGEMENT_ERROR_MESSAGES = {
  ...BILLING_ERROR_MESSAGES,
  ...ONBOARDING_ERROR_MESSAGES,
  ...ORGANIZATION_ERROR_MESSAGES,
  proactivity_channels_required: 'Select at least one public Slack channel before enabling participation.',
  slack_channels_unavailable: 'Public Slack channels are temporarily unavailable. Refresh and try again.',
  organization_context_changed: 'The active organization changed. Refresh settings before trying again.',
}

class BrainHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainHttpError'
  }
}

export default function CompanyBrainManagement({
  onAuthenticationRequired,
  onBillingChanged,
  onOrganizationChanged,
  onSignOut,
}: CompanyBrainManagementProps) {
  const [identity, setIdentity] = useState<BrainIdentity | null>(null)
  const [organizations, setOrganizations] = useState<BrainOrganization[]>([])
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([])
  const [billing, setBilling] = useState<ManagedBillingSummary | null>(null)
  const [billingInvoices, setBillingInvoices] = useState<ManagedInvoice[]>([])
  const [activeTab, setActiveTab] = useState<CompanyBrainSettingsTab | null>(null)
  const [activeDetails, setActiveDetails] = useState<Record<CompanyBrainSettingsTab, CompanyBrainSettingsDetail | null>>(DEFAULT_SETTINGS_DETAILS)
  const [detailDirection, setDetailDirection] = useState<1 | -1>(1)
  const [proactivityPolicy, setProactivityPolicy] = useState<ProactivityPolicy | null>(null)
  const [proactivityDraft, setProactivityDraft] = useState<ProactivityDraft>(DEFAULT_PROACTIVITY_POLICY)
  const [proactivityError, setProactivityError] = useState<string | null>(null)
  const [proactivityChannels, setProactivityChannels] = useState<SlackHistoryChannels | null>(null)
  const [proactivityChannelsLoadState, setProactivityChannelsLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [proactivityChannelsError, setProactivityChannelsError] = useState<string | null>(null)
  const [proactivityChannelSearch, setProactivityChannelSearch] = useState('')
  const [channelInputError, setChannelInputError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [invitationSecret, setInvitationSecret] = useState<InvitationSecret | null>(null)
  const [linkToken, setLinkToken] = useState<{ token: string; expiresAt: string } | null>(null)
  const operationKeys = useRef(new Map<string, string>())
  const organizationId = useRef<string | null>(null)
  const proactivityChannelsRequest = useRef<AbortController | null>(null)
  const isManager = Boolean(identity && MANAGER_ROLES.has(identity.organization.role))
  const isOwner = identity?.organization.role === 'owner'
  const availableSettingsTabs = SETTINGS_TABS

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const isOrganizationDiscovery = path === '/api/auth/me' || path === '/api/organizations'
    const headers = isOrganizationDiscovery
      ? new Headers(init?.headers)
      : organizationScopedHeaders(init?.headers)
    if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${BRAIN_API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    })
    if (response.status === 401) {
      onAuthenticationRequired()
      throw new Error('Your Company Brain session expired. Please sign in again.')
    }
    if (!response.ok) {
      const details = await responseError(response, 'The Company Brain request failed.')
      throw new BrainHttpError(
        details.message,
        response.status,
        details.code,
      )
    }
    return response.json() as Promise<T>
  }, [onAuthenticationRequired])

  const billingRequest = useCallback(async <T,>(
    signature: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    let idempotencyKey = operationKeys.current.get(signature)
    if (!idempotencyKey) {
      idempotencyKey = operationKey(signature)
      operationKeys.current.set(signature, idempotencyKey)
    }
    try {
      const payload = await request<T>(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      })
      operationKeys.current.delete(signature)
      return payload
    } catch (error) {
      // A network failure is ambiguous, so a retry reuses the same key. A
      // concrete HTTP response is definitive and permits a fresh operation.
      if (error instanceof BrainHttpError && !isAmbiguousBillingFailure(error)) {
        operationKeys.current.delete(signature)
      }
      throw error
    }
  }, [request])

  const clearAdministrativeState = useCallback(() => {
    setMembers([])
    setInvitations([])
    setBilling(null)
    setBillingInvoices([])
    setInvitationSecret(null)
    setLinkToken(null)
    operationKeys.current.clear()
  }, [])

  const clearOrganizationState = useCallback(() => {
    proactivityChannelsRequest.current?.abort()
    proactivityChannelsRequest.current = null
    clearAdministrativeState()
    setProactivityPolicy(null)
    setProactivityDraft(DEFAULT_PROACTIVITY_POLICY)
    setProactivityError(null)
    setProactivityChannels(null)
    setProactivityChannelsLoadState('idle')
    setProactivityChannelsError(null)
    setProactivityChannelSearch('')
    setChannelInputError(null)
  }, [clearAdministrativeState])

  const refreshWorkspace = useCallback(async (signal?: AbortSignal) => {
    const [nextIdentity, organizationPayload] = await Promise.all([
      request<BrainIdentity>('/api/auth/me', { signal }),
      request<{
        current_organization_id: string
        organizations: BrainOrganization[]
      }>('/api/organizations', { signal }),
    ])
    if (organizationId.current !== nextIdentity.organization.id) {
      organizationId.current = nextIdentity.organization.id
      clearOrganizationState()
    }
    setIdentity(nextIdentity)
    setOrganizations(organizationPayload.organizations)
    setActiveBrainOrganizationId(nextIdentity.organization.id)
    if (!MANAGER_ROLES.has(nextIdentity.organization.role)) {
      clearOrganizationState()
      return
    }
    const [proactivityResult, memberPayload, invitationPayload, billingPayload, invoicePayload] = await Promise.all([
      request<{ policy: ProactivityPolicy | null }>('/settings/proactivity', { signal })
        .then((payload) => ({ payload, error: null as unknown }))
        .catch((error: unknown) => ({ payload: null, error })),
      request<{ members: OrganizationMember[] }>('/api/settings/members', { signal }),
      request<{ invitations: OrganizationInvitation[] }>('/api/settings/invitations', { signal }),
      request<{ billing: ManagedBillingSummary | null }>('/api/billing/summary', { signal }),
      request<{ invoices: ManagedInvoice[] }>('/api/billing/invoices', { signal }),
    ])
    if (proactivityResult.payload) {
      const nextPolicy = proactivityResult.payload.policy
      setProactivityPolicy(nextPolicy)
      setProactivityDraft(nextPolicy ? policyDraft(nextPolicy) : DEFAULT_PROACTIVITY_POLICY)
      setProactivityError(null)
    } else {
      setProactivityPolicy(null)
      setProactivityDraft(DEFAULT_PROACTIVITY_POLICY)
      setProactivityError(
        userFacingErrorMessage(
          proactivityResult.error,
          'Participation settings are temporarily unavailable.',
        ),
      )
    }
    setMembers(memberPayload.members)
    setInvitations(invitationPayload.invitations)
    setBilling(billingPayload.billing)
    setBillingInvoices(invoicePayload.invoices)
  }, [clearAdministrativeState, clearOrganizationState, request])

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    refreshWorkspace(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setNotice({
          tone: 'error',
          message: userFacingErrorMessage(error, 'Company Brain settings are unavailable.'),
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [refreshWorkspace])

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<string>,
  ) => {
    setBusyAction(key)
    setNotice(null)
    try {
      const message = await action()
      setNotice({ tone: 'success', message })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: userFacingErrorMessage(error, 'The Company Brain request failed.'),
      })
    } finally {
      setBusyAction(null)
    }
  }, [])

  const createInvitation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') || '').trim()
    const role = String(form.get('role') || 'member') as OrganizationRole
    void runAction('create-invitation', async () => {
      const payload = await request<{
        invitation: OrganizationInvitation
        token: string
      }>('/api/settings/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      })
      setInvitationSecret({ token: payload.token, email: payload.invitation.email })
      setInvitations((current) => [
        payload.invitation,
        ...current.filter((invitation) => invitation.id !== payload.invitation.id),
      ])
      return `Invitation created for ${payload.invitation.email}. Copy its secret now.`
    })
  }, [request, runAction])

  const updateRole = useCallback((member: OrganizationMember, role: OrganizationRole) => {
    void runAction(`role-${member.user_id}`, async () => {
      const payload = await request<{ member: OrganizationMember }>(
        `/api/settings/members/${encodeURIComponent(member.user_id)}`,
        { method: 'PATCH', body: JSON.stringify({ role }) },
      )
      setMembers((current) => current.map((entry) => (
        entry.user_id === payload.member.user_id ? payload.member : entry
      )))
      return `${payload.member.name} is now ${roleLabel(payload.member.role)}.`
    })
  }, [request, runAction])

  const removeMember = useCallback((member: OrganizationMember) => {
    void runAction(`remove-${member.user_id}`, async () => {
      await request<{ removed: true }>(
        `/api/settings/members/${encodeURIComponent(member.user_id)}`,
        { method: 'DELETE' },
      )
      setMembers((current) => current.filter((entry) => entry.user_id !== member.user_id))
      return `${member.name} was removed from this organization.`
    })
  }, [request, runAction])

  const revokeInvitation = useCallback((invitation: OrganizationInvitation) => {
    void runAction(`revoke-${invitation.id}`, async () => {
      const payload = await request<{ invitation: OrganizationInvitation }>(
        `/api/settings/invitations/${encodeURIComponent(invitation.id)}`,
        { method: 'DELETE' },
      )
      setInvitations((current) => current.map((entry) => (
        entry.id === payload.invitation.id ? payload.invitation : entry
      )))
      return `Invitation for ${payload.invitation.email} was revoked.`
    })
  }, [request, runAction])

  const acceptInvitation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const token = String(form.get('token') || '').trim()
    void runAction('accept-invitation', async () => {
      const payload = await request<{ organization: BrainOrganization }>(
        '/api/settings/invitations/accept',
        { method: 'POST', body: JSON.stringify({ token }) },
      )
      clearOrganizationState()
      setIdentity(null)
      setOrganizations([])
      organizationId.current = null
      await refreshWorkspace()
      await onOrganizationChanged(payload.organization.id).catch(() => undefined)
      return `You joined ${payload.organization.name}.`
    })
  }, [clearOrganizationState, onOrganizationChanged, refreshWorkspace, request, runAction])

  const createSlackLink = useCallback(() => {
    void runAction('slack-link', async () => {
      const payload = await request<{ linkToken: string; expiresAt: string }>(
        '/api/slack/member-link/challenge',
        { method: 'POST' },
      )
      setLinkToken({ token: payload.linkToken, expiresAt: payload.expiresAt })
      return 'A single-use Slack link token was created. It is not saved in this browser.'
    })
  }, [request, runAction])

  const loadProactivityChannels = useCallback(async (force = false) => {
    if (!isManager || (!force && proactivityChannels?.status === 'ready')) return
    proactivityChannelsRequest.current?.abort()
    const controller = new AbortController()
    proactivityChannelsRequest.current = controller
    setProactivityChannelsLoadState('loading')
    setProactivityChannelsError(null)
    try {
      const next = await fetchSlackHistoryChannels(controller.signal)
      if (controller.signal.aborted) return
      setProactivityChannels(next)
      setProactivityChannelsLoadState('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof CompanyOnboardingHttpError && error.status === 401) {
        onAuthenticationRequired()
        return
      }
      setProactivityChannelsLoadState('error')
      setProactivityChannelsError(
        userFacingErrorMessage(error, 'Slack channels are temporarily unavailable.'),
      )
    } finally {
      if (proactivityChannelsRequest.current === controller) {
        proactivityChannelsRequest.current = null
      }
    }
  }, [isManager, onAuthenticationRequired, proactivityChannels])

  const selectSettingsTab = useCallback((tab: CompanyBrainSettingsTab | null) => {
    setActiveTab(tab)
    if (tab) setActiveDetails((current) => ({ ...current, [tab]: null }))
  }, [])

  const selectSettingsDetail = useCallback((detail: CompanyBrainSettingsDetail | null) => {
    if (!activeTab) return
    const options = SETTINGS_DETAILS[activeTab]
    const currentIndex = options.findIndex((option) => option.id === activeDetails[activeTab])
    const nextIndex = options.findIndex((option) => option.id === detail)
    if (detail) setDetailDirection(nextIndex >= currentIndex ? 1 : -1)
    setActiveDetails((current) => (
      current[activeTab] === detail ? current : { ...current, [activeTab]: detail }
    ))
    if (activeTab === 'proactivity' && detail === 'channels') {
      void loadProactivityChannels()
    }
  }, [activeDetails, activeTab, loadProactivityChannels])

  const toggleProactivityChannel = useCallback((channelId: string) => {
    setProactivityDraft((current) => ({
      ...current,
      allowedChannelIds: current.allowedChannelIds.includes(channelId)
        ? current.allowedChannelIds.filter((candidate) => candidate !== channelId)
        : [...current.allowedChannelIds, channelId].sort(),
    }))
    setChannelInputError(null)
  }, [])

  const selectAllProactivityChannels = useCallback((channels: SlackHistoryChannel[]) => {
    setProactivityDraft((current) => ({
      ...current,
      allowedChannelIds: [...new Set([
        ...current.allowedChannelIds,
        ...channels.map((channel) => channel.id),
      ])].sort(),
    }))
    setChannelInputError(null)
  }, [])

  const clearProactivityChannels = useCallback(() => {
    setProactivityDraft((current) => ({ ...current, allowedChannelIds: [] }))
    setChannelInputError(null)
  }, [])

  const removeProactivityChannel = useCallback((channelId: string) => {
    setProactivityDraft((current) => ({
      ...current,
      allowedChannelIds: current.allowedChannelIds.filter((candidate) => candidate !== channelId),
    }))
    setChannelInputError(null)
  }, [])

  const saveProactivity = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!identity || !MANAGER_ROLES.has(identity.organization.role)) return
    if (proactivityDraft.enabled && proactivityDraft.allowedChannelIds.length === 0) {
      setChannelInputError('Select at least one public Slack channel before enabling participation.')
      return
    }
    if (proactivityDraft.lowMinimumIntervalMs < proactivityDraft.normalMinimumIntervalMs) {
      setNotice({
        tone: 'error',
        message: 'The low-priority cooldown must be at least as long as the normal cooldown.',
      })
      return
    }
    void runAction('save-proactivity', async () => {
      const payload = await request<{ policy: ProactivityPolicy }>('/settings/proactivity', {
        method: 'PUT',
        body: JSON.stringify(proactivityDraft),
      })
      setProactivityPolicy(payload.policy)
      setProactivityDraft(policyDraft(payload.policy))
      setProactivityError(null)
      setChannelInputError(null)
      return payload.policy.enabled
        ? 'Participation is enabled for the selected public channels.'
        : 'Participation is off for this organization.'
    })
  }, [identity, proactivityDraft, request, runAction])

  const refreshBilling = useCallback(async () => {
    const [billingPayload, invoicePayload] = await Promise.all([
      request<{ billing: ManagedBillingSummary | null }>('/api/billing/summary'),
      request<{ invoices: ManagedInvoice[] }>('/api/billing/invoices'),
    ])
    setBilling(billingPayload.billing)
    setBillingInvoices(invoicePayload.invoices)
  }, [request])

  const afterBillingAction = useCallback(async () => {
    await Promise.allSettled([refreshBilling(), onBillingChanged()])
  }, [onBillingChanged, refreshBilling])

  const changePlan = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const packageId = String(form.get('package_id') || '') as CompanyBrainPlanId
    const mode = String(form.get('mode') || '')
    void runAction('change-plan', async () => {
      const payload = await billingRequest<BillingActionPayload>(
        `change-plan:${packageId}:${mode}`,
        '/api/billing/subscription/change-plan',
        { package_id: packageId, mode },
      )
      setBilling(payload.billing)
      await afterBillingAction()
      return mode === 'cycle_end'
        ? 'The plan change is scheduled for the end of this billing cycle.'
        : 'The Company Brain plan was changed immediately.'
    })
  }, [afterBillingAction, billingRequest, runAction])

  const cancelSubscription = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const mode = String(form.get('mode') || '')
    void runAction('cancel-subscription', async () => {
      const payload = await billingRequest<BillingActionPayload>(
        `cancel:${mode}`,
        '/api/billing/subscription/cancel',
        { mode },
      )
      setBilling(payload.billing)
      await afterBillingAction()
      return mode === 'cycle_end'
        ? 'Cancellation is scheduled for the end of this billing cycle.'
        : 'The Company Brain subscription was cancelled immediately.'
    })
  }, [afterBillingAction, billingRequest, runAction])

  const refundInvoice = useCallback((event: FormEvent<HTMLFormElement>, invoice: ManagedInvoice) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const rawAmount = String(form.get('amount') || '').trim()
    const amountMinor = rawAmount ? Math.round(Number(rawAmount) * 100) : undefined
    void runAction(`refund-${invoice.id}`, async () => {
      if (amountMinor !== undefined && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) {
        throw new Error('Enter a valid refund amount.')
      }
      const payload = await billingRequest<BillingActionPayload>(
        `refund:${invoice.id}:${amountMinor ?? 'remaining'}`,
        `/api/billing/invoices/${encodeURIComponent(invoice.id)}/refunds`,
        amountMinor === undefined ? {} : { amount_minor: amountMinor },
      )
      setBilling(payload.billing)
      if (payload.invoice) {
        setBillingInvoices((current) => current.map((entry) => (
          entry.id === payload.invoice?.id ? payload.invoice : entry
        )))
      }
      await afterBillingAction()
      return `Refund requested for invoice ${invoice.id}. Provider webhooks will reconcile its final status.`
    })
  }, [afterBillingAction, billingRequest, runAction])

  const subscriptionIsTerminal = billing?.status === 'cancelled' || billing?.status === 'completed'
  const isManualRenewal = billing?.renewal_mode === 'manual'
  const activeDetail = activeTab ? activeDetails[activeTab] : null
  const detailOptions = activeTab ? SETTINGS_DETAILS[activeTab] : []
  const visibleProactivityChannels = useMemo(() => {
    const query = proactivityChannelSearch.trim().toLowerCase()
    if (!query) return proactivityChannels?.channels ?? []
    return (proactivityChannels?.channels ?? []).filter((channel) => (
      channel.name.toLowerCase().includes(query)
      || channel.topic?.toLowerCase().includes(query)
      || channel.purpose?.toLowerCase().includes(query)
    ))
  }, [proactivityChannelSearch, proactivityChannels])
  const unavailableProactivityChannelIds = useMemo(() => {
    const discovered = new Set((proactivityChannels?.channels ?? []).map((channel) => channel.id))
    return proactivityDraft.allowedChannelIds.filter((channelId) => !discovered.has(channelId))
  }, [proactivityChannels, proactivityDraft.allowedChannelIds])

  return (
    <section className={`company-brain-management company-brain-settings ${activeTab ? 'has-active-section' : 'is-section-picker'}`} aria-labelledby="company-brain-management-title">
      <header className="company-brain-management__intro">
        <h2 id="company-brain-management-title">Account</h2>
      </header>

      {notice ? (
        <div className={`dashboard-checkout-notice dashboard-checkout-notice--${notice.tone}`} role="status">
          {notice.message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="company-brain-management__loading" role="status">Loading Company Brain settings…</div>
      ) : (
        <div className={`company-brain-settings__layout ${activeTab ? 'has-selection' : 'is-picker'}`}>
          <AccountSectionDeck
            sections={availableSettingsTabs}
            activeSection={activeTab}
            onSectionChange={selectSettingsTab}
            panelId={activeTab ? `company-brain-settings-panel-${activeTab}` : undefined}
          />

          {activeTab ? (
          <div className="company-brain-settings__workspace">
            <div
              id={`company-brain-settings-panel-${activeTab}`}
              className="company-brain-settings__panel company-brain-settings__readout"
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`account-section-${activeTab}`}
            >
              {activeTab === 'general' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide company-brain-account-card" aria-labelledby="workspace-account-overview-title">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Workspace account</span><h3 id="workspace-account-overview-title">{identity?.organization.name || 'Company Brain'}</h3></div>
                    <span className="company-brain-account-card__role">{identity ? roleLabel(identity.organization.role) : 'Member'}</span>
                  </div>
                  <p>Your verified identity and organization access live here. Use the dock only to link Slack approvals or accept another organization invitation.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Signed in as</span><strong>{identity?.user.name || 'Unavailable'}</strong><small>{identity?.user.email || 'No verified email returned'}</small></div>
                    <div><span>Organization access</span><strong>{identity ? roleLabel(identity.organization.role) : 'Unavailable'}</strong><small>{isManager ? 'Can manage organization settings' : 'Managed by an organization administrator'}</small></div>
                    <div><span>Organizations</span><strong>{organizations.length}</strong><small>{organizations.length > 1 ? 'Switch from the selector above' : 'One active organization'}</small></div>
                  </div>
                  <div className="company-brain-account-card__actions">
                    <div><strong>Account session</strong><small>Sign out of MemCode on this browser.</small></div>
                    <button type="button" onClick={onSignOut}>Sign out</button>
                  </div>
                </section>
              ) : null}

              {activeTab === 'people' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="people-overview-title">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Organization access</span><h3 id="people-overview-title">People and permissions</h3></div>
                    <span className="company-brain-account-card__role">{isManager ? 'Manage' : 'View only'}</span>
                  </div>
                  <p>Members, roles and pending invitations stay visible here. Use the dock only when you need to send a new invitation.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Members</span><strong>{members.length}</strong><small>Active organization access</small></div>
                    <div><span>Owners and admins</span><strong>{members.filter((member) => MANAGER_ROLES.has(member.role)).length}</strong><small>Can manage settings</small></div>
                    <div><span>Pending invites</span><strong>{invitations.filter((invitation) => invitation.status === 'pending').length}</strong><small>Awaiting acceptance</small></div>
                  </div>
                  <div className="company-brain-settings__readout-groups">
                    <section aria-labelledby="people-members-readout-title">
                      <header><strong id="people-members-readout-title">Members</strong><small>{members.length} total</small></header>
                      <div className="company-brain-member-list">
                        {members.length ? members.map((member) => (
                          <article key={member.user_id} className="company-brain-member">
                            <div className="company-brain-member__person">
                              {member.picture ? <img src={member.picture} alt="" /> : <span>{member.name.charAt(0)}</span>}
                              <div><strong>{member.name}</strong><small>{member.email}</small></div>
                            </div>
                            <span className="company-brain-member__role">{roleLabel(member.role)}</span>
                          </article>
                        )) : <p className="company-brain-setting-card__empty">Member details are unavailable.</p>}
                      </div>
                    </section>
                    <section aria-labelledby="pending-invitations-readout-title">
                      <header><strong id="pending-invitations-readout-title">Pending invitations</strong><small>{invitations.filter((invitation) => invitation.status === 'pending').length} pending</small></header>
                      <div className="company-brain-invitation-list">
                        {invitations.some((invitation) => invitation.status === 'pending') ? invitations.filter((invitation) => invitation.status === 'pending').map((invitation) => (
                          <article key={invitation.id} className="company-brain-invitation">
                            <div><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · expires {formatDateTime(invitation.expires_at)}</small></div>
                            <span className="company-brain-invitation__status company-brain-invitation__status--pending">pending</span>
                          </article>
                        )) : <p className="company-brain-setting-card__empty">No pending invitations.</p>}
                      </div>
                    </section>
                  </div>
                </section>
              ) : null}

              {activeTab === 'proactivity' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="proactivity-overview-title">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Participation policy</span><h3 id="proactivity-overview-title">Proactive replies</h3></div>
                    <span className={`company-brain-proactivity__status ${proactivityPolicy?.enabled ? 'is-on' : ''}`}>{proactivityError ? 'Unavailable' : proactivityPolicy?.enabled ? 'On' : 'Off'}</span>
                  </div>
                  <p>Company Brain participates only inside the public Slack channels you explicitly allow. Use the dock below to configure participation, channels and reply limits.</p>
                  <div className="company-brain-account-card__details">
                    <div><span>Participation</span><strong>{proactivityPolicy?.enabled ? 'Enabled' : 'Off'}</strong><small>Untagged public messages</small></div>
                    <div><span>Allowed channels</span><strong>{proactivityDraft.allowedChannelIds.length}</strong><small>Selected public channels</small></div>
                    <div><span>Hourly maximum</span><strong>{proactivityDraft.hourlyLimit}</strong><small>Replies per channel</small></div>
                  </div>
                </section>
              ) : null}

              {activeTab === 'billing' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="billing-overview-title">
                  <div className="company-brain-setting-card__heading">
                    <div><span>Subscription</span><h3 id="billing-overview-title">{billing?.plan_name || 'No active plan'}</h3></div>
                    <span className="company-brain-account-card__role">{billing ? statusLabel(billing.status) : 'Inactive'}</span>
                  </div>
                  <p>The current plan, charges and renewal state stay visible here. Use the dock only to change the plan or request a refund.</p>
                  {billing ? (
                    <div className="company-brain-account-card__details">
                      <div><span>Plan</span><strong>{billing.plan_name}</strong><small>{billing.billing_cycle} billing</small></div>
                      <div><span>Net charged</span><strong>{formatMoney(billing.net_charged_minor, billing.currency)}</strong><small>{formatMoney(billing.refunded_minor, billing.currency)} refunded</small></div>
                      <div><span>{isManualRenewal ? 'Paid through' : 'Cycle ends'}</span><strong>{formatShortDate(billing.period_end)}</strong><small>{isManualRenewal ? 'Manual renewal' : 'Provider managed'}</small></div>
                    </div>
                  ) : <p className="company-brain-setting-card__empty">Choose a plan from Pricing to activate Company Brain.</p>}
                  {billing && !isManualRenewal && billing.pending_plan_id ? (
                    <div className="company-brain-lifecycle-notice" role="status">Plan change to {planLabel(billing.pending_plan_id)} is scheduled for {formatShortDate(billing.pending_plan_effective_at)}.</div>
                  ) : null}
                  {billing && !isManualRenewal && billing.cancel_at_period_end ? (
                    <div className="company-brain-lifecycle-notice" role="status">Cancellation is scheduled for {formatShortDate(billing.period_end)}.</div>
                  ) : null}
                </section>
              ) : null}
            </div>

            <AccountDetailNavigation
              items={detailOptions}
              activeItem={activeDetail}
              onItemChange={selectSettingsDetail}
              label={`${SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label || 'Account'} configuration`}
              panelId={activeDetail ? `company-brain-settings-detail-${activeDetail}` : undefined}
            >
            {activeDetail ? (
              <div
                key={`${activeTab}-${activeDetail}`}
                id={`company-brain-settings-detail-${activeDetail}`}
                className="company-brain-settings__detail"
                data-direction={detailDirection}
                role="tabpanel"
                aria-labelledby={`account-detail-${activeDetail}`}
              >
            {activeTab === 'general' ? (
              <div className="company-brain-management__grid">
                {activeDetail === 'profile' ? (
                <section className="company-brain-setting-card company-brain-setting-card--wide company-brain-account-card" aria-labelledby="workspace-account-title">
                  <div className="company-brain-setting-card__heading">
                    <div>
                      <span>Workspace account</span>
                      <h3 id="workspace-account-title">{identity?.organization.name || 'Company Brain'}</h3>
                    </div>
                    <span className="company-brain-account-card__role">{identity ? roleLabel(identity.organization.role) : 'Member'}</span>
                  </div>
                  <div className="company-brain-account-card__details">
                    <div><span>Signed in as</span><strong>{identity?.user.name || 'Unavailable'}</strong><small>{identity?.user.email || 'No verified email returned'}</small></div>
                    <div><span>Organization access</span><strong>{identity ? roleLabel(identity.organization.role) : 'Unavailable'}</strong><small>{isManager ? 'Can manage organization settings' : 'Managed by an organization administrator'}</small></div>
                    <div><span>Organizations</span><strong>{organizations.length}</strong><small>{organizations.length > 1 ? 'Switch from the selector above' : 'One active organization'}</small></div>
                  </div>
                  <div className="company-brain-account-card__actions">
                    <div>
                      <strong>Account session</strong>
                      <small>Sign out of MemCode on this browser.</small>
                    </div>
                    <button type="button" onClick={onSignOut}>Sign out</button>
                  </div>
                </section>
                ) : null}

                {activeDetail === 'slack' ? (
                <section className="company-brain-setting-card" aria-labelledby="slack-identity-title">
                  <div className="company-brain-setting-card__heading">
                    <div>
                      <span>Your Slack identity</span>
                      <h3 id="slack-identity-title">Link approvals to you</h3>
                    </div>
                  </div>
                  <p>Create a short-lived, single-use token, then submit it with your workspace’s configured MemCode link command in Slack.</p>
                  {linkToken ? (
                    <SecretPanel
                      label="Slack link token"
                      value={linkToken.token}
                      detail={`Expires ${formatDateTime(linkToken.expiresAt)}. This token is shown only in this page state.`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="company-brain-setting-card__primary"
                    disabled={busyAction !== null}
                    onClick={createSlackLink}
                  >
                    {busyAction === 'slack-link' ? 'Creating token…' : 'Create Slack link token'}
                  </button>
                </section>
                ) : null}

                {activeDetail === 'invitation' ? (
                <section className="company-brain-setting-card" aria-labelledby="accept-invitation-title">
                  <div className="company-brain-setting-card__heading">
                    <div>
                      <span>Join another organization</span>
                      <h3 id="accept-invitation-title">Accept an invitation</h3>
                    </div>
                  </div>
                  <p>The invitation must match your verified Google email. Accepting it rotates your Company Brain session.</p>
                  <form className="company-brain-setting-form" onSubmit={acceptInvitation}>
                    <label>
                      Invitation secret
                      <input name="token" type="text" autoComplete="off" required placeholder="memcode_invite_…" />
                    </label>
                    <button type="submit" disabled={busyAction !== null}>
                      {busyAction === 'accept-invitation' ? 'Accepting…' : 'Accept invitation'}
                    </button>
                  </form>
                </section>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'people' ? (
              isManager ? (
                <div className="company-brain-management__grid">
                  {activeDetail === 'invite' ? (
                  <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="invite-member-title">
                    <div className="company-brain-setting-card__heading">
                      <div>
                        <span>Organization access</span>
                        <h3 id="invite-member-title">Invite a verified member</h3>
                      </div>
                    </div>
                    <form className="company-brain-setting-form company-brain-setting-form--row" onSubmit={createInvitation}>
                      <label>
                        Work email
                        <input name="email" type="email" autoComplete="email" required placeholder="person@company.com" />
                      </label>
                      <label>
                        Role
                        <select name="role" defaultValue="member">
                          <option value="member">Member</option>
                          {isOwner ? <option value="admin">Admin</option> : null}
                          {isOwner ? <option value="owner">Owner</option> : null}
                        </select>
                      </label>
                      <button type="submit" disabled={busyAction !== null}>
                        {busyAction === 'create-invitation' ? 'Creating…' : 'Create invitation'}
                      </button>
                    </form>
                    {invitationSecret ? (
                      <SecretPanel
                        label={`Invitation secret for ${invitationSecret.email}`}
                        value={invitationSecret.token}
                        detail="Share it through a trusted channel. MemCode stores only its hash and cannot show this secret again."
                      />
                    ) : null}
                  </section>
                  ) : null}

                  {activeDetail === 'members' ? (
                  <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="organization-members-title">
                    <div className="company-brain-setting-card__heading">
                      <div><span>Current access</span><h3 id="organization-members-title">Members</h3></div>
                      <small>{members.length} total</small>
                    </div>
                    <div className="company-brain-member-list">
                      {members.map((member) => (
                        <article key={member.user_id} className="company-brain-member">
                          <div className="company-brain-member__person">
                            {member.picture ? <img src={member.picture} alt="" /> : <span>{member.name.charAt(0)}</span>}
                            <div><strong>{member.name}</strong><small>{member.email}</small></div>
                          </div>
                          {isOwner && member.user_id !== identity?.user.id ? (
                            <select
                              aria-label={`Role for ${member.name}`}
                              value={member.role}
                              disabled={busyAction !== null}
                              onChange={(event) => updateRole(member, event.target.value as OrganizationRole)}
                            >
                              <option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option>
                            </select>
                          ) : <span className="company-brain-member__role">{roleLabel(member.role)}</span>}
                          {member.user_id !== identity?.user.id && (isOwner || member.role === 'member') ? (
                            <button type="button" className="company-brain-setting-card__danger" disabled={busyAction !== null} onClick={() => removeMember(member)}>
                              {busyAction === `remove-${member.user_id}` ? 'Removing…' : 'Remove'}
                            </button>
                          ) : <span />}
                        </article>
                      ))}
                    </div>
                  </section>
                  ) : null}

                  {activeDetail === 'access' ? (
                  <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="pending-invitations-title">
                    <div className="company-brain-setting-card__heading">
                      <div><span>Pending access</span><h3 id="pending-invitations-title">Invitations</h3></div>
                      <small>{invitations.filter((invitation) => invitation.status === 'pending').length} pending</small>
                    </div>
                    <div className="company-brain-invitation-list">
                      {invitations.length ? invitations.map((invitation) => (
                        <article key={invitation.id} className="company-brain-invitation">
                          <div><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · expires {formatDateTime(invitation.expires_at)}</small></div>
                          <span className={`company-brain-invitation__status company-brain-invitation__status--${invitation.status}`}>{invitation.status}</span>
                          {invitation.status === 'pending' ? (
                            <button type="button" className="company-brain-setting-card__danger" disabled={busyAction !== null} onClick={() => revokeInvitation(invitation)}>
                              {busyAction === `revoke-${invitation.id}` ? 'Revoking…' : 'Revoke'}
                            </button>
                          ) : <span />}
                        </article>
                      )) : <p className="company-brain-setting-card__empty">No invitations yet.</p>}
                    </div>
                  </section>
                  ) : null}
                </div>
              ) : <SettingsLockedState title="People settings are managed by an administrator" description="You can see your own workspace details under General. Ask an organization admin or owner to manage members and invitations." />
            ) : null}

            {activeTab === 'proactivity' ? (
              <section className="company-brain-setting-card company-brain-setting-card--wide company-brain-proactivity" aria-labelledby="proactivity-settings-title">
                <div className="company-brain-setting-card__heading">
                  <div>
                    <h3 id="proactivity-settings-title">
                      {activeDetail === 'participation' ? 'Participation' : activeDetail === 'channels' ? 'Public channels' : 'Reply limits'}
                    </h3>
                  </div>
                  <span className={`company-brain-proactivity__status ${proactivityPolicy?.enabled ? 'is-on' : ''}`}>
                    {proactivityError ? 'Unavailable' : proactivityPolicy?.enabled ? 'On' : 'Off'}
                  </span>
                </div>

                {proactivityError ? <div className="company-brain-proactivity__error" role="alert">{proactivityError}</div> : null}
                {!proactivityError && !proactivityPolicy ? (
                  <div className="company-brain-proactivity__empty-policy" role="status">
                    No policy saved. Participation stays off until these settings are saved.
                  </div>
                ) : null}

                <form className="company-brain-proactivity__form" onSubmit={saveProactivity}>
                  {activeDetail === 'participation' ? (
                  <label className="company-brain-proactivity__master">
                    <strong>Enabled</strong>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={proactivityDraft.enabled}
                      disabled={!isManager || busyAction !== null || Boolean(proactivityError)}
                      onChange={(event) => setProactivityDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                  </label>
                  ) : null}

                  {activeDetail === 'channels' ? (
                  <fieldset className="company-brain-proactivity__channels" disabled={!isManager || busyAction !== null || Boolean(proactivityError)}>
                    <legend>Public Slack channels</legend>
                    <p>Choose where Memcode may reply without being tagged. Saving will add the app to any selected public channel where needed.</p>

                    {!isManager ? (
                      <div className="company-brain-proactivity__channel-state">An admin or owner can choose proactive channels.</div>
                    ) : proactivityChannelsLoadState === 'loading' ? (
                      <div className="company-brain-proactivity__channel-state" role="status">Loading public Slack channels…</div>
                    ) : proactivityChannelsLoadState === 'error' ? (
                      <div className="company-brain-proactivity__channel-state is-error" role="alert">
                        <span>{proactivityChannelsError || 'Slack channels could not be loaded.'}</span>
                        <button type="button" onClick={() => void loadProactivityChannels(true)}>Retry</button>
                      </div>
                    ) : proactivityChannels?.status === 'not_connected' ? (
                      <div className="company-brain-proactivity__channel-state">Connect Slack before choosing proactive channels.</div>
                    ) : proactivityChannels?.status === 'provisioning' ? (
                      <div className="company-brain-proactivity__channel-state">
                        <span>Slack setup is still finishing.</span>
                        <button type="button" onClick={() => void loadProactivityChannels(true)}>Check again</button>
                      </div>
                    ) : proactivityChannels?.status === 'ready' ? (
                      <>
                        <div className="company-brain-proactivity__channel-input">
                          <label htmlFor="company-brain-proactivity-channel">Find a channel</label>
                          <div>
                            <input
                              id="company-brain-proactivity-channel"
                              type="search"
                              value={proactivityChannelSearch}
                              autoComplete="off"
                              placeholder="Search public channels"
                              onChange={(event) => setProactivityChannelSearch(event.target.value)}
                            />
                            <button type="button" onClick={() => void loadProactivityChannels(true)}>Refresh</button>
                          </div>
                        </div>
                        <div className="company-brain-proactivity__channel-actions">
                          <span>{proactivityDraft.allowedChannelIds.length} selected</span>
                          <button type="button" onClick={() => selectAllProactivityChannels(proactivityChannels.channels)}>Select all</button>
                          <button type="button" onClick={clearProactivityChannels}>Clear</button>
                        </div>
                        <div className="company-brain-proactivity__channel-options" role="list" aria-label="Public Slack channels">
                          {visibleProactivityChannels.length ? visibleProactivityChannels.map((channel) => {
                            const selected = proactivityDraft.allowedChannelIds.includes(channel.id)
                            return (
                              <label key={channel.id} className={selected ? 'is-selected' : ''} role="listitem">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleProactivityChannel(channel.id)}
                                />
                                <span>
                                  <strong># {channel.name}</strong>
                                  <small>{channel.topic || channel.purpose || 'Public channel'}{channel.isMember ? ' · App already joined' : ''}</small>
                                </span>
                              </label>
                            )
                          }) : (
                            <div className="company-brain-proactivity__channel-state">
                              {proactivityChannels.channels.length ? 'No channels match this search.' : 'No eligible public channels were returned.'}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="company-brain-proactivity__channel-state">
                        <button type="button" onClick={() => void loadProactivityChannels(true)}>Load Slack channels</button>
                      </div>
                    )}

                    {unavailableProactivityChannelIds.length ? (
                      <div className="company-brain-proactivity__missing-channels">
                        <small>Previously saved channels not returned by Slack</small>
                        <div className="company-brain-proactivity__channel-list" role="list">
                          {unavailableProactivityChannelIds.map((channelId) => (
                            <span key={channelId} role="listitem">
                              <code>{channelId}</code>
                              {isManager ? <button type="button" aria-label={`Remove channel ${channelId}`} onClick={() => removeProactivityChannel(channelId)}>×</button> : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {channelInputError ? <small id="company-brain-proactivity-channel-error" className="is-error" role="alert">{channelInputError}</small> : null}
                  </fieldset>
                  ) : null}

                  {activeDetail === 'limits' ? (
                  <div className="company-brain-proactivity__limits">
                    <label>
                      Replies per hour
                      <input
                        type="number"
                        min="1"
                        max="12"
                        step="1"
                        value={proactivityDraft.hourlyLimit}
                        disabled={!isManager || busyAction !== null || Boolean(proactivityError)}
                        onChange={(event) => setProactivityDraft((current) => ({ ...current, hourlyLimit: boundedInteger(event.target.value, 1, 12) }))}
                      />
                    </label>
                    <label>
                      Normal cooldown
                      <div className="company-brain-proactivity__unit-input">
                        <input
                          type="number"
                          min="1"
                          max="60"
                          step="1"
                          value={millisecondsToMinutes(proactivityDraft.normalMinimumIntervalMs)}
                          disabled={!isManager || busyAction !== null || Boolean(proactivityError)}
                          onChange={(event) => setProactivityDraft((current) => ({ ...current, normalMinimumIntervalMs: boundedInteger(event.target.value, 1, 60) * 60_000 }))}
                        />
                        <span>min</span>
                      </div>
                    </label>
                    <label>
                      Low-priority cooldown
                      <div className="company-brain-proactivity__unit-input">
                        <input
                          type="number"
                          min="1"
                          max="360"
                          step="1"
                          value={millisecondsToMinutes(proactivityDraft.lowMinimumIntervalMs)}
                          disabled={!isManager || busyAction !== null || Boolean(proactivityError)}
                          onChange={(event) => setProactivityDraft((current) => ({ ...current, lowMinimumIntervalMs: boundedInteger(event.target.value, 1, 360) * 60_000 }))}
                        />
                        <span>min</span>
                      </div>
                    </label>
                  </div>
                  ) : null}

                  <footer className="company-brain-proactivity__footer">
                    {isManager ? (
                      <button type="submit" disabled={busyAction !== null || Boolean(proactivityError)}>
                        {busyAction === 'save-proactivity' ? 'Saving…' : 'Save changes'}
                      </button>
                    ) : <span>Admin or owner access is required to edit this policy.</span>}
                  </footer>
                </form>
              </section>
            ) : null}

            {activeTab === 'billing' ? (
              isManager ? (
              <section className="company-brain-setting-card company-brain-setting-card--wide" aria-labelledby="subscription-controls-title">
                <div className="company-brain-setting-card__heading">
                  <div>
                    <span>{isManualRenewal ? 'Billing controls' : 'Subscription controls'}</span>
                    <h3 id="subscription-controls-title">
                      {isManualRenewal ? 'Plan, renewal, and refunds' : 'Plan, cancellation, and refunds'}
                    </h3>
                  </div>
                </div>
                {billing ? (
                  <>
                    {activeDetail === 'overview' ? (
                    <>
                    <div className="company-brain-subscription-summary">
                      <div>
                        <span>Current plan</span>
                        <strong>{billing.plan_name}</strong>
                        <small>{billing.billing_cycle} · {statusLabel(billing.status)}</small>
                      </div>
                      <div>
                        <span>Net charged</span>
                        <strong>{formatMoney(billing.net_charged_minor, billing.currency)}</strong>
                        <small>{formatMoney(billing.refunded_minor, billing.currency)} refunded</small>
                      </div>
                      <div>
                        <span>{isManualRenewal ? 'Paid through' : 'Current cycle ends'}</span>
                        <strong>{formatShortDate(billing.period_end)}</strong>
                        <small>{subscriptionIsTerminal
                          ? (isManualRenewal ? 'Access ended' : 'Subscription ended')
                          : isManualRenewal
                            ? 'Renew manually from Pricing'
                            : billing.cancel_at_period_end
                              ? 'Cancellation scheduled'
                              : 'Renews unless changed'}</small>
                      </div>
                    </div>

                    {!isManualRenewal && billing.pending_plan_id ? (
                      <div className="company-brain-lifecycle-notice" role="status">
                        Plan change to {planLabel(billing.pending_plan_id)} is scheduled for {formatShortDate(billing.pending_plan_effective_at)}.
                      </div>
                    ) : null}
                    {!isManualRenewal && billing.cancel_at_period_end ? (
                      <div className="company-brain-lifecycle-notice" role="status">
                        Cancellation is scheduled for {formatShortDate(billing.period_end)}. New usage will stop when the provider confirms the terminal state.
                      </div>
                    ) : null}
                    </>
                    ) : null}

                    {activeDetail === 'plan' ? (
                    isManualRenewal ? (
                      <div className="company-brain-lifecycle-notice" role="status">
                        This access does not renew automatically. Return to Pricing to purchase another month before the paid-through date.
                      </div>
                    ) : (
                      <div className="company-brain-lifecycle-grid">
                        <form className="company-brain-lifecycle-form" onSubmit={changePlan}>
                          <div>
                            <strong>Change plan</strong>
                            <small>The server catalog remains authoritative for price and quota.</small>
                          </div>
                          <label>
                            New plan
                            <select name="package_id" defaultValue={nextPlanId(billing.plan_id)} required>
                              {COMPANY_BRAIN_PLANS.map((plan) => (
                                <option key={plan.id} value={plan.id} disabled={plan.id === billing.plan_id}>
                                  {plan.name}{plan.id === billing.plan_id ? ' (current)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Effective
                            <select name="mode" defaultValue="cycle_end">
                              <option value="cycle_end">End of billing cycle</option>
                              <option value="now">Immediately</option>
                            </select>
                          </label>
                          <label className="company-brain-confirmation">
                            <input name="confirmed" type="checkbox" required />
                            I authorize this provider-side plan change.
                          </label>
                          <button type="submit" disabled={busyAction !== null || subscriptionIsTerminal || Boolean(billing.pending_plan_id) || billing.cancel_at_period_end}>
                            {busyAction === 'change-plan' ? 'Changing…' : 'Confirm plan change'}
                          </button>
                        </form>

                        <form className="company-brain-lifecycle-form company-brain-lifecycle-form--danger" onSubmit={cancelSubscription}>
                          <div>
                            <strong>Cancel subscription</strong>
                            <small>Cycle-end cancellation preserves access until the paid period ends.</small>
                          </div>
                          <label>
                            Cancellation timing
                            <select name="mode" defaultValue="cycle_end">
                              <option value="cycle_end">End of billing cycle</option>
                              <option value="immediate">Immediately</option>
                            </select>
                          </label>
                          <label className="company-brain-confirmation">
                            <input name="confirmed" type="checkbox" required />
                            I understand immediate cancellation suspends Company Brain access.
                          </label>
                          <button type="submit" disabled={busyAction !== null || subscriptionIsTerminal || billing.cancel_at_period_end || Boolean(billing.pending_plan_id)}>
                            {busyAction === 'cancel-subscription' ? 'Cancelling…' : 'Confirm cancellation'}
                          </button>
                        </form>
                      </div>
                    )
                    ) : null}

                    {activeDetail === 'refunds' ? (
                    <div className="company-brain-refunds">
                      <div>
                        <strong>Invoice refunds</strong>
                        <small>Leave amount blank for the full remaining refundable amount. Final state is reconciled from signed provider webhooks.</small>
                      </div>
                      {billingInvoices.length ? billingInvoices.map((invoice) => {
                        const availableMinor = invoice.total_charged_minor
                          - invoice.refunded_minor
                          - invoice.refund_pending_minor
                        return (
                          <form
                            key={invoice.id}
                            className="company-brain-refund-row"
                            onSubmit={(event) => refundInvoice(event, invoice)}
                          >
                            <div>
                              <strong>{formatShortDate(invoice.paid_at || invoice.period_start)}</strong>
                              <small>{invoice.id} · {statusLabel(invoice.status)}</small>
                            </div>
                            <span>{formatMoney(invoice.net_charged_minor, invoice.currency)} net</span>
                            {availableMinor > 0 ? (
                              <>
                                <label>
                                  <span>Refund amount</span>
                                  <input
                                    name="amount"
                                    type="number"
                                    min="0.01"
                                    max={(availableMinor / 100).toFixed(2)}
                                    step="0.01"
                                    placeholder={(availableMinor / 100).toFixed(2)}
                                    aria-label={`Refund amount for invoice ${invoice.id}`}
                                  />
                                </label>
                                <label className="company-brain-refund-confirmation">
                                  <input type="checkbox" required />
                                  <span>Authorize</span>
                                </label>
                                <button type="submit" disabled={busyAction !== null}>
                                  {busyAction === `refund-${invoice.id}` ? 'Requesting…' : 'Request refund'}
                                </button>
                              </>
                            ) : (
                              <small>No refundable balance</small>
                            )}
                          </form>
                        )
                      }) : <p className="company-brain-setting-card__empty">No paid invoices yet.</p>}
                    </div>
                    ) : null}
                  </>
                ) : (
                  <p className="company-brain-setting-card__empty">
                    No Company Brain subscription is active. Choose a plan from the Pricing section first.
                  </p>
                )}
              </section>
              ) : <SettingsLockedState title="Billing is visible to organization administrators" description="Ask an admin or owner to review the plan, invoices, refunds or subscription lifecycle." />
                ) : null}
              </div>
            ) : null}
            </AccountDetailNavigation>
          </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SettingsLockedState({ title, description }: { title: string; description: string }) {
  return (
    <section className="company-brain-settings__locked" role="status">
      <span aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" /></svg>
      </span>
      <div><strong>{title}</strong><p>{description}</p></div>
    </section>
  )
}

function policyDraft(policy: ProactivityPolicy): ProactivityDraft {
  return {
    enabled: policy.enabled,
    allowedChannelIds: [...policy.allowedChannelIds],
    hourlyLimit: policy.hourlyLimit,
    normalMinimumIntervalMs: policy.normalMinimumIntervalMs,
    lowMinimumIntervalMs: policy.lowMinimumIntervalMs,
  }
}

function boundedInteger(value: string, minimum: number, maximum: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)))
}

function millisecondsToMinutes(value: number) {
  return Math.max(1, Math.round(value / 60_000))
}

function SecretPanel({ label, value, detail }: {
  label: string
  value: string
  detail: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="company-brain-secret">
      <span>{label}</span>
      <div>
        <code>{value}</code>
        <button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <small>{detail}</small>
    </div>
  )
}

async function responseError(response: Response, fallback: string) {
  return readUserFacingApiError(response, {
    fallback,
    messages: MANAGEMENT_ERROR_MESSAGES,
  })
}

function isAmbiguousBillingFailure(error: BrainHttpError) {
  return error.status >= 500
    || error.code === 'operation_in_progress'
    || error.code === 'operation_failed'
    || error.code === 'payment_provider_unavailable'
}

function roleLabel(role: OrganizationRole) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'at an unknown time'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatShortDate(value?: string) {
  if (!value) return 'an unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'an unknown date'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

function statusLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function planLabel(planId: CompanyBrainPlanId) {
  return COMPANY_BRAIN_PLANS.find((plan) => plan.id === planId)?.name || planId
}

function nextPlanId(current: CompanyBrainPlanId) {
  return COMPANY_BRAIN_PLANS.find((plan) => plan.id !== current)?.id || current
}

function operationKey(kind: string) {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `memcode-dashboard-${kind}-${suffix}`
}
