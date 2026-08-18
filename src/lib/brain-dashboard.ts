import { BRAIN_API_URL } from './api'
import {
  organizationScopedHeaders,
  setActiveBrainOrganizationId,
} from './brain-organization-context'
import {
  decodeBrainByokUsageResources,
  type BrainByokUsageResource,
} from './brain-byok-usage'
import { readUserFacingApiError } from './user-facing-errors'

export type {
  BrainByokBrowserUsageResource,
  BrainByokCostSource,
  BrainByokModelUsageResource,
  BrainByokSandboxUsageResource,
  BrainByokUsageResource,
  BrainByokWebUsageResource,
  BrainByokXSearchUsageResource,
} from './brain-byok-usage'

export type OrganizationRole = 'member' | 'admin' | 'owner'
export type MemoryConnectionStatus = 'connected' | 'pending' | 'disabled' | 'error'
export type MemorySpaceKind = 'public_channel' | 'private_channel' | 'personal' | 'org_shared'
export type MemorySpaceVisibility = 'organization' | 'members' | 'owner'
export type BrainSubscriptionContinuityPhase = 'ending' | 'ended' | 'past_due' | 'suspended'

export interface BrainOperationalActivity {
  slack_events: {
    total: number
    processing: number
    completed: number
    failed: number
    replied: number
    silent: number
    superseded: number
    attempts: number
    latest_activity_at: string | null
  }
  turns: {
    total: number
    active: number
    completed: number
    failed: number
    cancelled: number
    latest_activity_at: string | null
  }
  usage_totals: {
    periods: number
    model_turns: number
    input_tokens: number
    output_tokens: number
    connected_app_calls: number
    research_calls: number
    sandbox_seconds: number
    latest_activity_at: string | null
  }
  memory_writes: {
    total: number
    processing: number
    ready: number
    failed: number
    latest_activity_at: string | null
  }
  public_history: {
    runs: {
      total: number
      discover: number
      collect: number
      done: number
      failed: number
    }
    messages: number
    documents: {
      total: number
      pending: number
      processing: number
      ready: number
      failed: number
    }
    latest_activity_at: string | null
  }
}

export interface BrainDashboard {
  viewer: {
    id: string
    name: string
    email: string
    picture?: string
  }
  organization: {
    id: string
    name: string
    domain: string | null
    role: OrganizationRole
    owner_contact?: {
      name: string
      email: string
    } | null
  }
  permissions: {
    manage_members: boolean
    manage_billing: boolean
    view_usage?: boolean
    view_financials: boolean
    manage_spaces: boolean
  }
  features?: {
    code_mode_access: boolean
    mcp_access: boolean
  }
  subscription: {
    plan_id: string
    plan_name: string
    status: string
    billing_cycle: string
    renewal_mode?: 'manual' | 'recurring'
    cancel_at_period_end?: boolean
    access_source?: 'complimentary' | 'paid_order'
    access_expires_at?: string | null
    period_start: string
    period_end: string
  } | null
  usage: {
    counters: Record<string, number>
    limits: Record<string, number | null> | null
    period_start: string
    period_end: string
  } | null
  byok_usage?: BrainByokUsageResource[] | null
  financials: {
    currency: string
    plan_charged_minor: number
    usage_charged_minor: number
    net_charged_minor: number
  } | null
  activity?: BrainOperationalActivity | null
  memory: {
    connection_status: MemoryConnectionStatus
    organization: {
      space_count: number | null
      memory_count: number | null
    }
    personal_dm: {
      space_id: string
      memory_count: number | null
      updated_at: string | null
    } | null
    private_channels: {
      space_count: number | null
      memory_count: number | null
    }
    usage?: {
      period: string
      ingests: number
      searches: number
      retrievals: number
      stored_memories: number
      storage_bytes: number
      cost_minor?: number
      currency?: string
    } | null
    spaces: Array<{
      id: string
      name: string
      kind: MemorySpaceKind
      visibility: MemorySpaceVisibility
      memory_count?: number
      updated_at: string | null
    }>
  }
}

export class BrainDashboardHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainDashboardHttpError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value)
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasNumberValues(value: unknown) {
  return isRecord(value) && Object.values(value).every(isNumber)
}

