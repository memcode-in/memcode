import type {
  BrainModelProvider,
  BrainWebReaderProvider,
  BrainWebSearchProvider,
} from './brain-runtime-settings'

export type BrainWebAccessProvider =
  | 'managed'
  | 'native'
  | 'firecrawl'
  | 'tavily'
  | 'scrape-do'
  | 'disabled'

export interface WebAccessRuntimeProviders {
  webSearchProvider: BrainWebSearchProvider
  webReaderProvider: BrainWebReaderProvider
}

const MANAGED_RESEARCH_MODEL_SUPPORT = {
  managed: true,
  openai: true,
  anthropic: true,
  google: true,
  'ai-gateway': true,
  openrouter: true,
  'vertex-ai': true,
} satisfies Record<BrainModelProvider, true>

export interface WebRuntimePolicyInput {
  modelProvider: BrainModelProvider
  webSearchProvider: BrainWebSearchProvider
  webReaderProvider: BrainWebReaderProvider
  managedResearchAvailable: boolean
  managedReaderAvailable: boolean
}

export function nativeModelWebAvailable(
  modelProvider: BrainModelProvider,
  managedModelNativeAvailable: boolean,
) {
  return modelProvider === 'openai'
    || modelProvider === 'anthropic'
    || (modelProvider === 'managed' && managedModelNativeAvailable)
}

export function webAccessProviderFromRuntime(
  webSearchProvider: BrainWebSearchProvider,
  webReaderProvider: BrainWebReaderProvider,
): BrainWebAccessProvider {
  if (webReaderProvider === 'managed') return 'managed'
  if (webReaderProvider === 'firecrawl') return 'firecrawl'
  if (webReaderProvider === 'scrape-do') return 'scrape-do'
  if (webSearchProvider === 'managed') return 'native'
  if (webSearchProvider === 'tavily') return 'tavily'
  return 'disabled'
}

export function webAccessRuntimeProviders(
  provider: BrainWebAccessProvider,
): WebAccessRuntimeProviders {
  switch (provider) {
    case 'managed':
      return { webSearchProvider: 'managed', webReaderProvider: 'managed' }
    case 'native':
      return { webSearchProvider: 'managed', webReaderProvider: 'disabled' }
    case 'firecrawl':
      return { webSearchProvider: 'managed', webReaderProvider: 'firecrawl' }
    case 'tavily':
      return { webSearchProvider: 'tavily', webReaderProvider: 'disabled' }
    case 'scrape-do':
      return { webSearchProvider: 'disabled', webReaderProvider: 'scrape-do' }
    case 'disabled':
      return { webSearchProvider: 'disabled', webReaderProvider: 'disabled' }
  }
}

export function managedWebSearchAvailable({
  modelProvider,
  managedResearchAvailable,
}: WebRuntimePolicyInput) {
  return managedResearchAvailable && MANAGED_RESEARCH_MODEL_SUPPORT[modelProvider]
}

export function webReaderUnavailable({
  webReaderProvider,
  managedReaderAvailable,
}: WebRuntimePolicyInput) {
  return webReaderProvider === 'managed' && !managedReaderAvailable
}

export function webRuntimeSubmissionError(input: WebRuntimePolicyInput) {
  if (input.webReaderProvider === 'managed' && !input.managedReaderAvailable) {
    return 'The managed web reader is not available on this deployment.'
  }
  if (
    input.webSearchProvider === 'managed'
    && input.webReaderProvider === 'disabled'
    && !nativeModelWebAvailable(input.modelProvider, input.managedResearchAvailable)
  ) {
    return 'Native web search is not available for the selected model provider.'
  }
  return null
}

export function managedWebCreditUsageLabel(
  used: number | undefined,
  limit: number | null | undefined,
) {
  return typeof used === 'number' && typeof limit === 'number'
    ? `${used} of ${limit} credits used`
    : null
}
