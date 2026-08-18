import { useState } from 'react'

import type {
  BrainByokCostSource,
  BrainByokUsageResource,
} from '../lib/brain-dashboard'
import { pageBrainByokUsageResources } from '../lib/brain-byok-usage'

const COST_SOURCE_LABELS: Record<BrainByokCostSource, string> = {
  provider_reported: 'Provider-reported',
  estimated: 'Estimated',
  unavailable: 'Unavailable',
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'ai-gateway': 'Vercel AI Gateway',
  openrouter: 'OpenRouter',
  'vertex-ai': 'Vertex AI',
  tavily: 'Tavily',
  firecrawl: 'Firecrawl',
  'scrape-do': 'Scrape.do',
  daytona: 'Daytona',
  blaxel: 'Blaxel',
  cloudflare: 'Cloudflare Sandbox',
  'browser-use': 'Browser Use',
  x: 'X',
  'x-api': 'X',
}

export default function BrainByokSpend({
  resources,
  id = 'brain-byok-spend',
}: {
  resources: BrainByokUsageResource[]
  id?: string
}) {
  const [pagination, setPagination] = useState({
    resources,
    page: 0,
  })
  const requestedPage = pagination.resources === resources ? pagination.page : 0
  const usagePage = pageBrainByokUsageResources(resources, requestedPage)
  const periodLabel = resources.length
    ? `${formatDate(resources[0]?.period_start)} – ${formatDate(resources[0]?.period_end)}`
    : 'Current reported period'

  return (
    <section className="brain-byok-spend" aria-labelledby={`${id}-title`}>
      <header>
        <div>
          <span>Provider billing</span>
          <h2 id={`${id}-title`}>Spend on your keys</h2>
          <p>Usage recorded against your own model, web, sandbox, browser, and X provider keys appears here. Dollar amounts are provider-reported, estimated from recorded usage, or marked unavailable.</p>
        </div>
        <small>{periodLabel}</small>
      </header>
      {resources.length ? (
        <div className="brain-byok-spend__resources">
          {usagePage.items.map((resource) => (
            <ByokSpendResource
              key={`${resource.resource_type}:${resource.provider}:${resource.resource_type === 'model' ? resource.model_id : ''}:${resource.cost_source}:${resource.pricing_source ?? ''}:${resource.period_start}:${resource.period_end}`}
              resource={resource}
            />
          ))}
        </div>
      ) : (
        <div className="brain-byok-spend__empty" role="status">
          <strong>No spend on your keys was returned for this period.</strong>
          <p>Usage appears after Company Brain records work against one of your own provider keys.</p>
        </div>
      )}
      {usagePage.pageCount > 1 ? (
        <div className="brain-byok-spend__pagination">
          <span aria-live="polite">
            Showing rows {usagePage.startIndex + 1}–{usagePage.endIndex} of {resources.length}.
          </span>
          <div>
            <button
              type="button"
              disabled={usagePage.page === 0}
              onClick={() => setPagination({ resources, page: usagePage.page - 1 })}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={usagePage.page === usagePage.pageCount - 1}
              onClick={() => setPagination({ resources, page: usagePage.page + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
      <footer>
        Usage on your keys is tracked separately from the matching managed allowance. Managed resources used without your key can still count toward plan limits.
      </footer>
    </section>
  )
}

function ByokSpendResource({ resource }: { resource: BrainByokUsageResource }) {
  const providerLabel = formatLabel(resource.provider)
  const costLabel = resource.cost_usd_micros === null
    ? 'Unavailable'
    : formatUsdMicros(resource.cost_usd_micros)
  const sourceLabel = COST_SOURCE_LABELS[resource.cost_source]
  const presentation = byokResourcePresentation(resource, providerLabel)
  const sourceDetail = resource.cost_source === 'provider_reported'
    ? `Reported by ${providerLabel}`
    : resource.cost_source === 'estimated'
      ? resource.pricing_source || 'Estimated from recorded usage'
      : 'The provider did not return enough pricing data'

  return (
    <article className="brain-byok-spend__resource" aria-label={`${presentation.resourceLabel}, ${providerLabel}: ${costLabel}, ${sourceLabel}`}>
      <div className="brain-byok-spend__identity">
        <span>{presentation.resourceLabel}</span>
        <strong>{providerLabel}</strong>
        <small>{presentation.resourceDetail}</small>
      </div>
      <div className="brain-byok-spend__usage">
        <strong>{presentation.usagePrimary}</strong>
        <small>{presentation.usageSecondary}</small>
      </div>
      <div className="brain-byok-spend__cost">
        <strong>{costLabel}</strong>
        <span className={`is-${resource.cost_source}`}>{sourceLabel}</span>
        <small>{sourceDetail} · Billed by {providerLabel}</small>
      </div>
    </article>
  )
}

function byokResourcePresentation(resource: BrainByokUsageResource, providerLabel: string) {
  switch (resource.resource_type) {
    case 'model':
      return {
        resourceLabel: 'Model',
        resourceDetail: resource.model_id,
        usagePrimary: `${formatNumber(resource.input_tokens)} input · ${formatNumber(resource.output_tokens)} output`,
        usageSecondary: resource.cache_read_tokens || resource.cache_write_tokens
          ? `${formatNumber(resource.cache_read_tokens)} cache read · ${formatNumber(resource.cache_write_tokens)} cache write`
          : 'No cache tokens reported',
      }
    case 'web_search':
      return callPresentation('Web search', 'Search requests on your key', resource.calls, providerLabel)
    case 'web_reader':
      return callPresentation('Web reader', 'Page reads on your key', resource.calls, providerLabel)
    case 'sandbox':
      return {
        resourceLabel: 'Sandbox',
        resourceDetail: 'Isolated runtime on your key',
        usagePrimary: `${formatNumber(resource.sandbox_seconds)} ${resource.sandbox_seconds === 1 ? 'second' : 'seconds'}`,
        usageSecondary: `Recorded against your ${providerLabel} key`,
      }
    case 'browser':
      return callPresentation('Browser', 'Browser tasks on your key', resource.calls, providerLabel, 'task')
    case 'x_search':
      return callPresentation('X search', 'Recent-search requests on your key', resource.calls, providerLabel, 'search', 'searches')
    default:
      return assertNever(resource)
  }
}

function callPresentation(
  resourceLabel: string,
  resourceDetail: string,
  calls: number,
  providerLabel: string,
  unit = 'call',
  pluralUnit = `${unit}s`,
) {
  return {
    resourceLabel,
    resourceDetail,
    usagePrimary: `${formatNumber(calls)} ${calls === 1 ? unit : pluralUnit}`,
    usageSecondary: `Recorded against your ${providerLabel} key`,
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported BYOK usage resource: ${JSON.stringify(value)}`)
}

function formatUsdMicros(amountInMicros: number) {
  const amount = amountInMicros / 1_000_000
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 6 : 4,
  }).format(amount)
}

function formatLabel(value: string) {
  const known = PROVIDER_LABELS[value.trim().toLowerCase()]
  if (known) return known
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatDate(value: string | undefined) {
  if (!value) return 'Unknown period'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
