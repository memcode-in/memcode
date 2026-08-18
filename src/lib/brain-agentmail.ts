import { BRAIN_API_URL } from './api'
import { organizationScopedHeaders } from './brain-organization-context'
import {
  readUserFacingApiError,
  type UserFacingErrorMessages,
} from './user-facing-errors'

export type BrainAgentMailProvider = 'managed' | 'byo'
export type BrainAgentMailInboxStatus = 'provisioning' | 'ready' | 'failed'
export type BrainAgentMailInboxPhase = 'pod' | 'inbox' | 'credential' | 'ready'

export interface BrainAgentMailInbox {
  status: BrainAgentMailInboxStatus
  phase: BrainAgentMailInboxPhase
  email: string | null
  display_name: string | null
  request: {
    username: string | null
    domain: string | null
    display_name: string | null
  }
  last_error: string | null
}

export interface BrainAgentMailSettings {
  provider: BrainAgentMailProvider
  managed_available: boolean
  api_key_configured: boolean
  inbox: BrainAgentMailInbox | null
  updated_at: string | null
}

export interface BrainAgentMailSettingsUpdate {
  provider: BrainAgentMailProvider
  api_key?: string
  remove?: boolean
}

export interface BrainAgentMailInboxInput {
  username?: string
  domain?: string
  display_name?: string
}

export class BrainAgentMailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainAgentMailHttpError'
  }
}

const AGENTMAIL_ERROR_MESSAGES: UserFacingErrorMessages = {
  agentmail_admin_required: 'Only an organization admin or owner can change company email settings.',
  agentmail_configuration_invalid: 'Check the company email configuration and try again.',
  agentmail_configuration_unavailable: 'Company email is not available for this organization yet.',
  agentmail_idempotency_conflict: 'This organization already has a different inbox setup in progress.',
  agentmail_inbox_already_configured: 'This organization already has its company inbox. Contact support before changing it.',
  agentmail_stale_operation: 'The inbox setup changed while this request was running. Refresh and try again.',
  agentmail_unavailable: 'Company email is temporarily unavailable. Please try again.',
  agentmail_not_configured: 'Configure company email before creating its inbox.',
  agentmail_managed_unavailable: 'Company email is not available on this deployment.',
  agentmail_api_key_required: 'Company email credentials are not configured.',
  agentmail_invalid_api_key: 'The company email credentials could not be accepted.',
  agentmail_inbox_exists: 'This organization already has its company inbox.',
  agentmail_provisioning_in_progress: 'The organization inbox is already being prepared.',
  agentmail_provisioning_failed: 'The organization inbox could not be prepared. Please try again.',
  agentmail_provider_unavailable: 'Company email is temporarily unavailable. Please try again.',
  idempotency_key_required: 'The inbox request could not be verified. Refresh and try again.',
  idempotency_conflict: 'This inbox request conflicts with an earlier request. Refresh and try again.',
}

export async function fetchBrainAgentMailSettings(signal?: AbortSignal) {
  const response = await request('/settings/agentmail', { signal })
  return parseSettingsEnvelope(await response.json())
}

export async function updateBrainAgentMailSettings(input: BrainAgentMailSettingsUpdate) {
  const response = await request('/settings/agentmail', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseSettingsEnvelope(await response.json())
}

export async function provisionBrainAgentMailInbox(
  input: BrainAgentMailInboxInput,
  idempotencyKey: string,
) {
  const response = await request('/settings/agentmail/inbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  })
  const payload = record(await response.json(), 'company inbox response')
  return {
    settings: parseSettings(payload.settings),
    replayed: optionalBoolean(payload.replayed) ?? false,
  }
}

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${BRAIN_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: organizationScopedHeaders({
      Accept: 'application/json',
      ...(init.headers ?? {}),
    }),
  })

  if (!response.ok) {
    const details = await readUserFacingApiError(response, {
      fallback: init.method === 'POST'
        ? 'The organization inbox could not be prepared. Please try again.'
        : init.method === 'PUT'
          ? 'Company email settings could not be saved. Please try again.'
          : 'Company email settings are temporarily unavailable. Please try again.',
      messages: AGENTMAIL_ERROR_MESSAGES,
      statusMessages: {
        403: 'Only an organization admin or owner can change company email settings.',
        404: 'Company email settings are not available here yet.',
        409: 'The organization inbox is already being prepared or already exists.',
        422: 'Check the company email configuration and try again.',
        429: 'Too many company email requests were made. Wait a moment and try again.',
        500: 'Company email settings are temporarily unavailable. Please try again.',
        502: 'Company email is temporarily unavailable. Please try again.',
        503: 'Company email is not configured on this deployment.',
      },
    })
    throw new BrainAgentMailHttpError(details.message, response.status, details.code)
  }
  return response
}

function parseSettingsEnvelope(value: unknown): BrainAgentMailSettings {
  const envelope = record(value, 'company email settings response')
  return parseSettings(envelope.settings)
}

function parseSettings(value: unknown): BrainAgentMailSettings {
  const settings = record(value, 'company email settings')
  const provider = settings.provider
  if (provider !== 'managed' && provider !== 'byo') {
    throw new Error('Company email settings returned an unsupported provider.')
  }
  return {
    provider,
    managed_available: boolean(settings.managed_available, 'company email availability'),
    api_key_configured: boolean(settings.api_key_configured, 'company email credential status'),
    inbox: settings.inbox === null || settings.inbox === undefined
      ? null
      : parseInbox(settings.inbox),
    updated_at: optionalString(settings.updated_at),
  }
}

function parseInbox(value: unknown): BrainAgentMailInbox {
  const inbox = record(value, 'company inbox')
  const status = inbox.status
  const phase = inbox.phase
  if (status !== 'provisioning' && status !== 'ready' && status !== 'failed') {
    throw new Error('Company email returned an unsupported inbox status.')
  }
  if (phase !== 'pod' && phase !== 'inbox' && phase !== 'credential' && phase !== 'ready') {
    throw new Error('Company email returned an unsupported inbox phase.')
  }
  return {
    status,
    phase,
    email: optionalString(inbox.email),
    display_name: optionalString(inbox.display_name),
    request: parseInboxRequest(inbox.request),
    last_error: optionalString(inbox.last_error),
  }
}

function parseInboxRequest(value: unknown): BrainAgentMailInbox['request'] {
  const request = record(value, 'company inbox request')
  return {
    username: optionalString(request.username),
    domain: optionalString(request.domain),
    display_name: optionalString(request.display_name),
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} was invalid.`)
  }
  return value as Record<string, unknown>
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} was invalid.`)
  return value
}

function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('Company email returned invalid text.')
  return value
}