function hasNullableNumberValues(value: unknown) {
  return isRecord(value) && Object.values(value).every((entry) => entry === null || isNumber(entry))
}

function isMemorySpaceKindAndVisibility(kind: unknown, visibility: unknown) {
  return (kind === 'org_shared' && visibility === 'organization')
    || (kind === 'public_channel' && visibility === 'organization')
    || (kind === 'private_channel' && visibility === 'members')
    || (kind === 'personal' && visibility === 'owner')
}

function isBrainOperationalActivity(value: unknown): value is BrainOperationalActivity {
  if (!isRecord(value)) return false
  const {
    slack_events: slackEvents,
    turns,
    usage_totals: usageTotals,
    memory_writes: memoryWrites,
    public_history: publicHistory,
  } = value

  return isRecord(slackEvents)
    && isNonNegativeCount(slackEvents.total)
    && isNonNegativeCount(slackEvents.processing)
    && isNonNegativeCount(slackEvents.completed)
    && isNonNegativeCount(slackEvents.failed)
    && isNonNegativeCount(slackEvents.replied)
    && isNonNegativeCount(slackEvents.silent)
    && isNonNegativeCount(slackEvents.superseded)
    && isNonNegativeCount(slackEvents.attempts)
    && isNullableString(slackEvents.latest_activity_at)
    && isRecord(turns)
    && isNonNegativeCount(turns.total)
    && isNonNegativeCount(turns.active)
    && isNonNegativeCount(turns.completed)
    && isNonNegativeCount(turns.failed)
    && isNonNegativeCount(turns.cancelled)
    && isNullableString(turns.latest_activity_at)
    && isRecord(usageTotals)
    && isNonNegativeCount(usageTotals.periods)
    && isNonNegativeCount(usageTotals.model_turns)
    && isNonNegativeCount(usageTotals.input_tokens)
    && isNonNegativeCount(usageTotals.output_tokens)
    && isNonNegativeCount(usageTotals.connected_app_calls)
    && isNonNegativeCount(usageTotals.research_calls)
    && isNonNegativeCount(usageTotals.sandbox_seconds)
    && isNullableString(usageTotals.latest_activity_at)
    && isRecord(memoryWrites)
    && isNonNegativeCount(memoryWrites.total)
    && isNonNegativeCount(memoryWrites.processing)
    && isNonNegativeCount(memoryWrites.ready)
    && isNonNegativeCount(memoryWrites.failed)
    && isNullableString(memoryWrites.latest_activity_at)
    && isRecord(publicHistory)
    && isRecord(publicHistory.runs)
    && isNonNegativeCount(publicHistory.runs.total)
    && isNonNegativeCount(publicHistory.runs.discover)
    && isNonNegativeCount(publicHistory.runs.collect)
    && isNonNegativeCount(publicHistory.runs.done)
    && isNonNegativeCount(publicHistory.runs.failed)
    && isNonNegativeCount(publicHistory.messages)
    && isRecord(publicHistory.documents)
    && isNonNegativeCount(publicHistory.documents.total)
    && isNonNegativeCount(publicHistory.documents.pending)
    && isNonNegativeCount(publicHistory.documents.processing)
    && isNonNegativeCount(publicHistory.documents.ready)
    && isNonNegativeCount(publicHistory.documents.failed)
    && isNullableString(publicHistory.latest_activity_at)
}

