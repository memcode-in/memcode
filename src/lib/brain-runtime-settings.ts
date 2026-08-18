import { BRAIN_API_URL } from './api'
import { organizationScopedHeaders } from './brain-organization-context'
import {
  readUserFacingApiError,
  RUNTIME_ERROR_MESSAGES,
} from './user-facing-errors'

export type BrainModelProvider =
  | 'managed'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ai-gateway'
  | 'openrouter'
  | 'vertex-ai'
export type BrainModelCredentialProvider = Exclude<BrainModelProvider, 'managed'>
export type BrainWebSearchProvider = 'managed' | 'tavily' | 'disabled'
export type BrainWebSearchCredentialProvider = Extract<BrainWebSearchProvider, 'tavily'>
export type BrainWebReaderProvider = 'managed' | 'firecrawl' | 'scrape-do' | 'disabled'
export type BrainWebReaderCredentialProvider = Extract<BrainWebReaderProvider, 'firecrawl' | 'scrape-do'>
export type BrainSandboxProvider = 'managed' | 'daytona' | 'blaxel' | 'cloudflare' | 'disabled'
export type BrainSandboxCredentialProvider = Extract<BrainSandboxProvider, 'daytona' | 'blaxel' | 'cloudflare'>

export interface RuntimeCredentialStatus {
  api_key_configured: boolean
}

export interface RuntimeCredentialUpdate {
  api_key?: string
  remove?: boolean
}

export interface BrainRuntimeSettings {
  model: {
    provider: BrainModelProvider
    model_id: string
    api_key_configured: boolean
    credentials: Record<BrainModelCredentialProvider, RuntimeCredentialStatus>
  }
  tools: {
    web_search_enabled: boolean
    managed_web_search_available: boolean
    web_search: {
      provider: BrainWebSearchProvider
      managed_available: boolean
      credentials: Record<BrainWebSearchCredentialProvider, RuntimeCredentialStatus>
    }
    firecrawl: {
      enabled: boolean
      api_key_configured: boolean
    }
    web_reader: {
      provider: BrainWebReaderProvider
      managed_available: boolean
      credentials: Record<BrainWebReaderCredentialProvider, RuntimeCredentialStatus>
    }
    sandbox: {
      provider: BrainSandboxProvider
      managed_available: boolean
      credentials: Record<BrainSandboxCredentialProvider, RuntimeCredentialStatus>
      daytona_target: string | null
      blaxel_workspace: string | null
      cloudflare_bridge_url: string | null
    }
    browser: {
      enabled: boolean
      code_mode_enabled: boolean
      managed_available: boolean
      api_key_configured: boolean
      custom_api_key_configured: boolean
      max_cost_usd: number
      max_task_seconds: number
    }
    x: {
      read_enabled: boolean
      bearer_configured: boolean
    }
  }
  updated_at: string | null
}

export interface BrainRuntimeSettingsUpdate {
  model: {
    provider: BrainModelProvider
    model_id: string
    api_key?: string
    credentials?: Partial<Record<BrainModelCredentialProvider, RuntimeCredentialUpdate>>
  }
  tools: {
    web_search_enabled: boolean
    web_search: {
      provider: BrainWebSearchProvider
      credentials?: Partial<Record<BrainWebSearchCredentialProvider, RuntimeCredentialUpdate>>
    }
    firecrawl: {
      enabled: boolean
      api_key?: string
    }
    web_reader: {
      provider: BrainWebReaderProvider
      credentials?: Partial<Record<BrainWebReaderCredentialProvider, RuntimeCredentialUpdate>>
    }
    sandbox: {
      provider: BrainSandboxProvider
      credentials?: Partial<Record<BrainSandboxCredentialProvider, RuntimeCredentialUpdate>>
      daytona_target: string | null
      blaxel_workspace: string | null
      cloudflare_bridge_url: string | null
    }
    browser?: {
      enabled: boolean
      code_mode_enabled: boolean
      api_key?: string
      remove_api_key?: boolean
      max_cost_usd: number
      max_task_seconds: number
    }
    x?: {
      read_enabled: boolean
      bearer_token?: string
      remove_bearer?: boolean
    }
  }
}

export class BrainRuntimeSettingsHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BrainRuntimeSettingsHttpError'
  }
}

export async function fetchBrainRuntimeSettings(signal?: AbortSignal) {
  return requestBrainRuntimeSettings('/settings/runtime', { signal })
}

