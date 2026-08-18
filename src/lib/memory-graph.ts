import { API_URL } from './api'

export interface MemoryNode {
  id: string
  type: string
  label: string
  metadata: Record<string, unknown>
  position_hint?: { x: number; y: number; z: number }
}

export interface MemoryEdge {
  source: string
  target: string
  type: string
  strength: number
}

export interface MemoryGraphData {
  nodes: MemoryNode[]
  edges: MemoryEdge[]
  total_memories: number
  domains: string[]
  limit?: number
  offset?: number
  has_more?: boolean
}

interface MemoryGraphEnvelope {
  status?: 'ok' | 'error'
  data?: MemoryGraphData
  error?: string
}

export class MemoryGraphHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'MemoryGraphHttpError'
  }
}

const PAGE_SIZE = 500
const MAX_NODES = 5_000
const preferredGraphPath = import.meta.env.VITE_MEMORY_GRAPH_PATH || '/v2/memory-graph'
const compatibleGraphPath = '/api/memory-graph'

function endpointUrl(path: string, offset: number) {
  const url = /^https?:\/\//.test(path)
    ? new URL(path)
    : new URL(`${API_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`)
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('offset', String(offset))
  return url.toString()
}

async function fetchGraphPage(path: string, token: string, offset: number, signal?: AbortSignal) {
  const response = await fetch(endpointUrl(path, offset), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })

  if (!response.ok) {
    throw new MemoryGraphHttpError(
      response.status === 401
        ? 'Your Memory session has expired.'
        : 'Memory graph is temporarily unavailable.',
      response.status,
    )
  }

  const payload = await response.json() as MemoryGraphEnvelope | MemoryGraphData
  if ('status' in payload && payload.status === 'error') {
    throw new Error(payload.error || 'Memory graph is temporarily unavailable.')
  }
  const page = Array.isArray((payload as MemoryGraphData).nodes)
    ? payload as MemoryGraphData
    : (payload as MemoryGraphEnvelope).data
  if (!page || !Array.isArray(page.nodes) || !Array.isArray(page.edges)) {
    throw new Error('Memory graph returned an invalid response.')
  }
  return page
}

async function fetchCompatiblePage(token: string, offset: number, signal?: AbortSignal) {
  try {
    return await fetchGraphPage(preferredGraphPath, token, offset, signal)
  } catch (error) {
    if (
      error instanceof MemoryGraphHttpError
      && error.status === 404
      && preferredGraphPath !== compatibleGraphPath
    ) {
      return fetchGraphPage(compatibleGraphPath, token, offset, signal)
    }
    throw error
  }
}

export async function fetchMemoryGraph(token: string, signal?: AbortSignal): Promise<MemoryGraphData> {
  let page = await fetchCompatiblePage(token, 0, signal)
  const nodeMap = new Map(page.nodes.map((node) => [node.id, node]))
  const edgeMap = new Map(page.edges.map((edge) => [`${edge.source}:${edge.target}:${edge.type}`, edge]))
  let offset = page.nodes.length

  while (page.has_more && page.nodes.length > 0 && nodeMap.size < MAX_NODES) {
    page = await fetchCompatiblePage(token, offset, signal)
    for (const node of page.nodes) nodeMap.set(node.id, node)
    for (const edge of page.edges) edgeMap.set(`${edge.source}:${edge.target}:${edge.type}`, edge)
    offset += page.nodes.length
  }

  return {
    ...page,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    total_memories: page.total_memories || nodeMap.size,
    domains: page.domains.length ? page.domains : Array.from(new Set(Array.from(nodeMap.values(), (node) => node.type))),
    has_more: Boolean(page.has_more && nodeMap.size >= MAX_NODES),
  }
}