function isBrainDashboard(value: unknown): value is BrainDashboard {
  if (!isRecord(value)) return false
  const { viewer, organization, permissions, features, subscription, usage, byok_usage: byokUsage, financials, activity, memory } = value
  if (!isRecord(viewer)
    || !isString(viewer.id)
    || !isString(viewer.name)
    || !isString(viewer.email)
    || (viewer.picture !== undefined && !isString(viewer.picture))) return false
  if (!isRecord(organization)
    || !isString(organization.id)
    || !isString(organization.name)
    || !isNullableString(organization.domain)
    || !['member', 'admin', 'owner'].includes(String(organization.role))
    || (organization.owner_contact !== undefined
      && organization.owner_contact !== null
      && (!isRecord(organization.owner_contact)
        || !isString(organization.owner_contact.name)
        || !isString(organization.owner_contact.email)))) return false
  if (!isRecord(permissions)
    || typeof permissions.manage_members !== 'boolean'
    || typeof permissions.manage_billing !== 'boolean'
    || (permissions.view_usage !== undefined && typeof permissions.view_usage !== 'boolean')
    || typeof permissions.view_financials !== 'boolean'
    || typeof permissions.manage_spaces !== 'boolean') return false
  if (features !== undefined && (!isRecord(features)
    || typeof features.code_mode_access !== 'boolean'
    || typeof features.mcp_access !== 'boolean')) return false
  if (subscription !== null && (!isRecord(subscription)
    || !isString(subscription.plan_id)
    || !isString(subscription.plan_name)
    || !isString(subscription.status)
    || !isString(subscription.billing_cycle)
    || (subscription.renewal_mode !== undefined
      && subscription.renewal_mode !== 'manual'
      && subscription.renewal_mode !== 'recurring')
    || (subscription.cancel_at_period_end !== undefined
      && typeof subscription.cancel_at_period_end !== 'boolean')
    || (subscription.access_source !== undefined
      && subscription.access_source !== 'complimentary'
      && subscription.access_source !== 'paid_order')
    || (subscription.access_expires_at !== undefined
      && subscription.access_expires_at !== null
      && !isString(subscription.access_expires_at))
    || !isString(subscription.period_start)
    || !isString(subscription.period_end))) return false
  if (usage !== null && (!isRecord(usage)
    || !hasNumberValues(usage.counters)
    || (usage.limits !== null && !hasNullableNumberValues(usage.limits))
    || !isString(usage.period_start)
    || !isString(usage.period_end))) return false
  if (byokUsage !== undefined && byokUsage !== null
    && decodeBrainByokUsageResources(byokUsage) === null) return false
  if (financials !== null && (!isRecord(financials)
    || !isString(financials.currency)
    || !isNumber(financials.plan_charged_minor)
    || !isNumber(financials.usage_charged_minor)
    || !isNumber(financials.net_charged_minor))) return false
  if (activity !== undefined && activity !== null && !isBrainOperationalActivity(activity)) return false
  if (!isRecord(memory)
    || !['connected', 'pending', 'disabled', 'error'].includes(String(memory.connection_status))
    || !isRecord(memory.organization)
    || !isNullableNumber(memory.organization.space_count)
    || !isNullableNumber(memory.organization.memory_count)
    || !isRecord(memory.private_channels)
    || !isNullableNumber(memory.private_channels.space_count)
    || !isNullableNumber(memory.private_channels.memory_count)
    || !Array.isArray(memory.spaces)) return false
  if (memory.personal_dm !== null && (!isRecord(memory.personal_dm)
    || !isString(memory.personal_dm.space_id)
    || !isNullableNumber(memory.personal_dm.memory_count)
    || !isNullableString(memory.personal_dm.updated_at))) return false
  if (memory.usage !== null && memory.usage !== undefined && (!isRecord(memory.usage)
    || !isString(memory.usage.period)
    || !isNumber(memory.usage.ingests)
    || !isNumber(memory.usage.searches)
    || !isNumber(memory.usage.retrievals)
    || !isNumber(memory.usage.stored_memories)
    || !isNumber(memory.usage.storage_bytes)
    || (memory.usage.cost_minor !== undefined && !isNumber(memory.usage.cost_minor))
    || (memory.usage.currency !== undefined && !isString(memory.usage.currency)))) return false

  return memory.spaces.every((space) => isRecord(space)
    && isString(space.id)
    && isString(space.name)
    && ['public_channel', 'private_channel', 'personal', 'org_shared'].includes(String(space.kind))
    && ['organization', 'members', 'owner'].includes(String(space.visibility))
    && isMemorySpaceKindAndVisibility(space.kind, space.visibility)
    && (space.memory_count === undefined || isNumber(space.memory_count))
    && isNullableString(space.updated_at))
}

