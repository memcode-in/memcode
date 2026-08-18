import { BRAIN_API_URL } from './api'
import { organizationScopedHeaders } from './brain-organization-context'
import { readUserFacingApiError, type UserFacingErrorMessages } from './user-facing-errors'

export type CompanyMailboxStatus = 'not_configured' | 'skipped' | 'provisioning' | 'ready' | 'failed' | 'unavailable'

export interface CompanyMailboxSlackDelivery {
  available: boolean
  enabled: boolean
  teamId: string | null
  channelId: string | null
  channelName: string | null
  lastError: string | null
  updatedAt: string | null
}

export interface CompanyMailboxSlackChannel {
  id: string
  name: string
  isMember: boolean
}

export interface CompanyMailboxSlackChannels {
  status: 'not_connected' | 'ready' | 'unavailable'
  teamId: string | null
  channels: CompanyMailboxSlackChannel[]
}

export type CompanyMailboxSlackDeliveryInput =
  | { enabled: false }
  | { enabled: true; teamId: string; channelId: string }

export interface CompanyMailboxSummary {
  status: CompanyMailboxStatus
  address: string | null
  addressPreview: string | null
  displayName: string | null
  canManage: boolean
  unreadCount: number
  unreadCountCapped: boolean
  slackDelivery: CompanyMailboxSlackDelivery
  lastError: string | null
  updatedAt: string | null
}

export interface CompanyMailboxAttachment {
  id: string
  filename: string
  contentType: string | null
  sizeBytes: number | null
}

export interface CompanyMailboxMessageSummary {
  id: string
  threadId: string | null
  sender: string | null
  recipients: string[]
  subject: string
  preview: string
  receivedAt: string
  unread: boolean
  attachmentCount: number
}

export interface CompanyMailboxMessage extends CompanyMailboxMessageSummary {
  textBody: string
  attachments: CompanyMailboxAttachment[]
}

export interface CompanyMailboxMessagePage {
  messages: CompanyMailboxMessageSummary[]
  nextCursor: string | null
  unreadCount: number
  unreadCountCapped: boolean
}

export class CompanyMailboxHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'CompanyMailboxHttpError'
  }
}

const MAILBOX_PATH = '/api/v2/company-mailbox'
const MAILBOX_CHANGED_EVENT = 'memcode:company-mailbox-changed'
const MAILBOX_ERRORS: UserFacingErrorMessages = {
  company_mailbox_admin_required: 'Only an organization admin or owner can configure the company email.',
  company_mailbox_reader_required: 'You do not have permission to read this company inbox.',
  company_mailbox_not_configured: 'Create a company email before opening its inbox.',
  company_mailbox_already_configured: 'This organization already has a company email.',
  company_mailbox_provisioning_in_progress: 'The company email is already being prepared.',
  company_mailbox_provisioning_failed: 'The company email could not be prepared. Try again.',
  company_mailbox_unavailable: 'Company email is temporarily unavailable. Please try again.',
  company_mailbox_message_not_found: 'That email is no longer available.',
  company_mailbox_invalid_request: 'Check the Company Email details and try again.',
  company_mailbox_access_required: 'You no longer have access to configure Company Email for this organization.',
  invalid_company_mailbox_local_part: 'Use lowercase letters, numbers, dots, dashes, or underscores for the email name.',
  company_mailbox_slack_not_connected: 'Connect Slack before sending new Company Email messages to a channel.',
  company_mailbox_slack_channel_invalid: 'Choose an available public Slack channel.',
  company_mailbox_slack_scopes_required: 'Reconnect Slack to allow Company Email delivery to a public channel.',
  company_mailbox_rate_limited: 'Company Email is temporarily rate limited. Wait for the retry window and try again.',
  idempotency_key_required: 'The company email request could not be verified. Refresh and try again.',
  idempotency_conflict: 'This company email request conflicts with an earlier request. Refresh and try again.',
  company_mailbox_idempotency_conflict: 'This Company Email request conflicts with an earlier request. Refresh and try again.',
}

export async function fetchCompanyMailboxSummary(organizationId: string, signal?: AbortSignal) {
  return parseSummaryEnvelope(await requestJson(MAILBOX_PATH + '/summary', {
    method: 'GET',
    signal,
  }, organizationId))
}

export async function createCompanyMailbox(
  organizationId: string,
  input: {
    localPart: string
    displayName?: string
    slackDelivery?: Extract<CompanyMailboxSlackDeliveryInput, { enabled: true }>
  },
  idempotencyKey: string,
) {
  const payload = record(await requestJson(MAILBOX_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requiredString(idempotencyKey, 'idempotency key', 200),
    },
    body: JSON.stringify({
      local_part: requiredString(input.localPart, 'company email name', 64),
      display_name: input.displayName?.trim() ?? '',
      ...(input.slackDelivery ? { slack_delivery: slackDeliveryPayload(input.slackDelivery) } : {}),
    }),
  }, organizationId), 'company mailbox creation response')
  const result = {
    summary: parseSummary(payload.summary ?? payload.mailbox ?? payload),
    replayed: optionalBoolean(payload.replayed) ?? false,
  }
  publishCompanyMailboxChanged()
  return result
}

