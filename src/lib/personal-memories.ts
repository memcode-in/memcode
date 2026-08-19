import { API_URL } from './api'

export interface PersonalMemoryItem {
  id: string
  domain: string
  content: string
  content_complete: boolean
  metadata: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
}

export interface PersonalMemoryPage {
  items: PersonalMemoryItem[]
  total_memories: number
  limit: number
  offset: number
  has_more: boolean
}

interface PersonalMemoryEnvelope {
  status?: 'ok' | 'error'
  data?: unknown
  error?: string | null
}

export class PersonalMemoriesHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'PersonalMemoriesHttpError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === 'string'
}

function decodeItem(value: unknown): PersonalMemoryItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string'
    || typeof value.domain !== 'string'
    || typeof value.content !== 'string'
    || typeof value.content_complete !== 'boolean'
    || !isRecord(value.metadata)
    || !isOptionalString(value.created_at)
    || !isOptionalString(value.updated_at)
  ) return null

  return {
    id: value.id,
    domain: value.domain,
    content: value.content,
    content_complete: value.content_complete,
    metadata: value.metadata,
    created_at: value.created_at ?? null,
    updated_at: value.updated_at ?? null,
  }
}

export function decodePersonalMemoryPage(value: unknown): PersonalMemoryPage | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  const items = value.items.map(decodeItem)
  if (items.some((item) => item === null)) return null
  if (
    !Number.isInteger(value.total_memories)
    || Number(value.total_memories) < 0
    || !Number.isInteger(value.limit)
    || Number(value.limit) < 1
    || !Number.isInteger(value.offset)
    || Number(value.offset) < 0
    || typeof value.has_more !== 'boolean'
  ) return null

  const page = {
    items: items as PersonalMemoryItem[],
    total_memories: Number(value.total_memories),
    limit: Number(value.limit),
    offset: Number(value.offset),
    has_more: value.has_more,
  }
  if (page.has_more !== (page.offset + page.items.length < page.total_memories)) return null
  return page
}

export async function fetchPersonalMemories(
  token: string,
  options: { limit: number; offset: number; signal?: AbortSignal },
): Promise<PersonalMemoryPage> {
  const url = new URL(`${API_URL}/v2/memory`)
  url.searchParams.set('limit', String(options.limit))
  url.searchParams.set('offset', String(options.offset))
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  })

  if (!response.ok) {
    throw new PersonalMemoriesHttpError(
      response.status === 401
        ? 'Your Memory session has expired.'
        : 'Memory documents are temporarily unavailable.',
      response.status,
    )
  }

  const payload = await response.json() as PersonalMemoryEnvelope | PersonalMemoryPage
  if (isRecord(payload) && payload.status === 'error') {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Memory documents are temporarily unavailable.')
  }
  const data = isRecord(payload) && 'status' in payload ? payload.data : payload
  const page = decodePersonalMemoryPage(data)
  if (!page) throw new Error('Memory documents returned an invalid response.')
  return page
}
