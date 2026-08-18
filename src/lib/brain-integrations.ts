import { BRAIN_API_URL } from './api'
import {
  getActiveBrainOrganizationId,
  organizationScopedHeaders,
} from './brain-organization-context'
import {
  INTEGRATION_ERROR_MESSAGES,
  readUserFacingApiError,
} from './user-facing-errors'

export type BrainIntegrationScope = 'personal' | 'organization'
export type BrainIntegrationAvailability = 'available' | 'coming_soon'
export type BrainIntegrationStatus = 'active' | 'disabled' | 'error' | 'offline' | 'coming_soon'
export type BrainIntegrationKind = 'slack' | 'connected_app' | 'client_mcp' | 'custom_connection' | 'planned_provider'
export type BrainIntegrationAuthType = 'oauth' | 'static' | 'none'
export type BrainIntegrationCustomAuthMode = 'none' | 'bearer' | 'x-api-key'
export type BrainIntegrationClient = 'codex' | 'claude-code' | 'cursor'
export type BrainIntegrationClientEnvironmentVariable =
  | 'MEMCODE_BRAIN_CODEX_TOKEN'
  | 'MEMCODE_BRAIN_CLAUDE_CODE_TOKEN'
  | 'MEMCODE_BRAIN_CURSOR_TOKEN'

export interface BrainIntegrationCapability {
  id: string
  name: string
  description: string
  supported: boolean
  enabled: boolean
  configurable: boolean
}

export interface BrainIntegrationExecutionPolicy {
  read_operations: boolean
  approved_writes: boolean
  editable: boolean
  update_path: string | null
}

export interface BrainIntegrationConnection {
  id: string
  scope: BrainIntegrationScope
  endpoint_host?: string
  status: string
  scopes: string[]
  created_at: string
  updated_at: string
  owned_by_viewer: boolean
  configuration: {
    enabled: boolean
    editable: boolean
    update_path: string | null
  }
  execution_policy: BrainIntegrationExecutionPolicy
  revoke_path: string | null
}

export type BrainIntegrationExecutionPolicyUpdate =
  | { read_operations: boolean; approved_writes?: boolean }
  | { read_operations?: boolean; approved_writes: boolean }

export interface BrainIntegrationAction {
  enabled: boolean
  method: 'POST'
  path: string | null
  reason: string | null
}

export interface BrainIntegration {
  slug: string
  name: string
  category: string
  description: string
  version: string
  kind: BrainIntegrationKind
  availability: BrainIntegrationAvailability
  status: BrainIntegrationStatus
  status_reason: string | null
  auth_type: BrainIntegrationAuthType
  scope_options: BrainIntegrationScope[]
  utilization: number | null
  last_sync_at: string | null
  capabilities: BrainIntegrationCapability[]
  connections: BrainIntegrationConnection[]
  actions: {
    connect: BrainIntegrationAction
    reconnect: BrainIntegrationAction
  }
}

export interface BrainIntegrationClientSetup {
  client: BrainIntegrationClient
  server_url: string
  token: string
  expires_at: string
  environment_variable: BrainIntegrationClientEnvironmentVariable
  commands: string[]
  config: string
}

export type BrainIntegrationConnectResponse =
  | { type: 'oauth'; authorizationUrl: string }
  | { type: 'client'; setup: BrainIntegrationClientSetup }
  | { type: 'custom'; connection: BrainIntegrationConnection }

export type BrainIntegrationConnectBody =
  | {
      scope?: BrainIntegrationScope
      connection_id?: string
      redirect_url: string
    }
  | { memory_write: boolean; tool_execution: boolean }
  | {
      endpoint_url: string
      auth_mode: BrainIntegrationCustomAuthMode
      secret?: string
      scope: BrainIntegrationScope
    }
  | {
      scope: BrainIntegrationScope
      secret: string
    }