export async function fetchCompanyMailboxSlackChannels(
  organizationId: string,
  signal?: AbortSignal,
) {
  const payload = record(await requestJson(MAILBOX_PATH + '/slack-channels', {
    method: 'GET',
    signal,
  }, organizationId), 'company mailbox Slack channels response')
  return parseSlackChannels(payload.slack_channels)
}

export async function updateCompanyMailboxSlackDelivery(
  organizationId: string,
  input: CompanyMailboxSlackDeliveryInput,
  idempotencyKey: string,
) {
  const payload = record(await requestJson(MAILBOX_PATH + '/slack-delivery', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requiredString(idempotencyKey, 'idempotency key', 200),
    },
    body: JSON.stringify(slackDeliveryPayload(input)),
  }, organizationId), 'company mailbox Slack delivery response')
  const result = {
    summary: parseSummary(payload.summary ?? payload.mailbox ?? payload),
    replayed: optionalBoolean(payload.replayed) ?? false,
  }
  publishCompanyMailboxChanged()
  return result
}

export async function skipCompanyMailbox(organizationId: string) {
  const payload = record(await requestJson(MAILBOX_PATH + '/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }, organizationId), 'company mailbox skip response')
  const result = {
    summary: parseSummary(payload.summary),
    replayed: optionalBoolean(payload.replayed) ?? false,
  }
  publishCompanyMailboxChanged()
  return result
}

export async function fetchCompanyMailboxMessages(
  organizationId: string,
  input: { cursor?: string; limit?: number; unread?: boolean } = {},
  signal?: AbortSignal,
) {
  const search = new URLSearchParams()
  if (input.cursor) search.set('cursor', input.cursor)
  search.set('limit', String(Math.min(Math.max(input.limit ?? 40, 1), 100)))
  if (typeof input.unread === 'boolean') search.set('unread', String(input.unread))
  return parseMessagePage(await requestJson(`${MAILBOX_PATH}/messages?${search}`, {
    method: 'GET',
    signal,
  }, organizationId))
}

export async function fetchCompanyMailboxMessage(
  organizationId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  const payload = record(await requestJson(
    `${MAILBOX_PATH}/messages/${encodeURIComponent(requiredString(messageId, 'message id', 500))}`,
    { method: 'GET', signal },
    organizationId,
  ), 'company mailbox message response')
  return parseMessage(payload.message ?? payload)
}

export async function setCompanyMailboxMessageUnread(
  organizationId: string,
  messageId: string,
  unread: boolean,
  signal?: AbortSignal,
) {
  const payload = record(await requestJson(
    `${MAILBOX_PATH}/messages/${encodeURIComponent(requiredString(messageId, 'message id', 500))}/read-state`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unread }),
      signal,
    },
    organizationId,
  ), 'company mailbox read state response')
  return parseMessage(payload.message ?? payload)
}

export function subscribeToCompanyMailboxChanges(listener: () => void) {
  window.addEventListener(MAILBOX_CHANGED_EVENT, listener)
  return () => window.removeEventListener(MAILBOX_CHANGED_EVENT, listener)
}

function publishCompanyMailboxChanged() {
  window.dispatchEvent(new Event(MAILBOX_CHANGED_EVENT))
}

