import { BRAIN_API_URL } from './api'
import { organizationScopedHeaders } from './brain-organization-context'
import { ONBOARDING_ERROR_MESSAGES, readUserFacingApiError } from './user-facing-errors'

export type CompanyOnboardingStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'completed'

export type CompanyResearchCardStatus = 'pending' | 'running' | 'ready' | 'partial' | 'failed' | 'unavailable'

export interface CompanyResearchSource {
  id: string
  title: string
  url: string
  publishedAt?: string
}

export interface CompanyResearchClaim {
  text: string
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  sourceIds: string[]
}

export interface CompanyResearchCard {
  key: string
  label: string
  status: CompanyResearchCardStatus
  summary: string
  stats: Array<{ label: string; value: string }>
  highlights: string[]
  claims: CompanyResearchClaim[]
  sourceIds: string[]
  updatedAt?: string
}

export interface CompanyResearchPhase {
  key: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  detail?: string
}

export interface CompanyResearchRun {
  id: string
  revision: number
  domain: string
  status: Exclude<CompanyOnboardingStatus, 'not_started' | 'completed'> | 'partial'
  phase: string
  progress: number
  memoryStatus: 'deferred' | 'pending' | 'processing' | 'ready' | 'partial' | 'failed' | 'unavailable'
  cards: CompanyResearchCard[]
  sources: CompanyResearchSource[]
  phases: CompanyResearchPhase[]
  error?: string
  createdAt?: string
  updatedAt?: string
}

export const COMPANY_RESEARCH_EDIT_LIMITS = {
  summaryLength: 4_000,
  highlights: 12,
  highlightLength: 1_000,
} as const

export interface CompanyResearchCardUpdateInput {
  runId: string
  cardKey: string
  revision: number
  summary: string
  highlights: string[]
}

export interface CompanyOnboardingSnapshot {
  status: CompanyOnboardingStatus
  version: number
  canManage: boolean
  slackConnected: boolean
  researchAvailable: boolean
  researchAttempts: number
  researchAttemptLimit: number
  organizationName?: string
  primaryDomain?: string
  slackConnectPath?: string
  run: CompanyResearchRun | null
}

export type SlackHistoryProvisioningStatus = 'not_connected' | 'provisioning' | 'ready'

export interface SlackHistoryChannel {
  id: string
  name: string
  topic?: string
  purpose?: string
  isMember?: boolean
}

export interface SlackHistoryChannels {
  status: SlackHistoryProvisioningStatus
  teamId?: string
  channels: SlackHistoryChannel[]
}

export interface SlackHistorySyncRun {
  id: string
  status: string
  phase: string
  teamId: string | null
  channelIds: string[]
  windowDays: number
  windowStart: string | null
  windowEnd: string | null
  requiresConfirmation: boolean
  syncStarted: boolean
  estimatedMessageCount: number | null
  processedMessageCount: number
  committedMessageCount: number
  syncedBackThrough: string | null
  messageLimitPerDay: number | null
  estimatedProcessingDays: number | null
  estimatedDaysRemaining: number | null
  nextBatchAt: string | null
  pricing: SlackHistoryPricing | null
  createdAt: string | null
  updatedAt: string | null
  lastError: string | null
}

export interface SlackHistoryPricing {
  currency: string
  unitMessages: number
  unitPriceCents: number
  listPriceCents: number
  finalPriceCents: number
  promotionLabel: string | null
}

export interface SlackHistorySyncResult {
  run: SlackHistorySyncRun
  replayed: boolean
}

export class CompanyOnboardingHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'CompanyOnboardingHttpError'
  }
}

const ONBOARDING_PATH = '/api/v2/onboarding'
const SLACK_HISTORY_PATH = `${ONBOARDING_PATH}/slack-history`
const MAX_CARDS = 16
const MAX_SOURCES = 160
const MAX_SLACK_CHANNELS = 5_000
const MAX_SLACK_HISTORY_WINDOW_DAYS = 365

export async function fetchCompanyOnboarding(signal?: AbortSignal) {
  return parseSnapshot(await requestJson(ONBOARDING_PATH, { signal }))
}

