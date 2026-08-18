import { BRAIN_API_URL } from './api'
import { organizationScopedHeaders } from './brain-organization-context'
import { readUserFacingApiError } from './user-facing-errors'

export type BrainCodeProvider = 'auto' | 'codex' | 'claude' | 'cursor'
export type BrainCodeCredentialProvider = Exclude<BrainCodeProvider, 'auto'>
export type BrainCodeExecutionUnavailableReason =
  | 'managed_execution_not_configured'
  | 'runtime_preparation_required'
  | 'credential_isolation_unavailable'
  | 'provider_adapter_unavailable'

export interface BrainCodeExecutionRuntime {
  configured: boolean
  available: boolean
  backend: string | null
  unavailable_reason: BrainCodeExecutionUnavailableReason | null
  capabilities: {
    ephemeral_workspace: boolean
    prebuilt_runtime: boolean
    internet_access: boolean
    /** Rolling compatibility with Brain releases that used a package-blocking allowlist. */
    restricted_egress: boolean
    secret_isolation: boolean
    cancellation: boolean
    patch_artifact: boolean
    cleanup: boolean
  }
}

export interface BrainCodeModeSettings {
  enabled: boolean
  provider: BrainCodeProvider
  credentials: Record<BrainCodeCredentialProvider, { configured: boolean }>
  sandbox: {
    network: 'restricted' | 'internet'
    max_task_minutes: number
    max_agent_turns: number
    max_parallel_agents: number
  }
  execution_runtime: BrainCodeExecutionRuntime
  github: {
    create_pull_requests: boolean
    require_approval_for_push: boolean
  }
  execution_available: boolean
  available_providers: BrainCodeCredentialProvider[]
  updated_at: string | null
}

export interface BrainCodeModeEntitlement {
  active: boolean
  plan_id: string | null
  plan_tier: string | null
  code_mode_allowed: boolean
  mcp_allowed: boolean
}

export interface BrainCodeModeEnvelope {
  settings: BrainCodeModeSettings
  entitlement: BrainCodeModeEntitlement
}

export interface BrainCodeModeSettingsUpdate {
  enabled: boolean
  provider: BrainCodeProvider
  credentials?: Partial<Record<BrainCodeCredentialProvider, {
    api_key?: string
    remove?: boolean
  }>>
  sandbox: {
    max_task_minutes: number
    max_agent_turns: number
    max_parallel_agents: number
  }
  github: BrainCodeModeSettings['github']
}

export interface BrainCodeModePreparation {
  queued: boolean
  ready: boolean
}

export class BrainCodeModeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainCodeModeHttpError'
  }
}

export function fetchBrainCodeModeSettings(signal?: AbortSignal, organizationId?: string) {
  return requestBrainCodeModeSettings({ signal }, organizationId)
}

export function updateBrainCodeModeSettings(
  input: BrainCodeModeSettingsUpdate,
  signal?: AbortSignal,
  organizationId?: string,
) {
  return requestBrainCodeModeSettings({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, organizationId)
}

export async function prepareBrainCodeModeRuntime(
  signal?: AbortSignal,
  organizationId?: string,
): Promise<BrainCodeModePreparation> {
  const response = await fetch(`${BRAIN_API_URL}/api/v2/code-mode/prepare`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: organizationScopedHeaders({ Accept: 'application/json' }, organizationId),
  })

  if (!response.ok) {
    const details = await readUserFacingApiError(response, {
      fallback: 'The managed coding workspace could not be prepared. Please try again.',
      statusMessages: {
        402: 'An active Company Brain plan is required for Code Mode.',
        403: 'Only an organization admin or owner can prepare Code Mode.',
        404: 'Code Mode is not available here yet.',
        409: 'The organization changed before Code Mode could be prepared. Refresh and try again.',
        429: 'Code Mode preparation was requested too often. Wait a moment and try again.',
        500: 'The managed coding workspace is temporarily unavailable. Please try again.',
        502: 'The managed coding workspace is temporarily unavailable. Please try again.',
        503: 'The managed coding workspace is temporarily unavailable. Please try again.',
      },
    })
    throw new BrainCodeModeHttpError(details.message, response.status, details.code)
  }

  const result = record(await response.json() as unknown, 'Code Mode preparation')
  return {
    queued: boolean(result.queued, 'Code Mode preparation queued status'),
    ready: boolean(result.ready, 'Code Mode preparation ready status'),
  }
}