const CLIENT_PRESENTATION: Record<string, { name: string; description: string; version: string }> = {
  'codex-mcp': {
    name: 'Codex',
    description: 'Give Codex permission-scoped access to Company Brain.',
    version: 'Secure access',
  },
  'claude-mcp': {
    name: 'Claude Code',
    description: 'Give Claude Code permission-scoped access to Company Brain.',
    version: 'Secure access',
  },
  'cursor-mcp': {
    name: 'Cursor',
    description: 'Give Cursor permission-scoped access to Company Brain.',
    version: 'Secure access',
  },
}

const CUSTOM_CONNECTION_PRESENTATION = {
  name: 'Custom MCP',
  description: 'Connect a server hosted on a deployment-approved domain.',
  version: 'Admin allowlist',
} as const

const COMPANY_MAIL_PRESENTATION = {
  name: 'Company email',
  description: 'Give the organization one shared inbox for governed mail reads and approved sends.',
  version: 'Organization inbox',
} as const

function withoutMailboxProviderBrand(value: string | null) {
  return value?.replace(/agentmail(?:\.to)?/giu, 'company email') ?? null
}

function withoutMailboxProviderEndpoint(connection: BrainIntegrationConnection) {
  const sanitized = { ...connection }
  delete sanitized.endpoint_host
  return sanitized
}

const CLIENT_ENVIRONMENT_VARIABLES = {
  codex: 'MEMCODE_BRAIN_CODEX_TOKEN',
  'claude-code': 'MEMCODE_BRAIN_CLAUDE_CODE_TOKEN',
  cursor: 'MEMCODE_BRAIN_CURSOR_TOKEN',
} as const satisfies Record<BrainIntegrationClient, BrainIntegrationClientEnvironmentVariable>

export class BrainIntegrationHttpError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'BrainIntegrationHttpError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`Invalid ${label} response.`)
  return value
}

function expectString(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} response.`)
  return value
}

function expectBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label} response.`)
  return value
}

function expectNullableString(value: unknown, label: string) {
  if (value === null) return null
  return expectString(value, label)
}

function expectStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ${label} response.`)
  }
  return value as string[]
}

function parseScope(value: unknown, label: string): BrainIntegrationScope {
  if (value !== 'personal' && value !== 'organization') throw new Error(`Invalid ${label} response.`)
  return value
}

function parseKind(value: unknown): BrainIntegrationKind {
  if (!['slack', 'connected_app', 'client_mcp', 'custom_connection', 'planned_provider'].includes(String(value))) {
    throw new Error('Invalid integration kind response.')
  }
  return value as BrainIntegrationKind
}

function parseActionPath(value: unknown, label: string) {
  const path = expectNullableString(value, label)
  if (path !== null && (
    !/^\/api\/v2\/integrations(?:\/|$)/.test(path)
    || path.includes('\\')
    || /(?:^|\/)\.\.(?:\/|$)/.test(path)
    || /%2e/iu.test(path)
    || /[?#]/u.test(path)
  )) {
    throw new Error(`Invalid ${label} response.`)
  }
  return path
}

function parseAction(value: unknown, label: string): BrainIntegrationAction {
  const action = expectRecord(value, label)
  if (action.method !== 'POST') throw new Error(`Invalid ${label} response.`)
  return {
    enabled: expectBoolean(action.enabled, `${label}.enabled`),
    method: 'POST',
    path: parseActionPath(action.path, `${label}.path`),
    reason: expectNullableString(action.reason, `${label}.reason`),
  }
}

function withoutClientProtocolJargon(value: string | null) {
  if (value === null) return null
  return value
    .replace(/authenticated inbound MCP server/giu, 'authenticated client access')
    .replace(/\bMCP\b/giu, 'client access')
}

function parseCapability(value: unknown): BrainIntegrationCapability {
  const capability = expectRecord(value, 'integration capability')
  const id = expectString(capability.id, 'integration capability id')
  const name = expectString(capability.name, 'integration capability name')
  return {
    id,
    name: id === 'approved_writes'
      ? 'Writes with approval'
      : name,
    description: expectString(capability.description, 'integration capability description'),
    supported: expectBoolean(capability.supported, 'integration capability supported'),
    enabled: expectBoolean(capability.enabled, 'integration capability enabled'),
    configurable: expectBoolean(capability.configurable, 'integration capability configurable'),
  }
}

function parseOptionalEndpointHost(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const host = expectString(value, 'integration connection endpoint_host')
  const labels = host.split('.')
  if (
    !host || host.length > 253 || host !== host.toLowerCase()
    || labels.some((label) => (
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ))
  ) {
    throw new Error('Invalid integration connection endpoint_host response.')
  }
  return host
}

function parseConnection(value: unknown): BrainIntegrationConnection {
  const connection = expectRecord(value, 'integration connection')
  const configuration = expectRecord(connection.configuration, 'integration connection configuration')
  const executionPolicy = connection.execution_policy === undefined
    ? null
    : expectRecord(connection.execution_policy, 'integration connection execution_policy')
  const endpointHost = parseOptionalEndpointHost(connection.endpoint_host)
  return {
    id: expectString(connection.id, 'integration connection id'),
    scope: parseScope(connection.scope, 'integration connection scope'),
    ...(endpointHost ? { endpoint_host: endpointHost } : {}),
    status: expectString(connection.status, 'integration connection status'),
    scopes: expectStringArray(connection.scopes, 'integration connection scopes'),
    created_at: expectString(connection.created_at, 'integration connection created_at'),
    updated_at: expectString(connection.updated_at, 'integration connection updated_at'),
    owned_by_viewer: expectBoolean(connection.owned_by_viewer, 'integration connection owned_by_viewer'),
    configuration: {
      enabled: expectBoolean(configuration.enabled, 'integration connection enabled'),
      editable: expectBoolean(configuration.editable, 'integration connection editable'),
      update_path: parseActionPath(configuration.update_path, 'integration connection update_path'),
    },
    execution_policy: {
      read_operations: executionPolicy === null
        ? true
        : expectBoolean(
          executionPolicy.read_operations,
          'integration connection execution_policy.read_operations',
        ),
      approved_writes: executionPolicy === null
        ? true
        : expectBoolean(
          executionPolicy.approved_writes,
          'integration connection execution_policy.approved_writes',
        ),
      editable: executionPolicy === null
        ? false
        : expectBoolean(
          executionPolicy.editable,
          'integration connection execution_policy.editable',
        ),
      update_path: executionPolicy === null
        ? null
        : parseActionPath(
          executionPolicy.update_path,
          'integration connection execution_policy.update_path',
        ),
    },
    revoke_path: parseActionPath(connection.revoke_path, 'integration connection revoke_path'),
  }
}

function parseIntegration(value: unknown): BrainIntegration {
  const integration = expectRecord(value, 'integration')
  const actions = expectRecord(integration.actions, 'integration actions')
  const availability = integration.availability
  const status = integration.status
  const authType = integration.auth_type

  if (availability !== 'available' && availability !== 'coming_soon') {
    throw new Error('Invalid integration availability response.')
  }
  if (!['active', 'disabled', 'error', 'offline', 'coming_soon'].includes(String(status))) {
    throw new Error('Invalid integration status response.')
  }
  if (authType !== 'oauth' && authType !== 'static' && authType !== 'none') {
    throw new Error('Invalid integration auth_type response.')
  }
  if (!Array.isArray(integration.scope_options)) throw new Error('Invalid integration scope_options response.')
  if (integration.utilization !== null && typeof integration.utilization !== 'number') {
    throw new Error('Invalid integration utilization response.')
  }
  if (!Array.isArray(integration.capabilities) || !Array.isArray(integration.connections)) {
    throw new Error('Invalid integration catalog response.')
  }

  const slug = expectString(integration.slug, 'integration slug')
  const kind = parseKind(integration.kind)
  const clientPresentation = kind === 'client_mcp' ? CLIENT_PRESENTATION[slug] : undefined
  const customPresentation = kind === 'custom_connection' && slug === 'custom-mcp'
    ? CUSTOM_CONNECTION_PRESENTATION
    : undefined
  const mailboxPresentation = slug === 'company-email' || slug === 'agentmail'
    ? COMPANY_MAIL_PRESENTATION
    : undefined
  const connections = integration.connections.map(parseConnection)
  const presentation = clientPresentation ?? customPresentation ?? mailboxPresentation
  const name = expectString(integration.name, 'integration name')
  const description = expectString(integration.description, 'integration description')
  const version = expectString(integration.version, 'integration version')
  const statusReason = expectNullableString(integration.status_reason, 'integration status_reason')
  const connectAction = parseAction(actions.connect, 'integration connect action')
  const reconnectAction = parseAction(actions.reconnect, 'integration reconnect action')

  return {
    slug: mailboxPresentation ? 'company-email' : slug,
    name: presentation?.name ?? name,
    category: expectString(integration.category, 'integration category'),
    description: presentation?.description ?? description,
    version: presentation?.version ?? version,
    kind,
    availability,
    status: status as BrainIntegrationStatus,
    status_reason: clientPresentation
      ? withoutClientProtocolJargon(statusReason)
      : mailboxPresentation
        ? withoutMailboxProviderBrand(statusReason)
        : statusReason,
    auth_type: authType,
    scope_options: integration.scope_options.map((scope) => parseScope(scope, 'integration scope option')),
    utilization: integration.utilization as number | null,
    last_sync_at: expectNullableString(integration.last_sync_at, 'integration last_sync_at'),
    capabilities: integration.capabilities.map(parseCapability).map((capability) => mailboxPresentation
      ? { ...capability, name: withoutMailboxProviderBrand(capability.name)!, description: withoutMailboxProviderBrand(capability.description)! }
      : capability),
    connections: mailboxPresentation ? connections.map(withoutMailboxProviderEndpoint) : connections,
    actions: {
      connect: clientPresentation
        ? { ...connectAction, reason: withoutClientProtocolJargon(connectAction.reason) }
        : mailboxPresentation
          ? { ...connectAction, reason: withoutMailboxProviderBrand(connectAction.reason) }
          : connectAction,
      reconnect: clientPresentation
        ? { ...reconnectAction, reason: withoutClientProtocolJargon(reconnectAction.reason) }
        : mailboxPresentation
          ? { ...reconnectAction, reason: withoutMailboxProviderBrand(reconnectAction.reason) }
          : reconnectAction,
    },
  }
}

async function responseError(response: Response) {
  const details = await readUserFacingApiError(response, {
    fallback: 'Company Brain integrations are temporarily unavailable. Please try again.',
    messages: INTEGRATION_ERROR_MESSAGES,
    statusMessages: {
      403: 'You do not have permission to manage this connection.',
      404: 'That connection is no longer available. Refresh the connector list.',
      429: 'Too many connection attempts were made. Wait a moment and try again.',
      500: 'Company Brain integrations are temporarily unavailable. Please try again.',
      502: 'The integration provider is temporarily unavailable. Please try again.',
      503: 'Company Brain integrations are temporarily unavailable. Please try again.',
    },
  })
  return new BrainIntegrationHttpError(response.status, details.message, details.code)
}

async function requestJson(path: string, init: RequestInit = {}) {
  const safePath = parseActionPath(path, 'integration request path')
  if (!safePath) throw new Error('Integration request path is missing.')

  const headers = organizationScopedHeaders(init.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(`${BRAIN_API_URL}${safePath}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<unknown>
}