async function readError(response: Response) {
  return readUserFacingApiError(response, {
    fallback: 'The organization dashboard request failed. Please try again.',
    statusMessages: {
      403: 'You do not have access to this organization dashboard.',
      404: 'This organization dashboard is not available yet.',
      429: 'The dashboard is refreshing too often. Wait a moment and try again.',
      500: 'The organization dashboard is temporarily unavailable. Please try again.',
      502: 'The organization dashboard is temporarily unavailable. Please try again.',
      503: 'The organization dashboard is temporarily unavailable. Please try again.',
    },
  })
}

async function requestBrainDashboard(expectedOrganizationId?: string, retriedContext = false): Promise<BrainDashboard> {
  const response = await fetch(`${BRAIN_API_URL}/api/v2/dashboard`, {
    credentials: 'include',
    headers: organizationScopedHeaders({ Accept: 'application/json' }, expectedOrganizationId),
  })

  if (!response.ok) {
    const details = await readError(response)
    if (response.status === 409
      && details.code === 'organization_context_changed'
      && !expectedOrganizationId
      && !retriedContext) {
      setActiveBrainOrganizationId(null)
      return requestBrainDashboard(undefined, true)
    }
    throw new BrainDashboardHttpError(details.message, response.status, details.code)
  }

  const payload: unknown = await response.json()
  if (!isBrainDashboard(payload)) {
    throw new Error('The organization dashboard returned an invalid response.')
  }
  if (expectedOrganizationId && payload.organization.id !== expectedOrganizationId) {
    throw new Error('The organization session changed before the dashboard finished loading. Please refresh and try again.')
  }
  setActiveBrainOrganizationId(payload.organization.id)
  return payload
}

const inFlightDashboardRequests = new Map<string, Promise<BrainDashboard>>()

export function fetchBrainDashboard({
  dedupe = true,
  expectedOrganizationId,
}: {
  dedupe?: boolean
  expectedOrganizationId?: string
} = {}) {
  if (!dedupe) return requestBrainDashboard(expectedOrganizationId)
  const requestKey = expectedOrganizationId || 'active'
  const inFlightRequest = inFlightDashboardRequests.get(requestKey)
  if (inFlightRequest) return inFlightRequest

  const request = requestBrainDashboard(expectedOrganizationId).finally(() => {
    inFlightDashboardRequests.delete(requestKey)
  })
  inFlightDashboardRequests.set(requestKey, request)
  return request
}

export function canViewBrainUsage(dashboard: BrainDashboard | null) {
  if (!dashboard || dashboard.organization.role === 'member') return false
  return dashboard.permissions.view_usage !== false
}

export function canManageBrainOrganization(dashboard: BrainDashboard | null) {
  if (!dashboard || dashboard.organization.role === 'member') return false
  return dashboard.permissions.manage_members
    || dashboard.permissions.manage_billing
    || dashboard.permissions.manage_spaces
}

export function brainBillingPeriodDaysRemaining(value: string, now = new Date()) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  const target = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value)
  if (Number.isNaN(target.getTime())) return null

  // Timestamp periods are exact. Once that instant passes, never keep calling
  // the period "today" while billing has already moved to expiry semantics.
  if (!dateOnly && target.getTime() <= now.getTime()) return -1

  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((targetDay - todayDay) / 86_400_000)
}

export function brainSubscriptionContinuityPhase(
  subscription: BrainDashboard['subscription'],
): BrainSubscriptionContinuityPhase | null {
  if (!subscription) return null
  const status = subscription.status.trim().toLowerCase()
  if (status === 'past_due') return 'past_due'
  if (status === 'suspended') return 'suspended'
  if (status === 'cancelled' || status === 'canceled' || status === 'completed') return 'ended'
  if (status !== 'active') return null
  const accessExpiresAt = subscription.access_expires_at
    ?? (subscription.cancel_at_period_end === true ? subscription.period_end : null)
  if (!accessExpiresAt) return null
  const daysRemaining = brainBillingPeriodDaysRemaining(accessExpiresAt)
  return daysRemaining !== null && daysRemaining < 0 ? 'ended' : 'ending'
}

export function isBrainDashboardAuthenticationRequired(error: unknown) {
  return error instanceof BrainDashboardHttpError && error.status === 401
}