export async function startCompanyResearch(domain: string, idempotencyKey: string) {
  const payload = await requestJson(`${ONBOARDING_PATH}/research`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ domain }),
  })
  return parseSnapshot(payload)
}

export async function completeCompanyOnboarding(runId: string) {
  const payload = await requestJson(`${ONBOARDING_PATH}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: requiredString(runId, 'research run id', 200) }),
  })
  return parseSnapshot(payload)
}

export async function updateCompanyResearchCard(input: CompanyResearchCardUpdateInput) {
  const runId = requiredInputString(input.runId, 'research run id', 200)
  const cardKey = requiredInputString(input.cardKey, 'research card key', 100)
  const revision = boundedInteger(input.revision, 1, Number.MAX_SAFE_INTEGER, 0)
  if (revision === 0) throw new Error('The research brief changed. Refresh and try again.')

  const summary = requiredInputString(
    input.summary,
    'research card summary',
    COMPANY_RESEARCH_EDIT_LIMITS.summaryLength,
  )
  if (!Array.isArray(input.highlights) || input.highlights.length > COMPANY_RESEARCH_EDIT_LIMITS.highlights) {
    throw new Error(`Use up to ${COMPANY_RESEARCH_EDIT_LIMITS.highlights} highlights.`)
  }
  const highlights = input.highlights.map((highlight) => requiredInputString(
    highlight,
    'research card highlight',
    COMPANY_RESEARCH_EDIT_LIMITS.highlightLength,
  ))

  const payload = await requestJson(
    `${ONBOARDING_PATH}/research/${encodeURIComponent(runId)}/cards/${encodeURIComponent(cardKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, summary, highlights }),
    },
  )
  return parseSnapshot(payload)
}

export async function fetchSlackHistoryChannels(signal?: AbortSignal) {
  const payload = await requestJson(`${SLACK_HISTORY_PATH}/channels`, { signal })
  return parseSlackHistoryChannels(payload)
}

export async function queueSlackHistorySync(
  channelIds: string[],
  windowDays: number,
  idempotencyKey: string,
  enableProactivity: boolean,
): Promise<SlackHistorySyncResult> {
  const normalizedChannelIds = normalizeSlackChannelIds(channelIds)
  const payload = await requestJson(SLACK_HISTORY_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requiredString(idempotencyKey, 'idempotency key', 200),
    },
    body: JSON.stringify({
      channel_ids: normalizedChannelIds,
      window_days: normalizeSlackWindowDays(windowDays),
      enable_proactivity: enableProactivity,
    }),
  })
  return parseSlackHistorySyncResult(payload)
}

export async function estimateSlackHistorySync(
  channelIds: string[],
  windowDays: number,
  idempotencyKey: string,
): Promise<SlackHistorySyncResult> {
  const payload = await requestJson(`${SLACK_HISTORY_PATH}/estimate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requiredString(idempotencyKey, 'idempotency key', 200),
    },
    body: JSON.stringify({
      channel_ids: normalizeSlackChannelIds(channelIds),
      window_days: normalizeSlackWindowDays(windowDays),
    }),
  })
  return parseSlackHistorySyncResult(payload)
}

export async function fetchSlackHistorySyncRun(runId: string, signal?: AbortSignal) {
  const id = encodeURIComponent(requiredString(runId, 'Slack history sync id', 200))
  return parseSlackHistorySyncRun(await requestJson(`${SLACK_HISTORY_PATH}/${id}`, { signal }))
}

export async function startEstimatedSlackHistorySync(
  runId: string,
  idempotencyKey: string,
  enableProactivity: boolean,
): Promise<SlackHistorySyncResult> {
  const id = encodeURIComponent(requiredString(runId, 'Slack history sync id', 200))
  const payload = await requestJson(`${SLACK_HISTORY_PATH}/${id}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requiredString(idempotencyKey, 'idempotency key', 200),
    },
    body: JSON.stringify({ enable_proactivity: enableProactivity }),
  })
  return parseSlackHistorySyncResult(payload)
}