export async function fetchBrainIntegrations(signal?: AbortSignal) {
  const payload = expectRecord(
    await requestJson('/api/v2/integrations', { method: 'GET', signal }),
    'integrations',
  )
  if (!Array.isArray(payload.integrations)) throw new Error('Invalid integrations response.')
  return payload.integrations.map(parseIntegration)
}

function parseAuthorizationUrl(value: unknown) {
  const authorizationUrl = expectString(value, 'integration authorization_url')
  const parsedUrl = new URL(authorizationUrl)
  const localHttp = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if ((parsedUrl.protocol !== 'https:' && !localHttp) || parsedUrl.username || parsedUrl.password) {
    throw new Error('Company Brain returned an unsafe authorization URL.')
  }
  const brainOrigin = new URL(BRAIN_API_URL || window.location.origin, window.location.origin).origin
  if (parsedUrl.origin === brainOrigin && parsedUrl.pathname === '/slack/oauth/install') {
    const organizationId = getActiveBrainOrganizationId()
    if (organizationId) parsedUrl.searchParams.set('organization_id', organizationId)
  }
  return parsedUrl.toString()
}

function parseClientSetup(value: unknown): BrainIntegrationClientSetup {
  const setup = expectRecord(value, 'integration client_setup')
  const serverUrl = new URL(expectString(setup.server_url, 'integration client_setup.server_url'))
  if (
    serverUrl.protocol !== 'https:'
    || serverUrl.username
    || serverUrl.password
    || serverUrl.search
    || serverUrl.hash
    || serverUrl.pathname !== '/mcp'
  ) {
    throw new Error('Company Brain returned an unsafe client server URL.')
  }
  const commands = expectStringArray(setup.commands, 'integration client_setup.commands')
  if (commands.length > 20 || commands.some((command) => command.length > 20_000)) {
    throw new Error('Invalid integration client_setup.commands response.')
  }
  const token = expectString(setup.token, 'integration client_setup.token')
  const config = expectString(setup.config, 'integration client_setup.config')
  const client = expectString(setup.client, 'integration client_setup.client') as BrainIntegrationClient
  const environmentVariable = expectString(
    setup.environment_variable,
    'integration client_setup.environment_variable',
  )
  if (
    !token
    || token.length > 20_000
    || config.length > 100_000
    || CLIENT_ENVIRONMENT_VARIABLES[client] !== environmentVariable
    || config.includes(token)
    || commands.some((command) => command.includes(token))
  ) {
    throw new Error('Invalid integration client setup response.')
  }
  return {
    client,
    server_url: serverUrl.toString(),
    token,
    expires_at: expectString(setup.expires_at, 'integration client_setup.expires_at'),
    environment_variable: environmentVariable as BrainIntegrationClientEnvironmentVariable,
    commands,
    config,
  }
}