async function requestBrainCodeModeSettings(init: RequestInit, organizationId?: string) {
  const response = await fetch(`${BRAIN_API_URL}/api/v2/code-mode/settings`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: organizationScopedHeaders({
      Accept: 'application/json',
      ...(init.headers ?? {}),
    }, organizationId),
  })

  if (!response.ok) {
    const details = await readUserFacingApiError(response, {
      fallback: init.method === 'PUT'
        ? 'Code Mode settings could not be saved. Please try again.'
        : 'Code Mode settings are temporarily unavailable. Please try again.',
      statusMessages: {
        400: 'Review the provider, credentials and sandbox limits before saving Code Mode.',
        402: 'An active Company Brain plan is required for Code Mode.',
        403: 'Only an organization admin or owner can manage Code Mode.',
        404: 'Code Mode is not available here yet.',
        409: 'The organization changed before Code Mode could be updated. Refresh and try again.',
        429: 'Code Mode settings were updated too often. Wait a moment and try again.',
        500: 'Code Mode settings are temporarily unavailable. Please try again.',
        502: 'Code Mode settings are temporarily unavailable. Please try again.',
        503: 'The managed coding workspace is temporarily unavailable. Please try again.',
      },
    })
    throw new BrainCodeModeHttpError(details.message, response.status, details.code)
  }

  return parseCodeModeEnvelope(await response.json() as unknown)
}

function parseCodeModeEnvelope(value: unknown): BrainCodeModeEnvelope {
  const envelope = record(value, 'Code Mode settings')
  const settings = record(envelope.settings, 'Code Mode settings')
  const credentials = record(settings.credentials, 'Code Mode credentials')
  const sandbox = record(settings.sandbox, 'Code Mode sandbox')
  const github = record(settings.github, 'Code Mode GitHub policy')
  const entitlement = record(envelope.entitlement, 'Code Mode entitlement')
  const provider = codeProvider(settings.provider, 'Code Mode provider')
  const availableProviders = stringArray(settings.available_providers, 'available Code Mode providers')
    .map((entry) => credentialProvider(entry, 'available Code Mode provider'))
  const executionRuntime = parseExecutionRuntime(settings.execution_runtime, sandbox, availableProviders)

  if (sandbox.network !== 'restricted' && sandbox.network !== 'internet') {
    throw new Error('Invalid Code Mode sandbox response.')
  }
  if (github.require_approval_for_push !== true) {
    throw new Error('Invalid Code Mode push approval policy response.')
  }

  return {
    settings: {
      enabled: boolean(settings.enabled, 'Code Mode enabled status'),
      provider,
      credentials: {
        codex: parseCredential(credentials.codex, 'Codex credential'),
        claude: parseCredential(credentials.claude, 'Claude credential'),
        cursor: parseCredential(credentials.cursor, 'Cursor credential'),
      },
      sandbox: {
        network: sandbox.network,
        max_task_minutes: boundedInteger(sandbox.max_task_minutes, 'maximum task minutes', 5, 120),
        max_agent_turns: boundedInteger(sandbox.max_agent_turns, 'maximum agent turns', 1, 64),
        max_parallel_agents: boundedInteger(sandbox.max_parallel_agents, 'maximum parallel agents', 1, 4),
      },
      execution_runtime: executionRuntime,
      github: {
        create_pull_requests: boolean(github.create_pull_requests, 'pull-request creation policy'),
        require_approval_for_push: true,
      },
      execution_available: boolean(settings.execution_available, 'Code Mode execution availability'),
      available_providers: [...new Set(availableProviders)],
      updated_at: nullableString(settings.updated_at, 'Code Mode updated at'),
    },
    entitlement: {
      active: boolean(entitlement.active, 'Code Mode entitlement status'),
      plan_id: nullableString(entitlement.plan_id, 'Code Mode entitlement plan id'),
      plan_tier: nullableString(entitlement.plan_tier, 'Code Mode entitlement plan tier'),
      code_mode_allowed: boolean(entitlement.code_mode_allowed, 'Code Mode plan access'),
      mcp_allowed: boolean(entitlement.mcp_allowed, 'MCP plan access'),
    },
  }
}