export async function fetchCurrentSlackHistorySync(signal?: AbortSignal) {
  const payload = record(await requestJson(`${SLACK_HISTORY_PATH}/current`, { signal }), 'current Slack history sync')
  if (payload.run === null || payload.run === undefined) return null
  return parseSlackHistorySyncRun(payload.run)
}

async function requestJson(path: string, init: RequestInit = {}) {
  const headers = organizationScopedHeaders(init.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(`${BRAIN_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<unknown>
}

async function responseError(response: Response) {
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
  const details = await readUserFacingApiError(response, {
    fallback: 'Company onboarding is temporarily unavailable. Please try again.',
    messages: ONBOARDING_ERROR_MESSAGES,
  })
  return new CompanyOnboardingHttpError(details.message, response.status, details.code, retryAfterMs)
}

function parseSnapshot(value: unknown): CompanyOnboardingSnapshot {
  const envelope = record(value, 'onboarding')
  const candidate = isRecord(envelope.onboarding) ? envelope.onboarding : envelope
  const status = onboardingStatus(candidate.status)
  const runCandidate = candidate.run ?? candidate.current_run ?? candidate.research
  const run = runCandidate === null || runCandidate === undefined
    ? null
    : parseRun(runCandidate)
  const organization = isRecord(candidate.organization) ? candidate.organization : null

  return {
    status,
    version: boundedInteger(candidate.version, 0, 100, 0),
    canManage: boolean(candidate.can_manage ?? candidate.canManage, false),
    slackConnected: boolean(candidate.slack_connected ?? candidate.slackConnected, false),
    researchAvailable: boolean(candidate.research_available ?? candidate.researchAvailable, false),
    researchAttempts: boundedInteger(candidate.research_attempts, 0, 100, 0),
    researchAttemptLimit: boundedInteger(candidate.research_attempt_limit, 1, 100, 3),
    ...(optionalString(candidate.organization_name)
      ? { organizationName: cleanText(String(candidate.organization_name), 200) }
      : optionalString(organization?.name)
        ? { organizationName: cleanText(String(organization?.name), 200) }
        : {}),
    ...(optionalString(candidate.primary_domain)
      ? { primaryDomain: cleanDomain(String(candidate.primary_domain)) }
      : optionalString(organization?.domain)
        ? { primaryDomain: cleanDomain(String(organization?.domain)) }
        : {}),
    ...(safeSlackPath(candidate.slack_connect_url ?? candidate.slack_connect_endpoint)
      ? { slackConnectPath: safeSlackPath(candidate.slack_connect_url ?? candidate.slack_connect_endpoint) as string }
      : {}),
    run,
  }
}

function parseSlackHistoryChannels(value: unknown): SlackHistoryChannels {
  const envelope = record(value, 'Slack history channels')
  const candidate = record(envelope.slack_history ?? envelope, 'Slack history')
  const status = candidate.status
  if (status !== 'not_connected' && status !== 'provisioning' && status !== 'ready') {
    throw new Error('Invalid Slack history provisioning status.')
  }

  const seen = new Set<string>()
  const channels = array(candidate.channels)
    .slice(0, MAX_SLACK_CHANNELS)
    .map((value) => {
      const channel = record(value, 'Slack history channel')
      const id = requiredString(channel.id, 'Slack history channel id', 200)
      return {
        id,
        name: requiredString(channel.name, 'Slack history channel name', 200),
        ...(optionalString(channel.topic)
          ? { topic: cleanText(String(channel.topic), 1_000) }
          : {}),
        ...(optionalString(channel.purpose)
          ? { purpose: cleanText(String(channel.purpose), 1_000) }
          : {}),
        ...(typeof channel.is_member === 'boolean'
          ? { isMember: channel.is_member }
          : typeof channel.isMember === 'boolean'
            ? { isMember: channel.isMember }
            : {}),
      }
    })
    .filter((channel) => {
      if (seen.has(channel.id)) return false
      seen.add(channel.id)
      return true
    })

  return {
    status,
    ...(optionalString(candidate.team_id ?? candidate.teamId)
      ? { teamId: cleanText(String(candidate.team_id ?? candidate.teamId), 200) }
      : {}),
    channels,
  }
}

export function parseSlackHistorySyncRun(value: unknown): SlackHistorySyncRun {
  const envelope = record(value, 'Slack history sync')
  const slackHistory = isRecord(envelope.slack_history) ? envelope.slack_history : null
  const candidate = record(
    envelope.sync
      ?? envelope.run
      ?? slackHistory?.sync
      ?? slackHistory?.run
      ?? slackHistory
      ?? envelope,
    'Slack history sync run',
  )
  const pricing = candidate.pricing === null || candidate.pricing === undefined
    ? null
    : parseSlackHistoryPricing(candidate.pricing)
  return {
    id: requiredString(candidate.id ?? candidate.run_id ?? candidate.sync_id, 'Slack history sync id', 200),
    status: requiredString(candidate.status, 'Slack history sync status', 120),
    phase: requiredString(candidate.phase ?? candidate.status, 'Slack history sync phase', 120),
    teamId: cleanOptionalText(candidate.team_id ?? candidate.teamId, 200),
    channelIds: stringArray(candidate.channel_ids ?? candidate.channelIds, MAX_SLACK_CHANNELS, 200),
    windowDays: boundedInteger(
      candidate.window_days ?? candidate.windowDays,
      1,
      MAX_SLACK_HISTORY_WINDOW_DAYS,
      7,
    ),
    windowStart: cleanOptionalText(candidate.window_start ?? candidate.windowStart, 100),
    windowEnd: cleanOptionalText(candidate.window_end ?? candidate.windowEnd, 100),
    requiresConfirmation: boolean(
      candidate.requires_confirmation ?? candidate.requiresConfirmation,
      false,
    ),
    syncStarted: boolean(candidate.sync_started ?? candidate.syncStarted, false),
    estimatedMessageCount: nullableNonNegativeInteger(
      candidate.estimated_message_count ?? candidate.estimatedMessageCount,
    ),
    processedMessageCount: nonNegativeInteger(
      candidate.processed_message_count ?? candidate.processedMessageCount,
    ),
    committedMessageCount: nonNegativeInteger(
      candidate.committed_message_count ?? candidate.committedMessageCount,
    ),
    syncedBackThrough: cleanOptionalText(
      candidate.synced_back_through ?? candidate.syncedBackThrough,
      100,
    ),
    messageLimitPerDay: nullablePositiveInteger(
      candidate.message_limit_per_day ?? candidate.messageLimitPerDay,
    ),
    estimatedProcessingDays: nullableNonNegativeNumber(
      candidate.estimated_processing_days ?? candidate.estimatedProcessingDays,
    ),
    estimatedDaysRemaining: nullableNonNegativeNumber(
      candidate.estimated_days_remaining ?? candidate.estimatedDaysRemaining,
    ),
    nextBatchAt: cleanOptionalText(candidate.next_batch_at ?? candidate.nextBatchAt, 100),
    pricing,
    createdAt: cleanOptionalText(candidate.created_at ?? candidate.createdAt, 100),
    updatedAt: cleanOptionalText(candidate.updated_at ?? candidate.updatedAt, 100),
    lastError: cleanOptionalText(candidate.last_error ?? candidate.lastError, 1_000),
  }
}

function parseSlackHistorySyncResult(value: unknown): SlackHistorySyncResult {
  const envelope = record(value, 'Slack history sync result')
  return {
    run: parseSlackHistorySyncRun(envelope.run ?? envelope),
    replayed: boolean(envelope.replayed, false),
  }
}

function parseSlackHistoryPricing(value: unknown): SlackHistoryPricing {
  const pricing = record(value, 'Slack history pricing')
  return {
    currency: requiredString(pricing.currency, 'Slack history pricing currency', 10).toUpperCase(),
    unitMessages: positiveInteger(pricing.unit_messages ?? pricing.unitMessages, 1),
    unitPriceCents: nonNegativeInteger(pricing.unit_price_cents ?? pricing.unitPriceCents),
    listPriceCents: nonNegativeInteger(pricing.list_price_cents ?? pricing.listPriceCents),
    finalPriceCents: nonNegativeInteger(pricing.final_price_cents ?? pricing.finalPriceCents),
    promotionLabel: cleanOptionalText(pricing.promotion_label ?? pricing.promotionLabel, 200),
  }
}

function normalizeSlackChannelIds(channelIds: string[]) {
  const normalizedChannelIds = [...new Set(channelIds.map((channelId) => (
    requiredString(channelId, 'Slack channel id', 200)
  )))].slice(0, MAX_SLACK_CHANNELS)
  if (normalizedChannelIds.length === 0) {
    throw new Error('Select at least one Slack channel to sync.')
  }
  return normalizedChannelIds
}

function normalizeSlackWindowDays(windowDays: number) {
  if (
    !Number.isSafeInteger(windowDays)
    || windowDays < 1
    || windowDays > MAX_SLACK_HISTORY_WINDOW_DAYS
  ) {
    throw new Error(`Choose a Slack history window from 1 to ${MAX_SLACK_HISTORY_WINDOW_DAYS} days.`)
  }
  return windowDays
}

function parseRun(value: unknown): CompanyResearchRun {
  const run = record(value, 'research run')
  const rawStatus = run.status === 'partial' ? 'partial' : onboardingStatus(run.status)
  if (rawStatus === 'not_started' || rawStatus === 'completed') {
    throw new Error('Invalid company research run status.')
  }
  const rawCards = array(run.cards ?? run.insights).slice(0, MAX_CARDS)
  const rawSources = array(run.sources).slice(0, MAX_SOURCES)
  const rawPhases = array(run.phases ?? run.events).slice(0, 40)

  return {
    id: requiredString(run.id ?? run.run_id, 'research run id', 200),
    revision: boundedInteger(run.revision, 1, Number.MAX_SAFE_INTEGER, 0),
    domain: cleanDomain(requiredString(run.domain, 'research domain', 253)),
    status: rawStatus,
    phase: cleanText(optionalString(run.phase) ?? rawStatus, 120),
    progress: parseProgress(run.progress ?? run.progress_percent, progressFor(rawStatus)),
    memoryStatus: memoryStatus(run.memory_status ?? run.memoryStatus),
    cards: rawCards.map(parseCard),
    sources: rawSources.map(parseSource),
    phases: rawPhases.map(parsePhase),
    ...(optionalString(run.error ?? run.last_error)
      ? { error: cleanText(String(run.error ?? run.last_error), 500) }
      : {}),
    ...(optionalString(run.created_at ?? run.createdAt)
      ? { createdAt: cleanText(String(run.created_at ?? run.createdAt), 100) }
      : {}),
    ...(optionalString(run.updated_at ?? run.updatedAt)
      ? { updatedAt: cleanText(String(run.updated_at ?? run.updatedAt), 100) }
      : {}),
  }
}

function parseCard(value: unknown): CompanyResearchCard {
  const card = record(value, 'research card')
  const key = requiredString(card.key ?? card.aspect ?? card.id, 'research card key', 100)
  const rawStats = array(card.stats).slice(0, 12)
  const rawClaims = array(card.claims).slice(0, 40)
  const sourceIds = stringArray(card.source_ids ?? card.sourceIds, 80, 200)

  return {
    key,
    label: cleanText(optionalString(card.label ?? card.title) ?? formatKey(key), 120),
    status: cardStatus(card.status),
    summary: cleanText(optionalString(card.summary) ?? '', 8_000),
    stats: rawStats.map((value) => {
      const stat = record(value, 'research stat')
      return {
        label: requiredString(stat.label, 'research stat label', 120),
        value: requiredString(stat.value, 'research stat value', 200),
      }
    }),
    highlights: stringArray(card.highlights, 24, 1_000),
    claims: rawClaims.map(parseClaim),
    sourceIds,
    ...(optionalString(card.updated_at ?? card.updatedAt)
      ? { updatedAt: cleanText(String(card.updated_at ?? card.updatedAt), 100) }
      : {}),
  }
}

function parseClaim(value: unknown): CompanyResearchClaim {
  const claim = record(value, 'research claim')
  const rawConfidence = optionalString(claim.confidence)?.toLowerCase()
  const confidence = rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
    ? rawConfidence
    : 'unknown'
  return {
    text: requiredString(claim.text, 'research claim text', 2_000),
    confidence,
    sourceIds: stringArray(claim.source_ids ?? claim.sourceIds, 20, 200),
  }
}

function parseSource(value: unknown): CompanyResearchSource {
  const source = record(value, 'research source')
  const url = new URL(requiredString(source.url, 'research source URL', 2_000))
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid research source URL.')
  }
  return {
    id: requiredString(source.id ?? source.source_id, 'research source id', 200),
    title: cleanText(optionalString(source.title) ?? url.hostname, 300),
    url: url.toString(),
    ...(optionalString(source.published_at ?? source.publishedAt)
      ? { publishedAt: cleanText(String(source.published_at ?? source.publishedAt), 100) }
      : {}),
  }
}

function parsePhase(value: unknown): CompanyResearchPhase {
  const phase = record(value, 'research phase')
  const rawStatus = optionalString(phase.status)
  if (rawStatus !== 'pending' && rawStatus !== 'running' && rawStatus !== 'done' && rawStatus !== 'failed') {
    throw new Error('Invalid research phase status.')
  }
  const key = requiredString(phase.key ?? phase.phase ?? phase.id, 'research phase key', 100)
  return {
    key,
    label: cleanText(optionalString(phase.label ?? phase.title) ?? formatKey(key), 160),
    status: rawStatus,
    ...(optionalString(phase.detail ?? phase.message)
      ? { detail: cleanText(String(phase.detail ?? phase.message), 500) }
      : {}),
  }
}

function onboardingStatus(value: unknown): CompanyOnboardingStatus {
  if (
    value === 'not_started'
    || value === 'queued'
    || value === 'running'
    || value === 'ready'
    || value === 'failed'
    || value === 'completed'
  ) return value
  if (value === 'researching') return 'running'
  throw new Error('Invalid company onboarding status.')
}

function cardStatus(value: unknown): CompanyResearchCardStatus {
  if (
    value === 'pending'
    || value === 'running'
    || value === 'ready'
    || value === 'partial'
    || value === 'failed'
    || value === 'unavailable'
  ) {
    return value
  }
  return 'unavailable'
}

function memoryStatus(value: unknown): CompanyResearchRun['memoryStatus'] {
  if (
    value === 'pending'
    || value === 'processing'
    || value === 'ready'
    || value === 'partial'
    || value === 'failed'
    || value === 'unavailable'
  ) return value
  return 'deferred'
}

function progressFor(status: CompanyResearchRun['status']) {
  if (status === 'ready' || status === 'partial') return 100
  if (status === 'queued') return 5
  if (status === 'failed') return 100
  return 35
}

function parseProgress(value: unknown, fallback: number) {
  if (isRecord(value)) return boundedNumber(value.percent, 0, 100, fallback)
  return boundedNumber(value, 0, 100, fallback)
}

function safeSlackPath(value: unknown) {
  const path = optionalString(value)
  if (!path) return null
  return path === '/api/v2/integrations/slack/connect' ? path : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label} response.`)
  return value
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function cleanOptionalText(value: unknown, maximum: number) {
  const string = optionalString(value)
  return string ? cleanText(string, maximum) : null
}

function requiredString(value: unknown, label: string, maximum: number) {
  const string = optionalString(value)
  if (!string) throw new Error(`Invalid ${label} response.`)
  return cleanText(string, maximum)
}

function requiredInputString(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`)
  const normalized = cleanText(value, maximum + 1)
  if (!normalized || normalized.length > maximum) throw new Error(`Invalid ${label}.`)
  return normalized
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .slice(0, maximumItems)
    .map((item) => cleanText(item, maximumLength))
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function nullableNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function nullablePositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nullableNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

function cleanText(value: string, maximum: number) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum)
}

function cleanDomain(value: string) {
  return cleanText(value, 253).toLowerCase().replace(/\.$/u, '')
}

function formatKey(value: string) {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
