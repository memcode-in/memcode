import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMemoryGraph,
  MemoryGraphHttpError,
  type MemoryEdge,
  type MemoryGraphData,
  type MemoryNode,
} from '../../lib/memory-graph'
import { DEMO_MEMORY_GRAPH } from '../../lib/demo-memory-graph'
import { GooeyInput } from '../ui/gooey-input'
import { MemoryFolder } from '../ui/memory-folder'

type MemoryWorkspaceMode = 'graph' | 'documents'

interface MemoryWorkspaceProps {
  mode: MemoryWorkspaceMode
  token: string | null
  demoMode: boolean
  onAuthenticationRequired: () => void
}

interface GraphPoint {
  node: MemoryNode
  x: number
  y: number
  color: string
}

const MEMORY_COLOR = '#2f7dff'
const DOCUMENTS_PER_PAGE = 24

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function memoryText(node: MemoryNode) {
  const candidates = [
    node.metadata.content,
    node.metadata.description,
    node.metadata.event_name,
    node.metadata.topic,
    node.metadata.sub_topic,
  ]
  const text = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return typeof text === 'string' ? text : 'Structured memory record'
}

function graphPoints(nodes: MemoryNode[]): GraphPoint[] {
  return nodes.slice(0, 220).map((node) => {
    const seed = hashText(node.id)
    const angle = ((seed % 360) * Math.PI) / 180
    const radius = 22 + ((seed >>> 4) % 220)
    return {
      node,
      x: 500 + Math.cos(angle) * radius,
      y: 310 + Math.sin(angle) * radius * 0.72,
      color: MEMORY_COLOR,
    }
  })
}

