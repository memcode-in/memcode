export type BrainByokCostSource = 'provider_reported' | 'estimated' | 'unavailable'

interface BrainByokUsageResourceBase {
  provider: string
  period_start: string
  period_end: string
  cost_usd_micros: number | null
  cost_source: BrainByokCostSource
  pricing_source?: string
}

export interface BrainByokModelUsageResource extends BrainByokUsageResourceBase {
  resource_type: 'model'
  model_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface BrainByokWebUsageResource extends BrainByokUsageResourceBase {
  resource_type: 'web_search' | 'web_reader'
  calls: number
}

export interface BrainByokSandboxUsageResource extends BrainByokUsageResourceBase {
  resource_type: 'sandbox'
  sandbox_seconds: number
}

export interface BrainByokBrowserUsageResource extends BrainByokUsageResourceBase {
  resource_type: 'browser'
  calls: number
}

export interface BrainByokXSearchUsageResource extends BrainByokUsageResourceBase {
  resource_type: 'x_search'
  calls: number
}

export type BrainByokUsageResource =
  | BrainByokModelUsageResource
  | BrainByokWebUsageResource
  | BrainByokSandboxUsageResource
  | BrainByokBrowserUsageResource
  | BrainByokXSearchUsageResource

export const BYOK_USAGE_PAGE_SIZE = 100

const MAX_PROVIDER_LENGTH = 100
const MAX_MODEL_ID_LENGTH = 300
const MAX_PRICING_SOURCE_LENGTH = 500
const MAX_PERIOD_LENGTH = 64
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return isBoundedString(value, maxLength)
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isBoundedString(value, MAX_PERIOD_LENGTH)) return false
  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[10] === undefined ? 0 : Number(match[10])
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11])

  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 14
    && offsetMinute <= 59
    && (offsetHour < 14 || offsetMinute === 0)
    && Number.isFinite(Date.parse(value))
}

function isBrainByokUsageResource(value: unknown): value is BrainByokUsageResource {
  if (!isRecord(value)) return false
  const costSource = value.cost_source
  const costUsdMicros = value.cost_usd_micros
  const pricingSource = value.pricing_source
  const costIsValid = costSource === 'unavailable'
    ? costUsdMicros === null && pricingSource === undefined
    : isNonNegativeCount(costUsdMicros)

  const commonFieldsAreValid = isBoundedIdentifier(value.provider, MAX_PROVIDER_LENGTH)
    && isIsoTimestamp(value.period_start)
    && isIsoTimestamp(value.period_end)
    && Date.parse(value.period_start) < Date.parse(value.period_end)
    && (costSource === 'provider_reported' || costSource === 'estimated' || costSource === 'unavailable')
    && costIsValid
    && (pricingSource === undefined
      || isBoundedIdentifier(pricingSource, MAX_PRICING_SOURCE_LENGTH))

  if (!commonFieldsAreValid) return false
  if (value.resource_type === 'model') {
    return isBoundedIdentifier(value.model_id, MAX_MODEL_ID_LENGTH)
      && isNonNegativeCount(value.input_tokens)
      && isNonNegativeCount(value.output_tokens)
      && isNonNegativeCount(value.cache_read_tokens)
      && isNonNegativeCount(value.cache_write_tokens)
      && value.cache_read_tokens + value.cache_write_tokens <= value.input_tokens
  }
  if (value.resource_type === 'web_search') {
    return value.provider === 'tavily'
      && isNonNegativeCount(value.calls)
      && value.calls > 0
  }
  if (value.resource_type === 'web_reader') {
    return (value.provider === 'firecrawl' || value.provider === 'scrape-do')
      && isNonNegativeCount(value.calls)
      && value.calls > 0
  }
  if (value.resource_type === 'sandbox') {
    return (value.provider === 'daytona'
      || value.provider === 'blaxel'
      || value.provider === 'cloudflare')
      && costSource === 'unavailable'
      && isNonNegativeCount(value.sandbox_seconds)
      && value.sandbox_seconds > 0
  }
  if (value.resource_type === 'browser') {
    return value.provider === 'browser-use'
      && costSource !== 'estimated'
      && isNonNegativeCount(value.calls)
      && value.calls > 0
  }
  if (value.resource_type === 'x_search') {
    return value.provider === 'x'
      && costSource === 'unavailable'
      && isNonNegativeCount(value.calls)
      && value.calls > 0
  }
  return false
}

export function decodeBrainByokUsageResources(value: unknown): BrainByokUsageResource[] | null {
  if (!Array.isArray(value)) return null
  for (const resource of value) {
    if (!isBrainByokUsageResource(resource)) return null
  }
  return value
}

export function pageBrainByokUsageResources(
  resources: BrainByokUsageResource[],
  requestedPage: number,
) {
  const pageCount = Math.max(1, Math.ceil(resources.length / BYOK_USAGE_PAGE_SIZE))
  const validPage = Number.isSafeInteger(requestedPage) && requestedPage >= 0
    ? requestedPage
    : 0
  const page = Math.min(validPage, pageCount - 1)
  const startIndex = page * BYOK_USAGE_PAGE_SIZE
  const endIndex = Math.min(startIndex + BYOK_USAGE_PAGE_SIZE, resources.length)
  return {
    items: resources.slice(startIndex, endIndex),
    page,
    pageCount,
    startIndex,
    endIndex,
  }
}
