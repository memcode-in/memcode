import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import BrainByokSpend from '../src/components/BrainByokSpend.tsx'
import {
  BYOK_USAGE_PAGE_SIZE,
  decodeBrainByokUsageResources,
  pageBrainByokUsageResources,
} from '../src/lib/brain-byok-usage.ts'

const PERIOD_START = '2026-08-01T00:00:00.000Z'
const PERIOD_END = '2026-09-01T00:00:00.000Z'

function modelUsage(overrides: Record<string, unknown> = {}) {
  return {
    resource_type: 'model',
    provider: 'openai',
    model_id: 'gpt-5-mini',
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    input_tokens: 120,
    output_tokens: 40,
    cache_read_tokens: 10,
    cache_write_tokens: 5,
    cost_usd_micros: 25_000,
    cost_source: 'estimated',
    pricing_source: 'OpenAI pricing snapshot',
    ...overrides,
  }
}

test('accepts valid BYOK usage for every resource contract', () => {
  const resources = [
    modelUsage(),
    {
      resource_type: 'web_search',
      provider: 'tavily',
      period_start: '2026-08-01T00:00:00+05:30',
      period_end: PERIOD_END,
      calls: Number.MAX_SAFE_INTEGER,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'web_reader',
      provider: 'firecrawl',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      calls: 12,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'sandbox',
      provider: 'daytona',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      sandbox_seconds: 842,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'browser',
      provider: 'browser-use',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      calls: 7,
      cost_usd_micros: 384_120,
      cost_source: 'provider_reported',
    },
    {
      resource_type: 'x_search',
      provider: 'x',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      calls: 19,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
  ]

  assert.strictEqual(decodeBrainByokUsageResources(resources), resources)
})

test('renders sandbox, browser, and X usage without presenting unavailable cost as zero', () => {
  const decoded = decodeBrainByokUsageResources([
    {
      resource_type: 'sandbox',
      provider: 'daytona',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      sandbox_seconds: 1,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
    {
      resource_type: 'browser',
      provider: 'browser-use',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      calls: 2,
      cost_usd_micros: 384_120,
      cost_source: 'provider_reported',
    },
    {
      resource_type: 'x_search',
      provider: 'x',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      calls: 3,
      cost_usd_micros: null,
      cost_source: 'unavailable',
    },
  ])
  assert.ok(decoded)

  const markup = renderToStaticMarkup(createElement(BrainByokSpend, { resources: decoded }))
  assert.match(markup, />Sandbox</u)
  assert.match(markup, />Daytona</u)
  assert.match(markup, />1 second</u)
  assert.match(markup, />Browser</u)
  assert.match(markup, />Browser Use</u)
  assert.match(markup, />2 tasks</u)
  assert.match(markup, />X search</u)
  assert.match(markup, />3 searches</u)
  assert.match(markup, />Unavailable</u)
  assert.match(markup, />Provider-reported</u)
  assert.doesNotMatch(markup, /\$0\.00/u)
})

test('preserves large valid row sets for paginated rendering', () => {
  const resources = Array.from({ length: 501 }, () => modelUsage())
  const decoded = decodeBrainByokUsageResources(resources)
  assert.strictEqual(decoded, resources)
  assert.equal(decoded?.length, 501)

  const pages = Array.from(
    { length: Math.ceil(resources.length / BYOK_USAGE_PAGE_SIZE) },
    (_, page) => pageBrainByokUsageResources(resources, page),
  )
  assert.deepEqual(pages.map(({ items }) => items.length), [100, 100, 100, 100, 100, 1])
  assert.deepEqual(pages.flatMap(({ items }) => items), resources)
  assert.equal(pageBrainByokUsageResources(resources, 999).page, 5)
})

test('enforces provider, model, pricing source, and period string bounds', () => {
  const maximumPeriod = `2026-08-01T00:00:00.${'1'.repeat(43)}Z`
  assert.equal(maximumPeriod.length, 64)
  assert.notEqual(decodeBrainByokUsageResources([modelUsage({
    provider: 'p'.repeat(100),
    model_id: 'm'.repeat(300),
    pricing_source: 's'.repeat(500),
    period_start: maximumPeriod,
  })]), null)

  for (const resource of [
    modelUsage({ provider: 'p'.repeat(101) }),
    modelUsage({ model_id: 'm'.repeat(301) }),
    modelUsage({ pricing_source: 's'.repeat(501) }),
    modelUsage({ period_start: `2026-08-01T00:00:00.${'1'.repeat(44)}Z` }),
  ]) {
    assert.equal(decodeBrainByokUsageResources([resource]), null)
  }
})

test('rejects malformed and impossible ISO period timestamps', () => {
  for (const periodStart of [
    '2026-08-01',
    'not-a-timestamp',
    '2026-02-30T00:00:00.000Z',
    '2026-08-01T25:00:00.000Z',
    '2026-08-01T00:00:00+14:01',
  ]) {
    assert.equal(decodeBrainByokUsageResources([modelUsage({ period_start: periodStart })]), null)
  }
  assert.equal(decodeBrainByokUsageResources([modelUsage({ period_end: 'invalid' })]), null)
  assert.equal(decodeBrainByokUsageResources([modelUsage({
    period_start: PERIOD_END,
    period_end: PERIOD_START,
  })]), null)
})

test('retains safe-integer and cost-source validation', () => {
  assert.notEqual(decodeBrainByokUsageResources([modelUsage({
    input_tokens: Number.MAX_SAFE_INTEGER,
    cost_source: 'provider_reported',
    cost_usd_micros: Number.MAX_SAFE_INTEGER,
  })]), null)

  for (const resource of [
    modelUsage({ input_tokens: Number.MAX_SAFE_INTEGER + 1 }),
    modelUsage({ output_tokens: 0.5 }),
    modelUsage({ cache_read_tokens: -1 }),
    modelUsage({ input_tokens: 10, cache_read_tokens: 8, cache_write_tokens: 3 }),
    modelUsage({ cost_source: 'provider_reported', cost_usd_micros: null }),
    modelUsage({ cost_source: 'estimated', cost_usd_micros: -1 }),
    modelUsage({ cost_source: 'unavailable', cost_usd_micros: 0 }),
  ]) {
    assert.equal(decodeBrainByokUsageResources([resource]), null)
  }
})

test('rejects invalid sandbox, browser, and X resource metrics', () => {
  const common = {
    provider: 'provider',
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    cost_usd_micros: null,
    cost_source: 'unavailable',
  }
  for (const resource of [
    { ...common, resource_type: 'sandbox', provider: 'daytona', sandbox_seconds: -1 },
    { ...common, resource_type: 'sandbox', provider: 'unknown', sandbox_seconds: 1 },
    { ...common, resource_type: 'sandbox', provider: 'daytona', sandbox_seconds: 0 },
    { ...common, resource_type: 'sandbox', provider: 'daytona', sandbox_seconds: 0.5 },
    { ...common, resource_type: 'sandbox', provider: 'daytona', sandbox_seconds: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...common,
      resource_type: 'sandbox',
      provider: 'daytona',
      sandbox_seconds: 1,
      cost_usd_micros: 5,
      cost_source: 'provider_reported',
    },
    { ...common, resource_type: 'browser', provider: 'browser-use', calls: -1 },
    { ...common, resource_type: 'browser', provider: 'unknown', calls: 1 },
    { ...common, resource_type: 'browser', provider: 'browser-use', calls: 0 },
    { ...common, resource_type: 'browser', provider: 'browser-use', calls: 0.5 },
    {
      ...common,
      resource_type: 'browser',
      provider: 'browser-use',
      calls: 1,
      cost_usd_micros: 5,
      cost_source: 'estimated',
    },
    { ...common, resource_type: 'x_search', provider: 'x', calls: 0 },
    { ...common, resource_type: 'x_search', provider: 'unknown', calls: 1 },
    { ...common, resource_type: 'x_search', provider: 'x', calls: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...common,
      resource_type: 'x_search',
      provider: 'x',
      calls: 1,
      cost_usd_micros: 5,
      cost_source: 'provider_reported',
    },
    { ...common, resource_type: 'x_search', provider: 'x', calls: 1, pricing_source: 'not-applicable' },
    { ...common, resource_type: 'unknown', calls: 1 },
  ]) {
    assert.equal(decodeBrainByokUsageResources([resource]), null)
  }
})

test('rejects zero-call web summaries that cannot be produced by billing aggregation', () => {
  const common = {
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    calls: 0,
    cost_usd_micros: null,
    cost_source: 'unavailable',
  }

  assert.equal(decodeBrainByokUsageResources([{
    ...common,
    resource_type: 'web_search',
    provider: 'tavily',
  }]), null)
  assert.equal(decodeBrainByokUsageResources([{
    ...common,
    resource_type: 'web_reader',
    provider: 'firecrawl',
  }]), null)
})