function parseExecutionRuntime(
  value: unknown,
  legacySandbox: Record<string, unknown>,
  legacyAvailableProviders: BrainCodeCredentialProvider[],
): BrainCodeExecutionRuntime {
  // Keep rolling deployments compatible with the original Daytona-shaped
  // response until both Brain and the dashboard are on the generic contract.
  if (value === undefined) {
    const configured = legacySandbox.snapshot_configured === true
    const available = configured && legacyAvailableProviders.length > 0
    const backend = typeof legacySandbox.backend === 'string' && legacySandbox.backend.trim()
      ? legacySandbox.backend.trim()
      : null
    return {
      configured,
      available,
      backend,
      unavailable_reason: available
        ? null
        : configured
          ? 'provider_adapter_unavailable'
          : 'managed_execution_not_configured',
      capabilities: legacyCapabilities(configured),
    }
  }

  const runtime = record(value, 'Code Mode execution runtime')
  const capabilities = record(runtime.capabilities, 'Code Mode execution capabilities')
  const configured = boolean(runtime.configured, 'Code Mode execution configured status')
  const available = boolean(runtime.available, 'Code Mode execution availability')
  const backend = nullableString(runtime.backend, 'Code Mode execution backend')
  const unavailableReason = executionUnavailableReason(runtime.unavailable_reason)
  const parsed = {
    configured,
    available,
    backend,
    unavailable_reason: unavailableReason,
    capabilities: {
      ephemeral_workspace: boolean(capabilities.ephemeral_workspace, 'ephemeral workspace capability'),
      prebuilt_runtime: boolean(capabilities.prebuilt_runtime, 'prebuilt runtime capability'),
      internet_access: optionalBoolean(capabilities.internet_access, false, 'internet access capability'),
      restricted_egress: optionalBoolean(capabilities.restricted_egress, false, 'restricted egress capability'),
      secret_isolation: boolean(capabilities.secret_isolation, 'secret isolation capability'),
      cancellation: boolean(capabilities.cancellation, 'cancellation capability'),
      patch_artifact: boolean(capabilities.patch_artifact, 'patch artifact capability'),
      cleanup: boolean(capabilities.cleanup, 'cleanup capability'),
    },
  } satisfies BrainCodeExecutionRuntime

  const executionCapabilities = [
    parsed.capabilities.ephemeral_workspace,
    parsed.capabilities.prebuilt_runtime,
    parsed.capabilities.secret_isolation,
    parsed.capabilities.cancellation,
    parsed.capabilities.patch_artifact,
    parsed.capabilities.cleanup,
  ]
  const hasSupportedNetworkPolicy = parsed.capabilities.internet_access
    || parsed.capabilities.restricted_egress
  const hasEverySafetyCapability = executionCapabilities.every((capability) => capability)
    && hasSupportedNetworkPolicy
  const hasAnySafetyCapability = executionCapabilities.some((capability) => capability)
    || hasSupportedNetworkPolicy
  const hasCoherentUnavailableCapabilities = !hasAnySafetyCapability
    || hasEverySafetyCapability
  const hasBackend = backend !== null && backend.trim().length > 0
  const isValidUnconfiguredRuntime = !configured
    && !available
    && backend === null
    && unavailableReason === 'managed_execution_not_configured'
    && !hasAnySafetyCapability
  const isValidUnavailableRuntime = configured
    && !available
    && hasBackend
    && (
      unavailableReason === 'runtime_preparation_required'
      || unavailableReason === 'credential_isolation_unavailable'
      || unavailableReason === 'provider_adapter_unavailable'
    )
    && hasCoherentUnavailableCapabilities
  const isValidAvailableRuntime = configured
    && available
    && hasBackend
    && unavailableReason === null
    && hasEverySafetyCapability

  if (!isValidUnconfiguredRuntime && !isValidUnavailableRuntime && !isValidAvailableRuntime) {
    throw new Error('Invalid Code Mode execution runtime response.')
  }
  return parsed
}

function legacyCapabilities(configured: boolean): BrainCodeExecutionRuntime['capabilities'] {
  return {
    ephemeral_workspace: configured,
    prebuilt_runtime: configured,
    internet_access: false,
    restricted_egress: configured,
    secret_isolation: configured,
    cancellation: configured,
    patch_artifact: configured,
    cleanup: configured,
  }
}

function executionUnavailableReason(value: unknown): BrainCodeExecutionUnavailableReason | null {
  if (value === null) return null
  if (
    value !== 'managed_execution_not_configured'
    && value !== 'runtime_preparation_required'
    && value !== 'credential_isolation_unavailable'
    && value !== 'provider_adapter_unavailable'
  ) {
    throw new Error('Invalid Code Mode execution availability response.')
  }
  return value
}

function parseCredential(value: unknown, label: string) {
  const credential = record(value, label)
  return { configured: boolean(credential.configured, `${label} status`) }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response.`)
  }
  return value as Record<string, unknown>
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label} response.`)
  return value
}

function optionalBoolean(value: unknown, fallback: boolean, label: string) {
  return value === undefined ? fallback : boolean(value, label)
}

function nullableString(value: unknown, label: string) {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Invalid ${label} response.`)
  return value
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid ${label} response.`)
  }
  return value as string[]
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid ${label} response.`)
  }
  return value as number
}

function codeProvider(value: unknown, label: string): BrainCodeProvider {
  if (value !== 'auto' && value !== 'codex' && value !== 'claude' && value !== 'cursor') {
    throw new Error(`Invalid ${label} response.`)
  }
  return value
}

function credentialProvider(value: unknown, label: string): BrainCodeCredentialProvider {
  if (value !== 'codex' && value !== 'claude' && value !== 'cursor') {
    throw new Error(`Invalid ${label} response.`)
  }
  return value
}