async function requestJson(path: string, init: RequestInit, organizationId: string) {
  const response = await fetch(`${BRAIN_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: organizationScopedHeaders({ Accept: 'application/json', ...(init.headers ?? {}) }, organizationId),
  })
  if (!response.ok) {
    const details = await readUserFacingApiError(response, {
      fallback: init.method === 'GET'
        ? 'Company inbox is temporarily unavailable. Please try again.'
        : 'The company email request could not be completed. Please try again.',
      messages: MAILBOX_ERRORS,
      statusMessages: {
        403: 'You do not have permission to use this company inbox.',
        404: 'The requested company email item is no longer available.',
        409: 'The company email is already being prepared or already exists.',
        422: 'Check the company email name and try again.',
        429: 'Company email is refreshing too often. Wait a moment and try again.',
        500: 'Company email is temporarily unavailable. Please try again.',
        502: 'Company email is temporarily unavailable. Please try again.',
        503: 'Company email is temporarily unavailable. Please try again.',
      },
    })
    throw new CompanyMailboxHttpError(
      details.message,
      response.status,
      details.code,
      details.retryAfterMs ?? parseRetryAfter(response.headers.get('Retry-After')),
    )
  }
  return response.json() as Promise<unknown>
}

function parseSummaryEnvelope(value: unknown) {
  const envelope = record(value, 'company mailbox summary response')
  return parseSummary(envelope.summary ?? envelope.mailbox ?? envelope)
}

function parseSummary(value: unknown): CompanyMailboxSummary {
  const summary = record(value, 'company mailbox summary')
  const status = summary.status
  if (
    status !== 'not_configured' && status !== 'skipped' && status !== 'provisioning'
    && status !== 'ready' && status !== 'failed' && status !== 'unavailable'
  ) {
    throw new Error('The company mailbox returned an invalid status.')
  }
  return {
    status,
    address: optionalString(summary.address),
    addressPreview: optionalString(summary.address_preview),
    displayName: optionalString(summary.display_name ?? summary.displayName),
    canManage: requiredBoolean(summary.can_manage, 'company mailbox management permission'),
    unreadCount: nonNegativeInteger(summary.unread_count, 'company mailbox unread count'),
    unreadCountCapped: requiredBoolean(summary.unread_count_capped, 'company mailbox unread count cap'),
    slackDelivery: parseSlackDelivery(summary.slack_delivery),
    lastError: optionalString(summary.last_error),
    updatedAt: optionalString(summary.updated_at),
  }
}

function parseSlackDelivery(value: unknown): CompanyMailboxSlackDelivery {
  if (value === null || value === undefined) {
    return {
      available: false,
      enabled: false,
      teamId: null,
      channelId: null,
      channelName: null,
      lastError: null,
      updatedAt: null,
    }
  }
  const delivery = record(value, 'company mailbox Slack delivery')
  return {
    available: requiredBoolean(delivery.available, 'company mailbox Slack delivery availability'),
    enabled: requiredBoolean(delivery.enabled, 'company mailbox Slack delivery state'),
    teamId: optionalString(delivery.team_id),
    channelId: optionalString(delivery.channel_id),
    channelName: optionalString(delivery.channel_name),
    lastError: optionalString(delivery.last_error),
    updatedAt: optionalString(delivery.updated_at),
  }
}

function parseSlackChannels(value: unknown): CompanyMailboxSlackChannels {
  const slackChannels = record(value, 'company mailbox Slack channels')
  const status = slackChannels.status
  if (status !== 'not_connected' && status !== 'ready' && status !== 'unavailable') {
    throw new Error('The company mailbox returned an invalid Slack channel status.')
  }
  const channels = array(slackChannels.channels)
  if (channels.length > 5_000) {
    throw new Error('The company mailbox returned too many Slack channels.')
  }
  return {
    status,
    teamId: optionalString(slackChannels.team_id),
    channels: channels.map((value) => {
      const channel = record(value, 'company mailbox Slack channel')
      return {
        id: requiredString(channel.id, 'Slack channel id', 200),
        name: requiredString(channel.name, 'Slack channel name', 200),
        isMember: requiredBoolean(channel.is_member, 'Slack channel membership'),
      }
    }),
  }
}

function slackDeliveryPayload(input: CompanyMailboxSlackDeliveryInput) {
  if (!input.enabled) return { enabled: false }
  return {
    enabled: true,
    team_id: requiredString(input.teamId, 'Slack workspace id', 200),
    channel_id: requiredString(input.channelId, 'Slack channel id', 200),
  }
}

function parseMessagePage(value: unknown): CompanyMailboxMessagePage {
  const envelope = record(value, 'company mailbox messages response')
  const messages = array(envelope.messages).slice(0, 100).map(parseMessageSummary)
  return {
    messages,
    nextCursor: optionalString(envelope.next_cursor),
    unreadCount: nonNegativeInteger(envelope.unread_count, 'company mailbox unread count'),
    unreadCountCapped: requiredBoolean(envelope.unread_count_capped, 'company mailbox unread count cap'),
  }
}

function parseMessageSummary(value: unknown): CompanyMailboxMessageSummary {
  const message = record(value, 'company mailbox message')
  return {
    id: requiredString(message.id, 'message id', 500),
    threadId: optionalString(message.thread_id),
    sender: optionalString(message.sender),
    recipients: array(message.recipients).slice(0, 100).map((recipient) => (
      requiredString(recipient, 'mail recipient', 500)
    )),
    subject: optionalString(message.subject) ?? '(no subject)',
    preview: optionalString(message.preview) ?? '',
    receivedAt: requiredString(message.received_at, 'message received time', 100),
    unread: requiredBoolean(message.is_unread, 'message unread state'),
    attachmentCount: nonNegativeInteger(message.attachment_count, 'message attachment count'),
  }
}

function parseMessage(value: unknown): CompanyMailboxMessage {
  const message = record(value, 'company mailbox message')
  return {
    ...parseMessageSummary(message),
    textBody: optionalString(message.text_body) ?? '',
    attachments: array(message.attachments).slice(0, 100).map(parseAttachment),
  }
}

function parseAttachment(value: unknown): CompanyMailboxAttachment {
  const attachment = record(value, 'mail attachment')
  return {
    id: requiredString(attachment.id, 'attachment id', 500),
    filename: optionalString(attachment.filename) ?? 'Attachment',
    contentType: optionalString(attachment.content_type),
    sizeBytes: attachment.size_bytes === null || attachment.size_bytes === undefined
      ? null
      : nonNegativeInteger(attachment.size_bytes, 'attachment size'),
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return undefined
  return Math.max(0, at - Date.now())
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} was invalid.`)
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('The company mailbox returned an invalid list.')
  return value
}

function requiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label} was invalid.`)
  return value.trim()
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('The company mailbox returned invalid text.')
  return value
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} was invalid.`)
  return value
}

function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} was invalid.`)
  return value
}
