import { BRAIN_API_URL } from './api'
import { setActiveBrainOrganizationId } from './brain-organization-context'
import type { OrganizationRole } from './brain-dashboard'
import {
  ORGANIZATION_ERROR_MESSAGES,
  readUserFacingApiError,
} from './user-facing-errors'

const ORGANIZATION_EVENT_KEY = 'memcode:company-brain:organization-change'
const ORGANIZATION_CHANNEL_NAME = 'memcode-company-brain-organization'

export interface BrainOrganizationSummary {
  id: string
  name: string
  role: OrganizationRole
  is_default?: boolean
  owner_contact?: {
    name: string
    email: string
  } | null
}

export interface BrainOrganizationList {
  currentOrganizationId: string
  organizations: BrainOrganizationSummary[]
}

export interface CreateBrainOrganizationInput {
  name: string
  domain?: string
}

export class BrainOrganizationHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainOrganizationHttpError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRole(value: unknown): OrganizationRole {
  if (value !== 'member' && value !== 'admin' && value !== 'owner') {
    throw new Error('The organization response contained an invalid membership role.')
  }
  return value
}

function parseOrganization(value: unknown): BrainOrganizationSummary {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('The organization response was invalid.')
  }
  if (value.is_default !== undefined && typeof value.is_default !== 'boolean') {
    throw new Error('The organization response contained an invalid default state.')
  }
  if (value.owner_contact !== undefined && value.owner_contact !== null && (
    !isRecord(value.owner_contact)
    || typeof value.owner_contact.name !== 'string'
    || typeof value.owner_contact.email !== 'string'
  )) {
    throw new Error('The organization response contained an invalid owner contact.')
  }
  const ownerContact = isRecord(value.owner_contact)
    ? { name: String(value.owner_contact.name), email: String(value.owner_contact.email) }
    : value.owner_contact === null
      ? null
      : undefined
  return {
    id: value.id,
    name: value.name,
    role: parseRole(value.role),
    ...(typeof value.is_default === 'boolean' ? { is_default: value.is_default } : {}),
    ...(ownerContact !== undefined ? { owner_contact: ownerContact } : {}),
  }
}

async function readError(response: Response, fallback: string) {
  return readUserFacingApiError(response, {
    fallback,
    messages: ORGANIZATION_ERROR_MESSAGES,
  })
}

async function requestOrganizationJson(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${BRAIN_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  })
  if (!response.ok) {
    const details = await readError(response, 'The organization request failed.')
    throw new BrainOrganizationHttpError(details.message, response.status, details.code)
  }
  return response.json() as Promise<unknown>
}

export async function fetchBrainOrganizations(signal?: AbortSignal): Promise<BrainOrganizationList> {
  const payload = await requestOrganizationJson('/api/organizations', { signal })
  if (!isRecord(payload)
    || typeof payload.current_organization_id !== 'string'
    || !Array.isArray(payload.organizations)) {
    throw new Error('The organization list response was invalid.')
  }
  const organizations = payload.organizations.map(parseOrganization)
  if (organizations.length > 0
    && !organizations.some((organization) => organization.id === payload.current_organization_id)) {
    throw new Error('The active organization was missing from the organization list.')
  }
  setActiveBrainOrganizationId(payload.current_organization_id)
  return {
    currentOrganizationId: payload.current_organization_id,
    organizations,
  }
}

export async function switchBrainOrganization(organizationId: string): Promise<BrainOrganizationSummary> {
  const payload = await requestOrganizationJson('/api/organizations/switch', {
    method: 'POST',
    body: JSON.stringify({ organization_id: organizationId }),
  })
  if (!isRecord(payload)) throw new Error('The organization switch response was invalid.')
  const organization = parseOrganization(payload.organization)
  setActiveBrainOrganizationId(organization.id)
  return organization
}

export async function createBrainOrganization(
  input: CreateBrainOrganizationInput,
  options: { idempotencyKey: string },
): Promise<BrainOrganizationSummary> {
  const payload = await requestOrganizationJson('/api/organizations', {
    method: 'POST',
    headers: { 'Idempotency-Key': options.idempotencyKey },
    body: JSON.stringify({
      name: input.name,
      ...(input.domain ? { domain: input.domain } : {}),
    }),
  })
  if (!isRecord(payload)) throw new Error('The organization creation response was invalid.')
  const organization = parseOrganization(payload.organization)
  setActiveBrainOrganizationId(organization.id)
  return organization
}

export function isBrainOrganizationAuthenticationRequired(error: unknown) {
  return error instanceof BrainOrganizationHttpError && error.status === 401
}

export function isAmbiguousBrainOrganizationFailure(error: unknown) {
  return !(error instanceof BrainOrganizationHttpError) || error.status >= 500
}

interface OrganizationChangeEvent {
  id: string
  organizationId?: string
  timestamp: number
}

export function publishBrainOrganizationChange(organizationId?: string) {
  setActiveBrainOrganizationId(organizationId)
  const event: OrganizationChangeEvent = {
    id: operationId(),
    ...(organizationId ? { organizationId } : {}),
    timestamp: Date.now(),
  }
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(ORGANIZATION_CHANNEL_NAME)
    channel.postMessage(event)
    channel.close()
  }
  try {
    window.localStorage.setItem(ORGANIZATION_EVENT_KEY, JSON.stringify(event))
  } catch {
    // Cross-tab invalidation remains available through BroadcastChannel.
  }
}

export function subscribeToBrainOrganizationChanges(
  listener: (organizationId?: string) => void,
) {
  const seen = new Set<string>()
  const receive = (value: unknown) => {
    if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.timestamp !== 'number'
      || (value.organizationId !== undefined && typeof value.organizationId !== 'string')
      || seen.has(value.id)) return
    seen.add(value.id)
    setActiveBrainOrganizationId(
      typeof value.organizationId === 'string' ? value.organizationId : undefined,
    )
    listener(typeof value.organizationId === 'string' ? value.organizationId : undefined)
  }
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(ORGANIZATION_CHANNEL_NAME)
    : null
  if (channel) channel.onmessage = (event) => receive(event.data)
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ORGANIZATION_EVENT_KEY || !event.newValue) return
    try {
      receive(JSON.parse(event.newValue))
    } catch {
      // Ignore malformed or legacy storage values.
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', handleStorage)
  }
}

function operationId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