export async function updateBrainRuntimeSettings(input: BrainRuntimeSettingsUpdate) {
  return requestBrainRuntimeSettings('/settings/runtime', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

async function requestBrainRuntimeSettings(path: string, init: RequestInit) {
  const response = await fetch(`${BRAIN_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: organizationScopedHeaders({
      Accept: 'application/json',
      ...(init.headers ?? {}),
    }),
  })

  if (!response.ok) {
    const details = await readUserFacingApiError(response, {
      fallback: init.method === 'PUT'
        ? 'Brain settings could not be saved. Please try again.'
        : 'Brain runtime settings are temporarily unavailable. Please try again.',
      messages: RUNTIME_ERROR_MESSAGES,
      statusMessages: {
        403: 'Only an organization admin or owner can change Brain settings.',
        404: 'Brain settings are not available here yet.',
        429: 'Brain settings were updated too often. Wait a moment and try again.',
        500: 'Brain runtime settings are temporarily unavailable. Please try again.',
        502: 'Brain runtime settings are temporarily unavailable. Please try again.',
        503: 'Brain runtime settings are temporarily unavailable. Please try again.',
      },
    })
    throw new BrainRuntimeSettingsHttpError(
      details.message,
      response.status,
      details.code,
    )
  }

  const payload = await response.json() as unknown
  return parseSettingsEnvelope(payload)
}

function parseSettingsEnvelope(value: unknown): BrainRuntimeSettings {
  const envelope = record(value, 'runtime settings')
  const settings = record(envelope.settings, 'runtime settings')
  const model = record(settings.model, 'model settings')
  const tools = record(settings.tools, 'tool settings')
  const provider = modelProvider(model.provider)
  const legacyModelKeyConfigured = optionalBoolean(model.api_key_configured) ?? false
  const modelCredentials = optionalRecord(model.credentials) ?? optionalRecord(model.configured_providers)

  const legacyFirecrawl = optionalRecord(tools.firecrawl)
  const legacyFirecrawlEnabled = optionalBoolean(legacyFirecrawl?.enabled) ?? false
  const legacyFirecrawlKeyConfigured = optionalBoolean(legacyFirecrawl?.api_key_configured) ?? false
  const webReader = optionalRecord(tools.web_reader)
  const webReaderProviderValue = webReader?.provider
  const webReaderProvider = webReaderProviderValue === undefined
    ? legacyFirecrawlEnabled ? 'firecrawl' : 'disabled'
    : webReaderProviderFromValue(webReaderProviderValue)
  const webReaderCredentials = optionalRecord(webReader?.credentials)
    ?? optionalRecord(webReader?.configured_providers)

  const webSearch = optionalRecord(tools.web_search)
  const webSearchProvider = webSearch?.provider === undefined
    ? boolean(tools.web_search_enabled, 'web search status') ? 'managed' : 'disabled'
    : webSearchProviderFromValue(webSearch.provider)
  const webSearchCredentials = optionalRecord(webSearch?.credentials)
    ?? optionalRecord(webSearch?.configured_providers)

  const sandbox = optionalRecord(tools.sandbox)
  const sandboxProvider = sandbox?.provider === undefined
    ? 'managed'
    : sandboxProviderFromValue(sandbox.provider)
  const sandboxCredentials = optionalRecord(sandbox?.credentials)
    ?? optionalRecord(sandbox?.configured_providers)

  const browser = optionalRecord(tools.browser)

  const x = optionalRecord(tools.x)

  return {
    model: {
      provider,
      model_id: string(model.model_id, 'model id'),
      api_key_configured: legacyModelKeyConfigured
        || (provider !== 'managed' && credentialConfigured(modelCredentials?.[provider])),
      credentials: {
        openai: credentialStatus(modelCredentials?.openai, provider === 'openai' && legacyModelKeyConfigured),
        anthropic: credentialStatus(modelCredentials?.anthropic, provider === 'anthropic' && legacyModelKeyConfigured),
        google: credentialStatus(modelCredentials?.google, provider === 'google' && legacyModelKeyConfigured),
        'ai-gateway': credentialStatus(modelCredentials?.['ai-gateway'], provider === 'ai-gateway' && legacyModelKeyConfigured),
        openrouter: credentialStatus(modelCredentials?.openrouter, provider === 'openrouter' && legacyModelKeyConfigured),
        'vertex-ai': credentialStatus(modelCredentials?.['vertex-ai'], provider === 'vertex-ai' && legacyModelKeyConfigured),
      },
    },
    tools: {
      web_search_enabled: boolean(tools.web_search_enabled, 'web search status'),
      managed_web_search_available: optionalBoolean(tools.managed_web_search_available) ?? true,
      web_search: {
        provider: webSearchProvider,
        managed_available: optionalBoolean(webSearch?.managed_available)
          ?? (optionalBoolean(tools.managed_web_search_available) ?? true),
        credentials: {
          tavily: credentialStatus(webSearchCredentials?.tavily),
        },
      },
      firecrawl: {
        enabled: legacyFirecrawlEnabled || webReaderProvider === 'firecrawl',
        api_key_configured: legacyFirecrawlKeyConfigured
          || credentialConfigured(webReaderCredentials?.firecrawl),
      },
      web_reader: {
        provider: webReaderProvider,
        managed_available: optionalBoolean(webReader?.managed_available)
          ?? (legacyFirecrawlEnabled && legacyFirecrawlKeyConfigured),
        credentials: {
          firecrawl: credentialStatus(webReaderCredentials?.firecrawl, legacyFirecrawlKeyConfigured),
          'scrape-do': credentialStatus(webReaderCredentials?.['scrape-do']),
        },
      },
      sandbox: {
        provider: sandboxProvider,
        managed_available: optionalBoolean(sandbox?.managed_available) ?? true,
        credentials: {
          daytona: credentialStatus(sandboxCredentials?.daytona),
          blaxel: credentialStatus(sandboxCredentials?.blaxel),
          cloudflare: credentialStatus(sandboxCredentials?.cloudflare),
        },
        daytona_target: optionalNullableString(sandbox?.daytona_target, 'Daytona target'),
        blaxel_workspace: optionalNullableString(sandbox?.blaxel_workspace, 'Blaxel workspace'),
        cloudflare_bridge_url: optionalNullableString(sandbox?.cloudflare_bridge_url, 'Cloudflare bridge URL'),
      },
      browser: {
        enabled: optionalBoolean(browser?.enabled) ?? false,
        code_mode_enabled: optionalBoolean(browser?.code_mode_enabled) ?? false,
        managed_available: optionalBoolean(browser?.managed_available) ?? false,
        api_key_configured: optionalBoolean(browser?.api_key_configured) ?? false,
        custom_api_key_configured: optionalBoolean(browser?.custom_api_key_configured) ?? false,
        max_cost_usd: optionalNumber(browser?.max_cost_usd) ?? 0.25,
        max_task_seconds: optionalNumber(browser?.max_task_seconds) ?? 120,
      },
      x: {
        read_enabled: optionalBoolean(x?.read_enabled) ?? false,
        bearer_configured: optionalBoolean(x?.bearer_configured)
          ?? optionalBoolean(x?.bearer_token_configured)
          ?? optionalBoolean(x?.has_bearer_token)
          ?? false,
      },
    },
    updated_at: optionalNullableString(settings.updated_at, 'updated at'),
  }
}

function credentialStatus(value: unknown, fallback = false): RuntimeCredentialStatus {
  return { api_key_configured: credentialConfigured(value) || fallback }
}

function credentialConfigured(value: unknown) {
  if (typeof value === 'boolean') return value
  const credential = optionalRecord(value)
  return optionalBoolean(credential?.api_key_configured)
    ?? optionalBoolean(credential?.has_api_key)
    ?? optionalBoolean(credential?.configured)
    ?? false
}

function modelProvider(value: unknown): BrainModelProvider {
  if (
    value !== 'managed'
    && value !== 'openai'
    && value !== 'anthropic'
    && value !== 'google'
    && value !== 'ai-gateway'
    && value !== 'openrouter'
    && value !== 'vertex-ai'
  ) {
    throw new Error('Invalid model provider response.')
  }
  return value
}

function webSearchProviderFromValue(value: unknown): BrainWebSearchProvider {
  if (value !== 'managed' && value !== 'tavily' && value !== 'disabled') {
    throw new Error('Invalid web search provider response.')
  }
  return value
}

function webReaderProviderFromValue(value: unknown): BrainWebReaderProvider {
  if (value !== 'managed' && value !== 'firecrawl' && value !== 'scrape-do' && value !== 'disabled') {
    throw new Error('Invalid web reader provider response.')
  }
  return value
}

function sandboxProviderFromValue(value: unknown): BrainSandboxProvider {
  if (
    value !== 'managed'
    && value !== 'daytona'
    && value !== 'blaxel'
    && value !== 'cloudflare'
    && value !== 'disabled'
  ) {
    throw new Error('Invalid sandbox provider response.')
  }
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  const result = optionalRecord(value)
  if (!result) throw new Error(`Invalid ${label} response.`)
  return result
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function string(value: unknown, label: string) {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} response.`)
  return value
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label} response.`)
  return value
}

function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalNullableString(value: unknown, label: string) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`Invalid ${label} response.`)
  return value
}
