import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  managedWebCreditUsageLabel,
  managedWebSearchAvailable,
  nativeModelWebAvailable,
  webAccessProviderFromRuntime,
  webAccessRuntimeProviders,
  webReaderUnavailable,
  webRuntimeSubmissionError,
  type WebRuntimePolicyInput,
} from '../src/lib/brain-runtime-policy.ts'

const BASE_POLICY: WebRuntimePolicyInput = {
  modelProvider: 'google',
  webSearchProvider: 'managed',
  webReaderProvider: 'managed',
  managedResearchAvailable: true,
  managedReaderAvailable: true,
}

describe('managed web provider policy', () => {
  test('uses managed research independently of the selected model and reader', () => {
    for (const modelProvider of [
      'managed',
      'openai',
      'anthropic',
      'google',
      'ai-gateway',
      'openrouter',
      'vertex-ai',
    ] as const) {
      assert.equal(managedWebSearchAvailable({
        ...BASE_POLICY,
        modelProvider,
        webReaderProvider: 'disabled',
        managedReaderAvailable: false,
      }), true, modelProvider)
    }
    assert.equal(managedWebSearchAvailable({
      ...BASE_POLICY,
      managedResearchAvailable: false,
    }), false)
  })

  test('allows either BYO reader without changing managed research availability', () => {
    for (const webReaderProvider of ['firecrawl', 'scrape-do'] as const) {
      assert.equal(managedWebSearchAvailable({
        ...BASE_POLICY,
        webReaderProvider,
        managedReaderAvailable: false,
      }), true)
    }
  })

  test('allows native web only for direct providers that expose it', () => {
    assert.equal(nativeModelWebAvailable('openai', false), true)
    assert.equal(nativeModelWebAvailable('anthropic', false), true)
    assert.equal(nativeModelWebAvailable('managed', true), true)
    assert.equal(nativeModelWebAvailable('managed', false), false)

    for (const modelProvider of ['google', 'ai-gateway', 'openrouter', 'vertex-ai'] as const) {
      assert.equal(nativeModelWebAvailable(modelProvider, false), false)
    }
  })

  test('marks only genuinely unavailable reader combinations as unavailable', () => {
    assert.equal(webReaderUnavailable({
      ...BASE_POLICY,
      managedReaderAvailable: false,
    }), true)
    assert.equal(webReaderUnavailable({
      ...BASE_POLICY,
      webReaderProvider: 'disabled',
    }), false)
    assert.equal(webReaderUnavailable({
      ...BASE_POLICY,
      webSearchProvider: 'tavily',
      webReaderProvider: 'disabled',
    }), false)
    assert.equal(webReaderUnavailable({
      ...BASE_POLICY,
      webSearchProvider: 'disabled',
      webReaderProvider: 'disabled',
    }), false)
    assert.equal(webReaderUnavailable({
      ...BASE_POLICY,
      webReaderProvider: 'firecrawl',
      managedReaderAvailable: false,
    }), false)
  })

  test('returns the same submission errors used by the settings form', () => {
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      managedResearchAvailable: false,
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      webSearchProvider: 'tavily',
      managedReaderAvailable: false,
    }), 'The managed web reader is not available on this deployment.')
    assert.equal(webRuntimeSubmissionError(BASE_POLICY), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      modelProvider: 'anthropic',
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      modelProvider: 'openai',
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      webReaderProvider: 'scrape-do',
      managedReaderAvailable: false,
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      modelProvider: 'openai',
      webReaderProvider: 'scrape-do',
      managedReaderAvailable: false,
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      modelProvider: 'anthropic',
      webReaderProvider: 'disabled',
      managedResearchAvailable: false,
    }), null)
    assert.equal(webRuntimeSubmissionError({
      ...BASE_POLICY,
      modelProvider: 'google',
      webReaderProvider: 'disabled',
    }), 'Native web search is not available for the selected model provider.')
  })
})

describe('unified web access settings', () => {
  test('maps each dashboard choice to one backend search and reader pair', () => {
    assert.deepEqual(webAccessRuntimeProviders('managed'), {
      webSearchProvider: 'managed',
      webReaderProvider: 'managed',
    })
    assert.deepEqual(webAccessRuntimeProviders('native'), {
      webSearchProvider: 'managed',
      webReaderProvider: 'disabled',
    })
    assert.deepEqual(webAccessRuntimeProviders('firecrawl'), {
      webSearchProvider: 'managed',
      webReaderProvider: 'firecrawl',
    })
    assert.deepEqual(webAccessRuntimeProviders('tavily'), {
      webSearchProvider: 'tavily',
      webReaderProvider: 'disabled',
    })
    assert.deepEqual(webAccessRuntimeProviders('scrape-do'), {
      webSearchProvider: 'disabled',
      webReaderProvider: 'scrape-do',
    })
    assert.deepEqual(webAccessRuntimeProviders('disabled'), {
      webSearchProvider: 'disabled',
      webReaderProvider: 'disabled',
    })
  })

  test('derives one dashboard choice from persisted runtime settings', () => {
    assert.equal(webAccessProviderFromRuntime('managed', 'managed'), 'managed')
    assert.equal(webAccessProviderFromRuntime('managed', 'disabled'), 'native')
    assert.equal(webAccessProviderFromRuntime('managed', 'firecrawl'), 'firecrawl')
    assert.equal(webAccessProviderFromRuntime('disabled', 'scrape-do'), 'scrape-do')
    assert.equal(webAccessProviderFromRuntime('tavily', 'disabled'), 'tavily')
    assert.equal(webAccessProviderFromRuntime('disabled', 'disabled'), 'disabled')
  })
})

describe('managed web credit presentation', () => {
  test('shows exact managed credit usage when both values are present', () => {
    assert.equal(managedWebCreditUsageLabel(0, 200), '0 of 200 credits used')
    assert.equal(managedWebCreditUsageLabel(125, 250), '125 of 250 credits used')
  })

  test('omits the exact label whenever either value is absent', () => {
    assert.equal(managedWebCreditUsageLabel(undefined, 200), null)
    assert.equal(managedWebCreditUsageLabel(12, undefined), null)
    assert.equal(managedWebCreditUsageLabel(12, null), null)
  })
})
