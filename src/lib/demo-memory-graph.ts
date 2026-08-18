import type { MemoryEdge, MemoryGraphData, MemoryNode } from './memory-graph'

interface DemoMemoryRecord {
  domain: string
  label: string
  content: string
  date: string
}

const DEMO_MEMORY_RECORDS: DemoMemoryRecord[] = [
  { domain: 'preferences', label: 'Communication style', content: 'Lead with the outcome, keep updates concise, and explain technical tradeoffs in plain language.', date: 'Aug 14, 2026' },
  { domain: 'preferences', label: 'Safe workspace changes', content: 'Preserve unrelated edits and keep implementation work narrowly scoped to the requested feature.', date: 'Aug 13, 2026' },
  { domain: 'preferences', label: 'UI design direction', content: 'Use calm surfaces, tactile controls, compact spacing, and consistent interaction patterns across the product.', date: 'Aug 12, 2026' },
  { domain: 'preferences', label: 'Validation expectations', content: 'Separate checks that passed from checks that were unavailable or intentionally skipped.', date: 'Aug 11, 2026' },
  { domain: 'preferences', label: 'Deployment boundaries', content: 'Do not deploy, restart services, or start local servers without explicit approval.', date: 'Aug 10, 2026' },
  { domain: 'preferences', label: 'Research style', content: 'Ground recommendations in actual source code, current routes, and representative user flows.', date: 'Aug 09, 2026' },

  { domain: 'projects', label: 'xCode dashboard', content: 'A focused workspace for memory exploration, API key management, billing, and Company Brain access.', date: 'Aug 14, 2026' },
  { domain: 'projects', label: 'Company Brain', content: 'A shared organizational memory layer with connectors, inbox workflows, and role-aware administration.', date: 'Aug 13, 2026' },
  { domain: 'projects', label: 'Memory service', content: 'The core memory API stores structured context and exposes graph, search, billing, and account capabilities.', date: 'Aug 12, 2026' },
  { domain: 'projects', label: 'MemCode agent', content: 'A terminal-first coding agent that recalls repository decisions and implementation details over time.', date: 'Aug 11, 2026' },
  { domain: 'projects', label: 'Dashboard authentication', content: 'Google sign-in creates an authenticated dashboard session before private account data is loaded.', date: 'Aug 10, 2026' },
  { domain: 'projects', label: 'Memory documents', content: 'Saved context is also browsable as familiar folders and documents grouped by memory domain.', date: 'Aug 09, 2026' },

  { domain: 'people', label: 'Product owner', content: 'Owns the product direction and prefers implementation choices to stay close to established components.', date: 'Aug 14, 2026' },
  { domain: 'people', label: 'Engineering team', content: 'Maintains the dashboard, Memory API, integrations, and deployment infrastructure.', date: 'Aug 13, 2026' },
  { domain: 'people', label: 'Company administrators', content: 'Manage shared connectors, billing, API access, and organization settings.', date: 'Aug 12, 2026' },
  { domain: 'people', label: 'Dashboard members', content: 'Browse shared memory and use connected tools according to their assigned organization role.', date: 'Aug 11, 2026' },
  { domain: 'people', label: 'API consumers', content: 'Integrate memory retrieval and ingestion into applications using scoped API keys.', date: 'Aug 10, 2026' },
  { domain: 'people', label: 'Pilot customers', content: 'Early teams validate shared-memory workflows before broader product rollout.', date: 'Aug 09, 2026' },

  { domain: 'decisions', label: 'Five-item product dock', content: 'The primary dashboard navigation contains Dashboard, Memory Graph, Memory Documents, API Keys, and Billing.', date: 'Aug 14, 2026' },
  { domain: 'decisions', label: 'Server-side referral validation', content: 'Referral codes remain opaque in the frontend and are checked only by the authenticated billing service.', date: 'Aug 14, 2026' },
  { domain: 'decisions', label: 'Razorpay verification', content: 'Credits and invoices are created only after the backend verifies a completed Razorpay payment.', date: 'Aug 13, 2026' },
  { domain: 'decisions', label: 'Receipt printer flow', content: 'A tactile receipt animation communicates processing, printing, and completed payment states.', date: 'Aug 12, 2026' },
  { domain: 'decisions', label: 'Graph endpoint compatibility', content: 'The dashboard prefers the v2 memory graph route while retaining a compatible fallback during migration.', date: 'Aug 11, 2026' },
  { domain: 'decisions', label: 'Keys shown once', content: 'New secret API keys are revealed once and stored views show only masked identifiers.', date: 'Aug 10, 2026' },

  { domain: 'workflows', label: 'Add a memory', content: 'Capture useful context, normalize its metadata, and connect it to related saved knowledge.', date: 'Aug 14, 2026' },
  { domain: 'workflows', label: 'Explore the graph', content: 'Search across nodes, inspect relationships, and open a memory to view its full context.', date: 'Aug 13, 2026' },
  { domain: 'workflows', label: 'Browse by folder', content: 'Filter documents by domain, page through memories, and preview individual records.', date: 'Aug 12, 2026' },
  { domain: 'workflows', label: 'Create an API key', content: 'Choose a descriptive name, generate a scoped credential, and copy the secret before dismissing it.', date: 'Aug 11, 2026' },
  { domain: 'workflows', label: 'Purchase credits', content: 'Choose a credit package, complete Razorpay checkout, and retain the generated invoice in billing history.', date: 'Aug 10, 2026' },
  { domain: 'workflows', label: 'Redeem a referral', content: 'Submit an opaque code to the billing service and refresh the balance after a successful grant.', date: 'Aug 09, 2026' },

  { domain: 'research', label: 'Memory graph patterns', content: 'Clusters make broad domains visible while cross-links reveal decisions that influence multiple projects.', date: 'Aug 14, 2026' },
  { domain: 'research', label: 'Document browsing patterns', content: 'Folder metaphors help users scan large collections without requiring graph familiarity.', date: 'Aug 13, 2026' },
  { domain: 'research', label: 'Subtle credential design', content: 'Masked values, restrained actions, and one-time reveal states reduce accidental secret exposure.', date: 'Aug 12, 2026' },
  { domain: 'research', label: 'Billing trust signals', content: 'Clear verification states and persistent invoices make small credit purchases feel dependable.', date: 'Aug 11, 2026' },
  { domain: 'research', label: 'Navigation consistency', content: 'Reusing the established dock preserves learned behavior between personal and company workspaces.', date: 'Aug 10, 2026' },
  { domain: 'research', label: 'Progressive disclosure', content: 'Show a concise overview first, then reveal detailed memory metadata only when a user selects a record.', date: 'Aug 09, 2026' },
]

const nodes: MemoryNode[] = DEMO_MEMORY_RECORDS.map((record, index) => ({
  id: `demo-memory-${String(index + 1).padStart(2, '0')}`,
  type: record.domain,
  label: record.label,
  metadata: {
    content: record.content,
    date: record.date,
    source: 'Demo workspace',
  },
}))

const relatedEdges: MemoryEdge[] = nodes.flatMap((node, index) => {
  const edges: MemoryEdge[] = []
  const nextNode = nodes[index + 1]
  if (nextNode && nextNode.type === node.type) {
    edges.push({ source: node.id, target: nextNode.id, type: 'related', strength: 0.72 })
  }
  const crossDomainNode = nodes[index + 6]
  if (crossDomainNode) {
    edges.push({ source: node.id, target: crossDomainNode.id, type: 'influences', strength: 0.58 })
  }
  return edges
})

export const DEMO_MEMORY_GRAPH: MemoryGraphData = {
  nodes,
  edges: relatedEdges,
  total_memories: nodes.length,
  domains: Array.from(new Set(nodes.map((node) => node.type))),
  limit: nodes.length,
  offset: 0,
  has_more: false,
}