export async function connectBrainIntegration(
  path: string,
  body: BrainIntegrationConnectBody,
  options: { idempotencyKey?: string } = {},
): Promise<BrainIntegrationConnectResponse> {
  const payload = expectRecord(await requestJson(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...('endpoint_url' in body
        ? { 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() }
        : {}),
    },
    body: JSON.stringify(body),
  }), 'integration connect')

  if ('authorization_url' in payload) {
    return { type: 'oauth', authorizationUrl: parseAuthorizationUrl(payload.authorization_url) }
  }
  if ('client_setup' in payload) {
    return { type: 'client', setup: parseClientSetup(payload.client_setup) }
  }
  if ('connection' in payload) {
    return { type: 'custom', connection: parseConnection(payload.connection) }
  }
  throw new Error('Invalid integration connect response.')
}

export async function setBrainIntegrationEnabled(path: string, enabled: boolean) {
  await requestJson(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

export async function setBrainIntegrationExecutionPolicy(
  path: string,
  update: BrainIntegrationExecutionPolicyUpdate,
) {
  await requestJson(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
}

export async function revokeBrainIntegration(path: string) {
  const payload = expectRecord(await requestJson(path, { method: 'DELETE' }), 'integration revoke')
  return {
    revoked: payload.revoked === true,
    disconnected: payload.disconnected === true,
    providerUninstallRequired: payload.provider_uninstall_required === true,
  }
}