function MemoryGraphPanel({
  data,
  search,
  onSearchChange,
}: {
  data: MemoryGraphData
  search: string
  onSearchChange: (value: string) => void
}) {
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)
  const [zoom, setZoom] = useState(1)
  const points = useMemo(() => graphPoints(data.nodes), [data.nodes])
  const pointById = useMemo(() => new Map(points.map((point) => [point.node.id, point])), [points])
  const query = search.trim().toLowerCase()
  const matchingIds = useMemo(() => new Set(points
    .filter(({ node }) => !query || `${node.label} ${memoryText(node)}`.toLowerCase().includes(query))
    .map(({ node }) => node.id)), [points, query])
  const visibleEdges = useMemo(() => data.edges
    .slice(0, 480)
    .filter((edge) => pointById.has(edge.source) && pointById.has(edge.target)), [data.edges, pointById])

  return (
    <section className="memory-graph-panel" aria-label="Interactive memory graph">
      <div className="memory-graph-panel__toolbar">
        <label className="memory-graph-panel__search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
          <input
            type="search"
            value={search}
            placeholder="Search memories"
            aria-label="Search memories"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.7, current - 0.1))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(1.5, current + 0.1))}>+</button>
        <button type="button" onClick={() => setZoom(1)}>Reset</button>
      </div>
      <svg viewBox="0 0 1000 620" role="img" aria-label={`${points.length} loaded memory nodes`}>
        <defs>
          <radialGradient id="memory-graph-surface" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stopColor="#101a2b" />
            <stop offset="100%" stopColor="#05070b" />
          </radialGradient>
          <filter id="memory-node-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="1000" height="620" rx="20" fill="url(#memory-graph-surface)" />
        <g transform={`translate(500 310) scale(${zoom}) translate(-500 -310)`}>
          {visibleEdges.map((edge: MemoryEdge) => {
            const source = pointById.get(edge.source)
            const target = pointById.get(edge.target)
            if (!source || !target) return null
            const highlighted = selectedNode?.id === edge.source || selectedNode?.id === edge.target
            return <line key={`${edge.source}:${edge.target}:${edge.type}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={highlighted ? 'is-highlighted' : ''} />
          })}
          {points.map((point) => {
            const matches = matchingIds.has(point.node.id)
            const selected = selectedNode?.id === point.node.id
            return (
              <g
                key={point.node.id}
                className={`memory-graph-node${selected ? ' is-selected' : ''}${query && !matches ? ' is-dimmed' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={point.node.label}
                onClick={() => setSelectedNode(point.node)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setSelectedNode(point.node)
                }}
              >
                <circle cx={point.x} cy={point.y} r={selected ? 8 : 5} fill={point.color} filter={selected ? 'url(#memory-node-glow)' : undefined} />
                {selected ? <circle cx={point.x} cy={point.y} r="15" fill="none" stroke={point.color} strokeOpacity=".42" /> : null}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="memory-graph-panel__legend">
        <span><i style={{ background: MEMORY_COLOR }} />Memory</span>
      </div>
      <aside className={`memory-graph-panel__detail${selectedNode ? ' is-open' : ''}`} aria-live="polite">
        {selectedNode ? (
          <>
            <button type="button" aria-label="Close memory details" onClick={() => setSelectedNode(null)}>×</button>
            <span>Memory</span>
            <h2>{selectedNode.label}</h2>
            <p>{memoryText(selectedNode)}</p>
            <small>{selectedNode.id}</small>
          </>
        ) : <p>Select a node to inspect its memory.</p>}
      </aside>
    </section>
  )
}

function MemoryDocumentsPanel({
  data,
  search,
  onSearchChange,
}: {
  data: MemoryGraphData
  search: string
  onSearchChange: (value: string) => void
}) {
  const [page, setPage] = useState(1)
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)
  const filteredNodes = useMemo(() => {
    const query = search.trim().toLowerCase()
    return data.nodes.filter((node) => (
      !query || `${node.label} ${memoryText(node)}`.toLowerCase().includes(query)
    ))
  }, [data.nodes, search])
  const totalPages = Math.max(1, Math.ceil(filteredNodes.length / DOCUMENTS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageNodes = filteredNodes.slice((currentPage - 1) * DOCUMENTS_PER_PAGE, currentPage * DOCUMENTS_PER_PAGE)

  return (
    <section className="memory-documents-panel">
      <div className="memory-documents-panel__controls">
        <nav aria-label="Memory documents">
          <button type="button" className="is-active" aria-current="page" onClick={() => setPage(1)}>
            All folders <span>{data.total_memories.toLocaleString()}</span>
          </button>
        </nav>
        <GooeyInput
          value={search}
          placeholder="Search memories"
          collapsedWidth={142}
          expandedWidth={270}
          expandedOffset={44}
          gooeyBlur={4}
          ariaLabel="Search memory documents"
          onValueChange={onSearchChange}
          className="memory-documents-search"
          classNames={{
            trigger: 'dashboard-command-search__trigger',
            input: 'dashboard-command-search__input',
            bubbleSurface: 'dashboard-command-search__bubble',
          }}
        />
      </div>
      {pageNodes.length ? (
        <div className="memory-documents-grid">
          {pageNodes.map((node) => (
            <MemoryFolder
              key={node.id}
              title={node.label}
              domain="Memory"
              summary={memoryText(node)}
              date={String(node.metadata.date || node.metadata.year || 'Memory record')}
              selected={selectedNode?.id === node.id}
              onOpen={() => setSelectedNode(node)}
            />
          ))}
        </div>
      ) : <div className="memory-workspace__empty"><strong>No matching memories</strong><p>Try another search or folder.</p></div>}
      {totalPages > 1 ? (
        <footer className="memory-documents-panel__pagination">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
        </footer>
      ) : null}
      {selectedNode ? (
        <aside className="memory-document-preview" aria-live="polite">
          <button type="button" aria-label="Close memory preview" onClick={() => setSelectedNode(null)}>×</button>
          <span>Memory</span>
          <h2>{selectedNode.label}</h2>
          <p>{memoryText(selectedNode)}</p>
          <small>{selectedNode.id}</small>
        </aside>
      ) : null}
    </section>
  )
}

export default function MemoryWorkspace({ mode, token, demoMode, onAuthenticationRequired }: MemoryWorkspaceProps) {
  const [data, setData] = useState<MemoryGraphData | null>(() => demoMode ? DEMO_MEMORY_GRAPH : null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!demoMode)
  const [search, setSearch] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    if (demoMode) {
      setData(DEMO_MEMORY_GRAPH)
      setError(null)
      setLoading(false)
      return
    }
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setData(await fetchMemoryGraph(token, signal))
    } catch (nextError) {
      if (signal?.aborted) return
      if (nextError instanceof MemoryGraphHttpError && nextError.status === 401) {
        onAuthenticationRequired()
        return
      }
      setError(nextError instanceof Error ? nextError.message : 'Memory graph is temporarily unavailable.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [demoMode, onAuthenticationRequired, token])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (loading && !data) {
    return <section className="memory-workspace memory-workspace--state" role="status"><span className="memory-workspace__spinner" /><strong>Growing your memory map…</strong></section>
  }
  if (error && !data) {
    return <section className="memory-workspace memory-workspace--state" role="alert"><strong>Memory could not be loaded.</strong><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></section>
  }
  if (!data || data.nodes.length === 0) {
    return <section className="memory-workspace memory-workspace--state"><strong>No memories yet.</strong><p>Saved context will appear here as a graph and document library.</p></section>
  }

  return (
    <section className="memory-workspace">
      {error ? <div className="dashboard-alert" role="status">{error}</div> : null}
      {mode === 'graph'
        ? <MemoryGraphPanel data={data} search={search} onSearchChange={setSearch} />
        : <MemoryDocumentsPanel data={data} search={search} onSearchChange={setSearch} />}
    </section>
  )
}
