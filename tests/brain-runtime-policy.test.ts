import assert from 'node:assert/strict'
import test from 'node:test'

import {
  managedWebSearchAvailable,
  webAccessProviderFromRuntime,
  webAccessRuntimeProviders,
  type WebRuntimePolicyInput,
} from '../src/lib/brain-runtime-policy.ts'
import type { BrainModelProvider } from '../src/lib/brain-runtime-settings.ts'

const MODEL_PROVIDERS = [
  'managed',
  'openai',
  'anthropic',
  'google',
  'ai-gateway',
  'openrouter',
  'vertex-ai',
] as const satisfies readonly BrainModelProvider[]

const BASE_POLICY: WebRuntimePolicyInput = {
  modelProvider: 'managed',
  webSearchProvider: 'managed',
  webReaderProvider: 'managed',
  managedResearchAvailable: true,
  managedReaderAvailable: true,
}

test('keeps managed web selectable and submittable across supported model providers', () => {
  for (const provider of MODEL_PROVIDERS) {
    assert.equal(managedWebSearchAvailable({
      ...BASE_POLICY,
      modelProvider: provider,
    }), true, provider)
  }
})

test('rejects managed web when the deployment does not provide it', () => {
  for (const provider of MODEL_PROVIDERS) {
    assert.equal(managedWebSearchAvailable({
      ...BASE_POLICY,
      modelProvider: provider,
      managedResearchAvailable: false,
    }), false, provider)
  }
})

test('uses one web-access choice for each backend provider pair', () => {
  assert.deepEqual(webAccessRuntimeProviders('managed'), {
    webSearchProvider: 'managed',
    webReaderProvider: 'managed',
  })
  assert.deepEqual(webAccessRuntimeProviders('native'), {
    webSearchProvider: 'managed',
    webReaderProvider: 'disabled',
  })
  assert.equal(webAccessProviderFromRuntime('managed', 'managed'), 'managed')
  assert.equal(webAccessProviderFromRuntime('managed', 'disabled'), 'native')
  assert.equal(webAccessProviderFromRuntime('disabled', 'disabled'), 'disabled')
})
