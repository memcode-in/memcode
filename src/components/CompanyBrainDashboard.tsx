import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  brainBillingPeriodDaysRemaining,
  brainSubscriptionContinuityPhase,
  canViewBrainUsage,
  type BrainDashboard,
} from '../lib/brain-dashboard'
import { BRAIN_API_URL } from '../lib/api'
import { organizationScopedHeaders } from '../lib/brain-organization-context'
import { userFacingErrorMessage } from '../lib/user-facing-errors'
import { MemoryOrb } from './MemoryOrb'
import BrainCodeModeSettings from './BrainCodeModeSettings'
import BrainAgentMailSettings from './BrainAgentMailSettings'
import BrainRuntimeSettings from './BrainRuntimeSettings'
import BrainByokSpend from './BrainByokSpend'
import {
  BrainIntegrationHttpError,
  connectBrainIntegration,
  fetchBrainIntegrations,
  revokeBrainIntegration,
  setBrainIntegrationEnabled,
  setBrainIntegrationExecutionPolicy,
  type BrainIntegration,
  type BrainIntegrationClientSetup,
  type BrainIntegrationConnection,
  type BrainIntegrationCustomAuthMode,
  type BrainIntegrationKind,
  type BrainIntegrationScope,
} from '../lib/brain-integrations'

export type OrganizationDashboardState = 'loading' | 'ready' | 'unavailable'
export type CompanyBrainDashboardView = 'usage' | 'company' | 'connectors' | 'settings' | 'code' | 'mcp'

interface CompanyBrainDashboardProps {
  dashboard: BrainDashboard | null
  state: OrganizationDashboardState
  warning: string | null
  view: CompanyBrainDashboardView
  demoMode: boolean
  onAuthenticationRequired: () => void
  onOpenPricing: () => void
}

type DashboardMemorySpace = BrainDashboard['memory']['spaces'][number]
type OperationalActivity = NonNullable<BrainDashboard['activity']>

interface ActivityMetric {
  label: string
  value: number
}

type ConnectorFilter = 'all' | 'active' | 'ai-clients' | 'offline' | 'beta'
type ConnectorSurface = 'connectors' | 'mcp'
type ConnectorIconName = 'memory' | 'slack' | 'github' | 'linear' | 'notion' | 'terminal' | 'bot' | 'cursor' | 'drive' | 'mail' | 'agentmail' | 'jira' | 'codex' | 'claude' | 'otter' | 'composio' | 'posthog' | 'sentry' | 'linkedin'
type ExecutionPolicyCapabilityId = 'read_operations' | 'approved_writes'

function isExecutionPolicyCapabilityId(value: string): value is ExecutionPolicyCapabilityId {
  return value === 'read_operations' || value === 'approved_writes'
}

const CONNECTOR_BRAND_ASSETS: Partial<Record<ConnectorIconName, {
  src: string
  needsDarkContrast?: boolean
}>> = {
  slack: { src: '/brands/slack.png' },
  github: { src: '/brands/github.png', needsDarkContrast: true },
  linear: { src: '/brands/linear.png' },
  mail: { src: '/brands/gmail.png' },
  drive: { src: '/brands/google_drive.png' },
  notion: { src: '/brands/notion.png', needsDarkContrast: true },
  codex: { src: '/brands/chatgpt.png', needsDarkContrast: true },
  claude: { src: '/brands/claude.png' },
  cursor: { src: '/brands/cursor.png' },
  otter: { src: '/brands/otter.png' },
  composio: { src: '/brands/composio.png', needsDarkContrast: true },
  posthog: { src: '/brands/posthog.png' },
  sentry: { src: '/brands/sentry.png' },
  linkedin: { src: '/brands/linkedin.png' },
}

const CONNECTOR_FILTERS: readonly { id: ConnectorFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'ai-clients', label: 'AI clients' },
  { id: 'offline', label: 'Offline' },
  { id: 'beta', label: 'Coming soon' },
]

function integrationMatchesSurface(integration: BrainIntegration, surface: ConnectorSurface) {
  const isMcpIntegration = integration.kind === 'client_mcp' || integration.kind === 'custom_connection'
  return surface === 'mcp' ? isMcpIntegration : !isMcpIntegration
}

function connectorIconName(slug: string): ConnectorIconName {
  const icons: Record<string, ConnectorIconName> = {
    slack: 'slack',
    github: 'github',
    linear: 'linear',
    notion: 'notion',
    'codex-mcp': 'codex',
    'claude-mcp': 'claude',
    'cursor-mcp': 'cursor',
    'google-drive': 'drive',
    gmail: 'mail',
    'company-email': 'agentmail',
    agentmail: 'agentmail',
    jira: 'jira',
    otter: 'otter',
    composio: 'composio',
    posthog: 'posthog',
    sentry: 'sentry',
    linkedin: 'linkedin',
    'custom-mcp': 'terminal',
  }
  return icons[slug] ?? 'terminal'
}

const DEMO_SLACK_CAPABILITIES: BrainIntegration['capabilities'] = [
  {
    id: 'channel_ingestion',
    name: 'Channel ingestion',
    description: 'Capture supported Slack conversations into organization-scoped memory.',
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'thread_context',
    name: 'Thread context',
    description: 'Read and answer with the current Slack thread as bounded context.',
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'permission_scopes',
    name: 'Permission-scoped memory',
    description: 'Keep public, private-channel, and personal DM memory boundaries separate.',
    supported: true,
    enabled: false,
    configurable: false,
  },
]

const DEMO_CONNECTED_APP_CAPABILITIES: BrainIntegration['capabilities'] = [
  {
    id: 'live_tools',
    name: 'Live tools',
    description: 'Discover tools exposed by the authorized provider at request time.',
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'read_operations',
    name: 'Read operations',
    description: "Use provider reads within the signed-in member's connection scope.",
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'approved_writes',
    name: 'Writes with approval',
    description: 'Allow consequential provider actions only after requester-owned approval.',
    supported: true,
    enabled: false,
    configurable: false,
  },
]

const DEMO_CLIENT_CAPABILITIES: BrainIntegration['capabilities'] = [
  {
    id: 'scoped_search',
    name: 'Scoped search',
    description: 'Search only memory spaces authorized for the signed-in member.',
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'memory_write',
    name: 'Memory write',
    description: 'Store approved client context with source and ownership metadata.',
    supported: true,
    enabled: false,
    configurable: false,
  },
  {
    id: 'tool_permissions',
    name: 'Tool permissions',
    description: 'Limit exposed tools through organization policy.',
    supported: true,
    enabled: false,
    configurable: false,
  },
]

interface DemoIntegrationSeed {
  slug: string
  name: string
  category: string
  description: string
  version: string
  kind: BrainIntegrationKind
  availability: BrainIntegration['availability']
  authType: BrainIntegration['auth_type']
  scopeOptions: BrainIntegrationScope[]
  capabilities?: BrainIntegration['capabilities']
  unavailableReason?: string
}

const DEMO_INTEGRATION_SEEDS: DemoIntegrationSeed[] = [
  {
    slug: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Real-time messaging and governed workspace memory.',
    version: 'OAuth v2',
    kind: 'slack',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['organization'],
    capabilities: DEMO_SLACK_CAPABILITIES,
  },
  {
    slug: 'github',
    name: 'GitHub',
    category: 'Code',
    description: 'Use authorized GitHub tools for live repository, issue, and pull-request context.',
    version: 'Live tools',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal', 'organization'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'composio',
    name: 'Composio',
    category: 'Tool gateway',
    description: 'Use explicitly connected apps through Composio as permission-scoped live tools.',
    version: 'Composio Connect',
    kind: 'connected_app',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['personal'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'codex-mcp',
    name: 'Codex',
    category: 'AI clients',
    description: 'Give Codex permission-scoped access to Company Brain.',
    version: 'Secure access',
    kind: 'client_mcp',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['personal'],
    capabilities: DEMO_CLIENT_CAPABILITIES,
  },
  {
    slug: 'claude-mcp',
    name: 'Claude Code',
    category: 'AI clients',
    description: 'Give Claude Code permission-scoped access to Company Brain.',
    version: 'Secure access',
    kind: 'client_mcp',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['personal'],
    capabilities: DEMO_CLIENT_CAPABILITIES,
  },
  {
    slug: 'cursor-mcp',
    name: 'Cursor',
    category: 'AI clients',
    description: 'Give Cursor permission-scoped access to Company Brain.',
    version: 'Secure access',
    kind: 'client_mcp',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['personal'],
    capabilities: DEMO_CLIENT_CAPABILITIES,
  },
  {
    slug: 'linear',
    name: 'Linear',
    category: 'Project management',
    description: 'Use authorized Linear tools for live issue, project, and cycle context.',
    version: 'Live tools',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal', 'organization'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'notion',
    name: 'Notion',
    category: 'Knowledge',
    description: 'Use authorized Notion tools for live page and database context.',
    version: 'Live tools',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal', 'organization'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'google-drive',
    name: 'Google Drive',
    category: 'Documents',
    description: 'Search and read files available to the signed-in member through Google Drive.',
    version: 'Developer Preview',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    category: 'Email',
    description: "Search and read the signed-in member's mailbox; changes require explicit approval.",
    version: 'Developer Preview',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'company-email',
    name: 'Company email',
    category: 'Email',
    description: 'Give the organization one shared inbox for governed mail reads, drafts, and approved sends.',
    version: 'Organization inbox',
    kind: 'connected_app',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['organization'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'jira',
    name: 'Jira',
    category: 'Project management',
    description: 'Use Jira work visible to the signed-in member; changes require explicit approval.',
    version: 'OAuth 2.1',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'otter',
    name: 'Otter',
    category: 'Meetings',
    description: 'Search meeting transcripts, summaries, and action items visible to the signed-in member.',
    version: 'OAuth',
    kind: 'connected_app',
    availability: 'available',
    authType: 'oauth',
    scopeOptions: ['personal'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
  {
    slug: 'custom-mcp',
    name: 'Custom MCP',
    category: 'Developer tools',
    description: 'Connect a server hosted on a deployment-approved domain.',
    version: 'Admin allowlist',
    kind: 'custom_connection',
    availability: 'available',
    authType: 'static',
    scopeOptions: ['personal', 'organization'],
    capabilities: DEMO_CONNECTED_APP_CAPABILITIES,
  },
]

const DEMO_BRAIN_INTEGRATIONS: BrainIntegration[] = DEMO_INTEGRATION_SEEDS.map((integration) => ({
  slug: integration.slug,
  name: integration.name,
  category: integration.category,
  description: integration.description,
  version: integration.version,
  kind: integration.kind,
  availability: integration.availability,
  status: integration.availability === 'coming_soon' ? 'coming_soon' : 'offline',
  status_reason: integration.unavailableReason ?? 'Sign in to connect this integration.',
  auth_type: integration.authType,
  scope_options: integration.scopeOptions,
  utilization: null,
  last_sync_at: null,
  capabilities: integration.capabilities ?? [],
  connections: [],
  actions: {
    connect: {
      enabled: false,
      method: 'POST',
      path: null,
      reason: integration.unavailableReason ?? 'Sign in to connect this integration.',
    },
    reconnect: {
      enabled: false,
      method: 'POST',
      path: null,
      reason: integration.unavailableReason ?? 'No connection is available in read-only demo mode.',
    },
  },
}))

function ConnectorIcon({ name }: { name: ConnectorIconName }) {
  const brandAsset = CONNECTOR_BRAND_ASSETS[name]
  if (brandAsset) {
    return (
      <img
        className={brandAsset.needsDarkContrast ? 'needs-dark-contrast' : undefined}
        src={brandAsset.src}
        alt=""
        decoding="async"
      />
    )
  }
  if (name === 'memory') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></svg>
  }
  if (name === 'github') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v3c0 2 1.8 3 4 3h2M18 8v2c0 2-1.8 3-4 3h-2v4"/></svg>
  }
  if (name === 'linear') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16.5 16.5 5M4 11a9 9 0 0 0 9 9M4.5 7.5A9 9 0 0 1 16.5 4M8 19.1 19.1 8"/></svg>
  }
  if (name === 'bot') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M8.5 12h.01M15.5 12h.01M9 16h6M3 11v4M21 11v4"/></svg>
  }
  if (name === 'agentmail') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6M8 16h8"/></svg>
  }
  if (name === 'drive') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-6 11 3.5 6h11l3.5-6-6-11H9Z"/><path d="m9 3 6.5 11M21 14H3M6.5 20l6-10.5"/></svg>
  }
  if (name === 'jira') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 7-7 11-7-11 7-7Z"/><path d="m8.5 10 3.5 3.5 3.5-3.5L12 6.5 8.5 10Z"/></svg>
  }
  if (name === 'otter') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5a7 7 0 0 1 14 0v5a7 7 0 0 1-14 0v-5Z"/><path d="M8 7 5 4M16 7l3-3M8.5 13h.01M15.5 13h.01M9.5 17c1.7 1.2 3.3 1.2 5 0"/></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>
}

function SyncIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 2M17.9 15A7 7 0 0 1 6 18l-2-2"/></svg>
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function formatBytes(value: number) {
  if (value < 1024) return `${formatNumber(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024
    unit = units[index]
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(amount)} ${unit}`
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function formatActivityTimestamp(value?: string | null) {
  if (!value) return 'No activity yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Activity time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatMoney(amountInMinorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountInMinorUnits / 100)
  } catch {
    return `${currency} ${(amountInMinorUnits / 100).toFixed(2)}`
  }
}

function formatLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function ClientSetupPanel({
  name,
  setup,
  copiedKey,
  tokenVisible,
  onCopy,
  onToggleToken,
  onDismiss,
}: {
  name: string
  setup: BrainIntegrationClientSetup
  copiedKey: string | null
  tokenVisible: boolean
  onCopy: (key: string, value: string) => void
  onToggleToken: () => void
  onDismiss: () => void
}) {
  return (
    <section className="brain-client-setup" aria-labelledby="brain-client-setup-title">
      <header>
        <div>
          <span>One-time setup</span>
          <strong id="brain-client-setup-title">Connect {name}</strong>
          <small>
            This token is shown only in this session. The commands use macOS Keychain: store it once,
            configure the client, then use the final launch command each time. On Windows or Linux,
            inject the named variable from your OS secret manager whenever the client starts. Never
            paste the token into a command or shell history.
          </small>
        </div>
        <button type="button" onClick={onDismiss}>Close</button>
      </header>

      <div className="brain-client-setup__field">
        <span>Server URL</span>
        <code>{setup.server_url}</code>
        <button type="button" onClick={() => onCopy('server', setup.server_url)}>
          {copiedKey === 'server' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="brain-client-setup__field">
        <span>{setup.environment_variable}</span>
        <code>{tokenVisible ? setup.token : '••••••••••••••••••••••••'}</code>
        <div>
          <button type="button" onClick={onToggleToken}>{tokenVisible ? 'Hide' : 'Reveal'}</button>
          <button type="button" onClick={() => onCopy('token', setup.token)}>
            {copiedKey === 'token' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {setup.commands.map((command, index) => (
        <div className="brain-client-setup__snippet" key={`command:${index}`}>
          <span>Command {index + 1}</span>
          <pre>{command}</pre>
          <button type="button" onClick={() => onCopy(`command:${index}`, command)}>
            {copiedKey === `command:${index}` ? 'Copied' : 'Copy command'}
          </button>
        </div>
      ))}

      <div className="brain-client-setup__snippet">
        <span>Configuration</span>
        <pre>{setup.config}</pre>
        <button type="button" onClick={() => onCopy('config', setup.config)}>
          {copiedKey === 'config' ? 'Copied' : 'Copy configuration'}
        </button>
      </div>
      <small className="brain-client-setup__expiry">Expires {formatActivityTimestamp(setup.expires_at)}</small>
    </section>
  )
}

function StaticKeyConnectionForm({
  name,
  scope,
  busy,
  disabled,
  onConnect,
}: {
  name: string
  scope: BrainIntegrationScope | undefined
  busy: boolean
  disabled: boolean
  onConnect: (input: { secret: string; scope: BrainIntegrationScope }) => Promise<boolean>
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  const secretRef = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scope || busy || disabled) return
    const secret = secretRef.current?.value.trim() ?? ''
    if (!secret) {
      setValidationError(`Enter your ${name} consumer API key.`)
      return
    }
    setValidationError(null)
    const connected = await onConnect({ secret, scope })
    if (connected && secretRef.current) secretRef.current.value = ''
  }

  return (
    <form className="brain-custom-connection brain-static-key-connection" onSubmit={(event) => void submit(event)}>
      <div className="brain-custom-connection__heading">
        <div>
          <strong>Connect {name}</strong>
          <span>Add your Composio Connect consumer API key. This connection stays personal to your account.</span>
        </div>
      </div>
      <label className="brain-static-key-connection__key">
        <span>Consumer API key</span>
        <input
          ref={secretRef}
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20_000}
          placeholder="Composio API key"
          disabled={busy || disabled}
          required
        />
      </label>
      {validationError ? <p role="alert">{validationError}</p> : null}
      <button
        type="submit"
        className="brain-connector-action-button"
        disabled={busy || disabled || !scope}
      >{busy ? 'Connecting…' : 'Connect'}</button>
    </form>
  )
}

function CustomConnectionForm({
  name,
  scope,
  scopeOptions,
  busy,
  disabled,
  onScopeChange,
  onConnect,
}: {
  name: string
  scope: BrainIntegrationScope | undefined
  scopeOptions: BrainIntegrationScope[]
  busy: boolean
  disabled: boolean
  onScopeChange: (scope: BrainIntegrationScope) => void
  onConnect: (input: {
    endpointUrl: string
    authMode: BrainIntegrationCustomAuthMode
    secret?: string
    scope: BrainIntegrationScope
  }) => Promise<boolean>
}) {
  const [endpointUrl, setEndpointUrl] = useState('')
  const [authMode, setAuthMode] = useState<BrainIntegrationCustomAuthMode>('none')
  const [validationError, setValidationError] = useState<string | null>(null)
  const secretRef = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scope || busy || disabled) return
    const secret = secretRef.current?.value.trim() ?? ''
    if (authMode !== 'none' && !secret) {
      setValidationError('Enter the credential for this authentication mode.')
      return
    }

    let normalizedEndpoint: string
    try {
      const parsed = new URL(endpointUrl.trim())
      if (
        parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash
        || (parsed.port && parsed.port !== '443')
      ) throw new Error()
      normalizedEndpoint = parsed.toString()
    } catch {
      setValidationError('Use an approved HTTPS endpoint without credentials, fragments, or a custom port.')
      return
    }

    setValidationError(null)
    const connected = await onConnect({
      endpointUrl: normalizedEndpoint,
      authMode,
      ...(authMode !== 'none' ? { secret } : {}),
      scope,
    })
    if (!connected) return
    setEndpointUrl('')
    setAuthMode('none')
    if (secretRef.current) secretRef.current.value = ''
  }

  return (
    <form className="brain-custom-connection" onSubmit={(event) => void submit(event)}>
      <div className="brain-custom-connection__heading">
        <div>
          <strong>Connect {name}</strong>
          <span>Credentials are sent only on submit and are never persisted by this dashboard.</span>
        </div>
      </div>
      <label>
        <span>Endpoint URL</span>
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://tools.example.com/endpoint"
          value={endpointUrl}
          onChange={(event) => setEndpointUrl(event.target.value)}
          disabled={busy || disabled}
          required
        />
      </label>
      <label>
        <span>Authentication</span>
        <select
          value={authMode}
          onChange={(event) => setAuthMode(event.target.value as BrainIntegrationCustomAuthMode)}
          disabled={busy || disabled}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="x-api-key">X-API-Key</option>
        </select>
      </label>
      {authMode !== 'none' ? (
        <label>
          <span>Secret</span>
          <input
            ref={secretRef}
            type="password"
            autoComplete="new-password"
            placeholder={authMode === 'bearer' ? 'Bearer token' : 'API key'}
            disabled={busy || disabled}
            required
          />
        </label>
      ) : null}
      <label>
        <span>Scope</span>
        <select
          value={scope ?? ''}
          onChange={(event) => onScopeChange(event.target.value as BrainIntegrationScope)}
          disabled={busy || disabled || scopeOptions.length < 2}
          required
        >
          {scopeOptions.map((option) => <option value={option} key={option}>{formatLabel(option)}</option>)}
        </select>
      </label>
      {validationError ? <p role="alert">{validationError}</p> : null}
      <button
        type="submit"
        className="brain-connector-action-button"
        disabled={busy || disabled || !scope}
      >{busy ? 'Connecting…' : 'Connect'}</button>
    </form>
  )
}

function DataState({ state, warning }: { state: OrganizationDashboardState; warning: string | null }) {
  return (
    <section className="brain-panel brain-panel--state" aria-live="polite">
      <strong>{state === 'loading' ? 'Loading Company Brain…' : 'Company Brain is unavailable.'}</strong>
      <p>{state === 'loading' ? 'Fetching your organization-scoped data.' : warning || 'Try refreshing the dashboard.'}</p>
    </section>
  )
}

function UsageAccessState({ organizationName }: { organizationName: string }) {
  return (
    <section className="brain-panel brain-panel--state" role="status">
      <strong>Usage is available to organization administrators.</strong>
      <p>You are a member of {organizationName}. Ask an admin or owner to review usage, plan limits, and charges.</p>
    </section>
  )
}

function UsageCounter({
  name,
  used,
  limit,
  percent,
}: {
  name: string
  used: number
  limit: number | null | undefined
  percent: number | null
}) {
  const presentation = usageCounterPresentation(name)
  const percentageLabel = percent === null ? 'No fixed limit' : `${percent}%`
  const exactCreditLabel = name === 'managed_web_credits' && typeof limit === 'number'
    ? `${formatNumber(used)} of ${formatNumber(limit)} credits used`
    : null

  return (
    <article className="brain-usage-row" aria-label={`${presentation.label}: ${exactCreditLabel ?? percentageLabel}`}>
      <div className="brain-usage-row__copy">
        <strong>{presentation.label}</strong>
        <small>{presentation.detail}</small>
      </div>
      <div className="brain-usage-row__value">
        <strong>{exactCreditLabel ?? percentageLabel}</strong>
        {exactCreditLabel || percent === null ? null : <span>used</span>}
      </div>
      <div
        className="brain-usage-row__meter"
        {...(percent === null ? {} : {
          role: 'progressbar',
          'aria-label': `${presentation.label} allowance used`,
          'aria-valuemin': 0,
          'aria-valuenow': percent,
          'aria-valuemax': 100,
          'aria-valuetext': `${percent}% used`,
        })}
      >
        <i style={{ width: percent === null ? '0%' : `${percent}%` }} />
      </div>
    </article>
  )
}

const USAGE_COUNTER_ORDER = [
  'model_turns',
  'input_tokens',
  'output_tokens',
  'connected_app_calls',
  'managed_web_credits',
  'research_calls',
  'sandbox_seconds',
] as const

type UsageCounterGroup = 'model' | 'operations'

const USAGE_COUNTER_PRESENTATION: Record<string, { label: string; detail: string; group: UsageCounterGroup }> = {
  model_turns: {
    label: 'Model activity',
    detail: 'Reasoning and response work completed this period.',
    group: 'model',
  },
  input_tokens: {
    label: 'Input processing',
    detail: 'Context processed across Company Brain requests.',
    group: 'model',
  },
  output_tokens: {
    label: 'Generated output',
    detail: 'Responses produced by Company Brain.',
    group: 'model',
  },
  connected_app_calls: {
    label: 'Connected apps',
    detail: 'Requests made through authorized integrations.',
    group: 'operations',
  },
  managed_web_credits: {
    label: 'Managed web credits',
    detail: 'Firecrawl credits used by delegated Web Agent tasks.',
    group: 'operations',
  },
  research_calls: {
    label: 'Research',
    detail: 'Web research requests used to build sourced context.',
    group: 'operations',
  },
  sandbox_seconds: {
    label: 'Sandbox runtime',
    detail: 'Isolated execution time used by Company Brain.',
    group: 'operations',
  },
  memories_written: {
    label: 'Memory writes',
    detail: 'Company knowledge added to the memory layer.',
    group: 'operations',
  },
  retrievals: {
    label: 'Memory retrievals',
    detail: 'Stored context recalled for Company Brain work.',
    group: 'operations',
  },
}

function usageCounterPresentation(name: string) {
  return USAGE_COUNTER_PRESENTATION[name] ?? {
    label: formatLabel(name),
    detail: 'Metered Company Brain operation.',
    group: 'operations' as const,
  }
}

function usagePercent(used: number, limit: number | null | undefined) {
  return typeof limit === 'number' && limit > 0
    ? Math.min(100, Math.round((used / limit) * 100))
    : null
}

function orderedUsageEntries(counters?: Record<string, number>) {
  if (!counters) return []
  const priority = new Map<string, number>(USAGE_COUNTER_ORDER.map((name, index) => [name, index]))
  return Object.entries(counters).sort(([left], [right]) => {
    const leftPriority = priority.get(left)
    const rightPriority = priority.get(right)
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER)
    }
    return left.localeCompare(right)
  })
}

function ActivityMetricGroup({
  id,
  label,
  title,
  description,
  latestActivityAt,
  metrics,
}: {
  id: string
  label: string
  title: string
  description: string
  latestActivityAt: string | null
  metrics: readonly ActivityMetric[]
}) {
  return (
    <section className="brain-operational-group" aria-labelledby={id}>
      <header>
        <div>
          <span>{label}</span>
          <strong id={id}>{title}</strong>
          <small>{description}</small>
        </div>
        <small>Latest: {formatActivityTimestamp(latestActivityAt)}</small>
      </header>
      <dl>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{formatNumber(metric.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function OperationalActivity({ activity }: { activity: OperationalActivity }) {
  const slackEvents = activity.slack_events
  const turns = activity.turns
  const usageTotals = activity.usage_totals
  const memoryWrites = activity.memory_writes
  const publicHistory = activity.public_history

  return (
    <div className="brain-operational-grid">
      <ActivityMetricGroup
        id="brain-slack-activity-title"
        label="Operational records · not billing"
        title="Slack message handling"
        description="Safe lifecycle totals stored by Company Brain; message contents are not shown here."
        latestActivityAt={slackEvents.latest_activity_at}
        metrics={[
          { label: 'Events received', value: slackEvents.total },
          { label: 'Completed events', value: slackEvents.completed },
          { label: 'Replies sent', value: slackEvents.replied },
          { label: 'Silent outcomes', value: slackEvents.silent },
          { label: 'Processing now', value: slackEvents.processing },
          { label: 'Failed events', value: slackEvents.failed },
          { label: 'Superseded events', value: slackEvents.superseded },
          { label: 'Processing attempts', value: slackEvents.attempts },
        ]}
      />

      <ActivityMetricGroup
        id="brain-turn-activity-title"
        label="Agent execution"
        title="Conversation turns"
        description="Execution states recorded for Slack requests, separate from token and plan usage below."
        latestActivityAt={turns.latest_activity_at}
        metrics={[
          { label: 'Total turns', value: turns.total },
          { label: 'Completed turns', value: turns.completed },
          { label: 'Active turns', value: turns.active },
          { label: 'Failed turns', value: turns.failed },
          { label: 'Cancelled turns', value: turns.cancelled },
        ]}
      />

      <ActivityMetricGroup
        id="brain-cumulative-usage-title"
        label="Recorded history · not current quota"
        title="Cumulative recorded usage"
        description="Operational totals across persisted usage periods; model token volumes stay private."
        latestActivityAt={usageTotals.latest_activity_at}
        metrics={[
          { label: 'Recorded periods', value: usageTotals.periods },
          { label: 'Model turns', value: usageTotals.model_turns },
          { label: 'Connected app calls', value: usageTotals.connected_app_calls },
          { label: 'Research calls', value: usageTotals.research_calls },
          { label: 'Sandbox seconds', value: usageTotals.sandbox_seconds },
        ]}
      />

      <ActivityMetricGroup
        id="brain-memory-write-activity-title"
        label="Memory pipeline"
        title="Memory write status"
        description="Ingestion lifecycle records, not the memory service usage or stored-memory totals."
        latestActivityAt={memoryWrites.latest_activity_at}
        metrics={[
          { label: 'Write records', value: memoryWrites.total },
          { label: 'Ready', value: memoryWrites.ready },
          { label: 'Processing', value: memoryWrites.processing },
          { label: 'Failed', value: memoryWrites.failed },
        ]}
      />

      <ActivityMetricGroup
        id="brain-public-history-activity-title"
        label="Public history"
        title="Public Slack history imports"
        description="Organization-visible import totals only; private channels and direct messages are excluded."
        latestActivityAt={publicHistory.latest_activity_at}
        metrics={[
          { label: 'Import runs', value: publicHistory.runs.total },
          { label: 'Discovering', value: publicHistory.runs.discover },
          { label: 'Collecting', value: publicHistory.runs.collect },
          { label: 'Completed runs', value: publicHistory.runs.done },
          { label: 'Failed runs', value: publicHistory.runs.failed },
          { label: 'Messages found', value: publicHistory.messages },
          { label: 'Documents', value: publicHistory.documents.total },
          { label: 'Ready documents', value: publicHistory.documents.ready },
          { label: 'Pending documents', value: publicHistory.documents.pending },
          { label: 'Processing documents', value: publicHistory.documents.processing },
          { label: 'Failed documents', value: publicHistory.documents.failed },
        ]}
      />
    </div>
  )
}

function UsageView({ dashboard }: { dashboard: BrainDashboard }) {
  const { subscription, usage, permissions, activity, memory } = dashboard
  const byokUsage = dashboard.byok_usage ?? []
  const usageEntries = orderedUsageEntries(usage?.counters)
  const usageAllowances = usageEntries.map(([name, used]) => {
    const limit = usage?.limits?.[name]
    return {
      name,
      used,
      limit,
      percent: usagePercent(used, limit),
      presentation: usageCounterPresentation(name),
    }
  })
  const usageGroups = ([
    {
      id: 'model' as const,
      title: 'Managed model allowance',
      description: 'Model work charged to the managed plan. Usage on your own provider keys is tracked separately below.',
    },
    {
      id: 'operations' as const,
      title: 'Company operations',
      description: 'Managed web, tool, memory, integration, and isolated execution usage can still count toward plan limits.',
    },
  ]).map((group) => ({
    ...group,
    entries: usageAllowances.filter((entry) => entry.presentation.group === group.id),
  })).filter((group) => group.entries.length > 0)
  const peakAllowance = usageAllowances.reduce<(typeof usageAllowances)[number] | null>((peak, entry) => {
    if (entry.percent === null) return peak
    if (!peak || peak.percent === null || entry.percent > peak.percent) return entry
    return peak
  }, null)
  const peakPercent = peakAllowance?.percent ?? null
  const availablePercent = peakPercent === null ? null : Math.max(0, 100 - peakPercent)
  const memoryUsage = memory.usage
  const periodStart = usage?.period_start ?? subscription?.period_start
  const periodEnd = usage?.period_end ?? subscription?.period_end
  const periodLabel = periodStart && periodEnd
    ? `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
    : 'No billing period reported'
  const continuityNotice = usageContinuityNotice(subscription)

  return (
    <section className="brain-panel brain-usage" aria-labelledby="brain-usage-title">
      <header className="brain-usage-hero">
        <MemoryOrb size={88} className="brain-usage-hero__orb" />
        <div className="brain-usage-hero__summary">
          <h1 id="brain-usage-title">{subscription?.plan_name || 'No active plan'}</h1>
          <p className="brain-usage-hero__meta">
            <span>{periodLabel}</span>
            {subscription ? <span>{formatLabel(subscription.status)}</span> : null}
            {subscription ? <span>{formatLabel(subscription.billing_cycle)}</span> : null}
          </p>
        </div>
      </header>

      {continuityNotice ? (
        <aside className="brain-usage-continuity" role="status">
          <span>Plan continuity</span>
          <strong>{continuityNotice.title}</strong>
          <p>{continuityNotice.message}</p>
        </aside>
      ) : null}

      {usageEntries.length ? (
        <section className="brain-usage-capacity" aria-labelledby="brain-usage-capacity-title">
          <header>
            <div>
              <h2 id="brain-usage-capacity-title">Plan usage</h2>
              <p>Managed model allowance and platform resources used this period. Usage billed to your own provider keys is separate.</p>
            </div>
            <small>{periodEnd ? `Period ends ${formatDate(periodEnd)}` : 'Current billing period'}</small>
          </header>
          <div className="brain-usage-capacity__layout">
            <aside className="brain-usage-capacity__overview" aria-label="Available plan capacity">
              <span>Available capacity</span>
              <strong>{availablePercent === null ? '—' : `${availablePercent}%`}</strong>
              <p>
                {peakAllowance && peakPercent !== null
                  ? `${peakAllowance.presentation.label} is currently the highest-used allowance at ${peakPercent}%.`
                  : 'Company Brain has not reported fixed limits for this period.'}
              </p>
              <div
                className="brain-usage-capacity__meter"
                {...(peakPercent === null ? {} : {
                  role: 'progressbar',
                  'aria-label': 'Highest plan allowance used',
                  'aria-valuemin': 0,
                  'aria-valuenow': peakPercent,
                  'aria-valuemax': 100,
                  'aria-valuetext': `${peakPercent}% used`,
                })}
              >
                <i style={{ width: peakPercent === null ? '0%' : `${peakPercent}%` }} />
              </div>
              <dl>
                <div>
                  <dt>Highest use</dt>
                  <dd>{peakPercent === null ? 'No fixed limit' : `${peakPercent}%`}</dd>
                </div>
                <div>
                  <dt>Plan status</dt>
                  <dd>{peakPercent === null ? 'Metering active' : peakPercent >= 90 ? 'Near limit' : peakPercent >= 70 ? 'Monitor usage' : 'Healthy headroom'}</dd>
                </div>
              </dl>
            </aside>

            <div className="brain-usage-capacity__groups">
              {usageGroups.map((group) => (
                <section key={group.id} className="brain-usage-group" aria-labelledby={`brain-usage-group-${group.id}`}>
                  <header>
                    <h3 id={`brain-usage-group-${group.id}`}>{group.title}</h3>
                    <p>{group.description}</p>
                  </header>
                  <div className="brain-usage-list">
                    {group.entries.map((entry) => (
                      <UsageCounter
                        key={entry.name}
                        name={entry.name}
                        used={entry.used}
                        limit={entry.limit}
                        percent={entry.percent}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="brain-empty-state" role="status">
          <strong>No plan usage counters returned.</strong>
          <p>Spend billed to your provider keys is shown separately when BYOK resources are returned.</p>
        </div>
      )}

      <BrainByokSpend resources={byokUsage} />

      {activity ? (
        <details className="brain-operational-details" open>
          <summary>
            <span><strong>Operational details</strong><small>Slack delivery, agent execution, memory writes and history imports</small></span>
            <span className="brain-operational-details__toggle" aria-hidden="true">
              <span>Show details</span>
              <span>Hide details</span>
            </span>
          </summary>
          <OperationalActivity activity={activity} />
        </details>
      ) : null}

      {memoryUsage ? (
        <section className="brain-memory-usage brain-memory-usage--featured" aria-labelledby="brain-memory-usage-title">
          <header>
            <div>
              <span>Memory layer</span>
              <strong id="brain-memory-usage-title">What your company has stored and recalled</strong>
              <small>Reported directly by the configured memory service.</small>
            </div>
            <small>{memoryUsage.period}</small>
          </header>
          <div>
            <article><span>Ingests</span><strong>{formatNumber(memoryUsage.ingests)}</strong></article>
            <article><span>Searches</span><strong>{formatNumber(memoryUsage.searches)}</strong></article>
            <article><span>Retrievals</span><strong>{formatNumber(memoryUsage.retrievals)}</strong></article>
            <article><span>Stored memories</span><strong>{formatNumber(memoryUsage.stored_memories)}</strong></article>
            <article><span>Storage</span><strong>{formatBytes(memoryUsage.storage_bytes)}</strong></article>
            {permissions.view_financials
              && memoryUsage.cost_minor !== undefined
              && memoryUsage.currency
              ? <article><span>Memory cost</span><strong>{formatMoney(memoryUsage.cost_minor, memoryUsage.currency)}</strong></article>
              : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}

function usageContinuityNotice(subscription: BrainDashboard['subscription']) {
  if (!subscription) return null
  const phase = brainSubscriptionContinuityPhase(subscription)
  if (!phase) return null
  if (phase === 'past_due') {
    return {
      title: 'Your plan payment is past due.',
      message: 'Bring-your-own keys do not automatically bypass a past-due account. Resolve billing before starting new Brain turns.',
    }
  }
  if (phase === 'suspended') {
    return {
      title: 'Brain access is suspended.',
      message: 'Bring-your-own keys do not bypass an account suspension. Contact support or your workspace owner.',
    }
  }
  if (phase === 'ended') {
    return {
      title: 'Your plan access has ended.',
      message: 'A selected bring-your-own model can keep core Brain turns running. Selected own-provider web, sandbox, browser, and X resources remain provider-billed; managed variants require active plan access.',
    }
  }

  const accessExpiresAt = subscription.access_expires_at ?? subscription.period_end
  const daysRemaining = brainBillingPeriodDaysRemaining(accessExpiresAt)
  if (daysRemaining === null || daysRemaining < 0 || daysRemaining > 14) return null
  const timing = daysRemaining === 0
    ? 'today'
    : daysRemaining === 1
      ? 'in 1 day'
      : `in ${daysRemaining} days`

  return {
    title: `Your current plan access ends ${timing}.`,
    message: `Review Brain settings before ${formatDate(accessExpiresAt)} to confirm your own model key is ready for core turns. Selected own-provider web, sandbox, browser, and X resources stay provider-billed; managed variants can still count toward plan limits and require active access afterward.`,
  }
}

type CompanyOverviewIconName = 'people' | 'connectors' | 'usage' | 'knowledge' | 'activity'

function CompanyOverviewIcon({ name }: { name: CompanyOverviewIconName }) {
  if (name === 'people') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19a5 5 0 0 1 10 0M16 8a2.5 2.5 0 1 1 0 5M16 15.5A4 4 0 0 1 20.5 19" /></svg>
  }
  if (name === 'connectors') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V4M16 7V4M7 7h10v4a5 5 0 0 1-5 5v4M5 10h2M17 10h2" /></svg>
  }
  if (name === 'usage') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0M12 18l4-6M7 18h10" /></svg>
  }
  if (name === 'knowledge') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H11v17H8.5A3.5 3.5 0 0 0 5 22V5.5ZM19 5.5A3.5 3.5 0 0 0 15.5 2H13v17h2.5A3.5 3.5 0 0 1 19 22V5.5Z" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l4-4 3 3 5-7 4 3M4 5v14h16" /></svg>
}

function connectedSourceCount(spaces: DashboardMemorySpace[]) {
  return new Set(spaces
    .filter((space) => space.kind === 'public_channel' || space.kind === 'private_channel')
    .map((space) => space.name.split(/\s+[—–-]\s+/u)[0]?.trim().toLowerCase())
    .filter(Boolean)).size
}

function CompanyView({
  dashboard,
  demoMode,
  onAuthenticationRequired,
}: {
  dashboard: BrainDashboard
  demoMode: boolean
  onAuthenticationRequired: () => void
}) {
  const { organization, memory, viewer } = dashboard
  const [memberCount, setMemberCount] = useState<number | null>(demoMode ? 4 : null)
  const viewerFirstName = viewer.name.trim().split(/\s+/u)[0] || 'there'
  const connectorCount = connectedSourceCount(memory.spaces)
  const usagePercentages = dashboard.usage
    ? Object.entries(dashboard.usage.counters)
      .map(([name, used]) => usagePercent(used, dashboard.usage?.limits?.[name]))
      .filter((percent): percent is number => percent !== null)
    : []
  const peakUsage = usagePercentages.length ? Math.max(...usagePercentages) : null
  const sharedKnowledge = memory.organization.memory_count ?? memory.usage?.stored_memories ?? null
  const activitySignals = dashboard.activity
    ? [
        { label: 'Conversations', value: dashboard.activity.turns.completed },
        { label: 'Replies shared', value: dashboard.activity.slack_events.replied },
        { label: 'Knowledge added', value: dashboard.activity.memory_writes.ready },
      ]
    : memory.usage
      ? [
          { label: 'Knowledge added', value: memory.usage.ingests },
          { label: 'Context found', value: memory.usage.searches },
          { label: 'Memories recalled', value: memory.usage.retrievals },
        ]
      : [
          { label: 'Shared memories', value: memory.organization.memory_count ?? 0 },
          { label: 'Shared spaces', value: memory.organization.space_count ?? 0 },
          { label: 'Connected tools', value: connectorCount },
        ]

  useEffect(() => {
    if (demoMode) {
      setMemberCount(4)
      return
    }
    if (!dashboard.permissions.manage_members) {
      setMemberCount(null)
      return
    }

    const controller = new AbortController()
    void fetch(`${BRAIN_API_URL}/api/settings/members`, {
      credentials: 'include',
      headers: organizationScopedHeaders(undefined, organization.id),
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        onAuthenticationRequired()
        return
      }
      if (!response.ok) return
      const payload = (await response.json()) as { members?: unknown }
      if (!controller.signal.aborted && Array.isArray(payload.members)) {
        setMemberCount(payload.members.length)
      }
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMemberCount(null)
    })

    return () => controller.abort()
  }, [dashboard.permissions.manage_members, demoMode, onAuthenticationRequired, organization.id])

  return (
    <section className="brain-company-overview" aria-labelledby="brain-company-title">
      <header className="brain-company-intro">
        <h1 id="brain-company-title">Have a look around, {viewerFirstName}.</h1>
        <p>
          <span>Your company keeps moving every day.</span>
          <span>People are sharing useful context.</span>
          <span>Connected tools keep knowledge flowing.</span>
          <span>Company memory grows with every conversation.</span>
          <span>Private work always stays private.</span>
          <span>Shared knowledge stays easy to find.</span>
          <span>Recent activity appears just below.</span>
          <span>Usage stays visible without the noise.</span>
          <span>Search anything whenever you need it.</span>
        </p>
      </header>

      <div className="brain-bento-grid brain-company-bento">
        <article className="brain-bento-card brain-company-card">
          <CompanyOverviewIcon name="people" />
          <span>People in your team</span>
          <strong>{memberCount === null ? '1+' : formatNumber(memberCount)}</strong>
          <small>{memberCount === null ? 'Open Account for the full roster.' : 'Active organization members.'}</small>
        </article>

        <article className="brain-bento-card brain-company-card">
          <CompanyOverviewIcon name="connectors" />
          <span>Connectors connected</span>
          <strong>{formatNumber(connectorCount)}</strong>
          <small>Tools currently feeding company context.</small>
        </article>

        <article className="brain-bento-card brain-company-card">
          <CompanyOverviewIcon name="usage" />
          <span>Plan usage</span>
          <strong>{peakUsage === null ? '—' : `${peakUsage}%`}</strong>
          <small>Highest allowance used this period.</small>
        </article>

        <article className="brain-bento-card brain-company-card">
          <CompanyOverviewIcon name="knowledge" />
          <span>Shared knowledge</span>
          <strong>{sharedKnowledge === null ? '—' : formatNumber(sharedKnowledge)}</strong>
          <small>Memories available across your company.</small>
        </article>

        <article className="brain-bento-card brain-company-activity">
          <header>
            <CompanyOverviewIcon name="activity" />
            <span>Team activity</span>
            <h2>Take a peek at everyone’s work.</h2>
            <p>Useful movement across {organization.name}, without exposing private content.</p>
          </header>
          <dl>
            {activitySignals.map((signal) => (
              <div key={signal.label}>
                <dt>{signal.label}</dt>
                <dd>{formatNumber(signal.value)}</dd>
              </div>
            ))}
          </dl>
        </article>
      </div>
    </section>
  )
}

function ConnectorsView({
  dashboard,
  demoMode,
  onAuthenticationRequired,
  surface = 'connectors',
}: {
  dashboard: BrainDashboard
  demoMode: boolean
  onAuthenticationRequired: () => void
  surface?: ConnectorSurface
}) {
  const { organization } = dashboard
  const [filter, setFilter] = useState<ConnectorFilter>('all')
  const demoIntegrations = useMemo(() => DEMO_BRAIN_INTEGRATIONS.filter((integration) => (
    integrationMatchesSurface(integration, surface)
  )), [surface])
  const [integrations, setIntegrations] = useState<BrainIntegration[]>(() => demoMode ? demoIntegrations : [])
  const [selectedId, setSelectedId] = useState(() => demoMode ? demoIntegrations[0]?.slug ?? '' : '')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(demoMode ? 'ready' : 'loading')
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [connectScopePreferences, setConnectScopePreferences] = useState<Record<string, BrainIntegrationScope>>({})
  const [clientMemoryWritePreferences, setClientMemoryWritePreferences] = useState<Record<string, boolean>>({})
  const [clientToolExecutionPreferences, setClientToolExecutionPreferences] = useState<Record<string, boolean>>({})
  const [clientSetup, setClientSetup] = useState<BrainIntegrationClientSetup | null>(null)
  const [clientTokenVisible, setClientTokenVisible] = useState(false)
  const [copiedSetupKey, setCopiedSetupKey] = useState<string | null>(null)
  const catalogRef = useRef<HTMLElement>(null)
  const activeRequestRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const wheelAccumulatorRef = useRef(0)
  const wheelLockUntilRef = useRef(0)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  const customConnectionAttemptRef = useRef<{
    signature: string
    idempotencyKey: string
  } | null>(null)

  const connectorIsOnline = useCallback((connector: BrainIntegration) => connector.status === 'active'
    && connector.connections.some((connection) => {
      const status = connection.status.toLowerCase()
      return connection.configuration.enabled && ['active', 'connected', 'installed', 'ready'].includes(status)
    }), [])

  const connectorMatchesFilter = useCallback((connector: BrainIntegration, nextFilter: ConnectorFilter) => {
    if (nextFilter === 'all') return true
    if (nextFilter === 'active') return connectorIsOnline(connector)
    if (nextFilter === 'ai-clients') return connector.kind === 'client_mcp'
    if (nextFilter === 'beta') return connector.availability === 'coming_soon'
    return connector.availability === 'available' && !connectorIsOnline(connector)
  }, [connectorIsOnline])

  const loadIntegrations = useCallback(async () => {
    if (demoMode) {
      setIntegrations(demoIntegrations)
      setSelectedId((currentId) => demoIntegrations.some((connector) => connector.slug === currentId)
        ? currentId
        : demoIntegrations[0]?.slug ?? '')
      setLoadState('ready')
      return true
    }

    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    setLoadState('loading')

    try {
      const nextIntegrations = (await fetchBrainIntegrations(controller.signal)).filter((integration) => (
        integrationMatchesSurface(integration, surface)
      ))
      if (controller.signal.aborted || activeRequestRef.current !== controller || !mountedRef.current) return false
      setIntegrations(nextIntegrations)
      setSelectedId((currentId) => nextIntegrations.some((connector) => connector.slug === currentId)
        ? currentId
        : nextIntegrations[0]?.slug ?? '')
      setLoadState('ready')
      setNotice(null)
      return true
    } catch (error) {
      if (controller.signal.aborted || activeRequestRef.current !== controller || !mountedRef.current) return false
      setLoadState('error')
      if (error instanceof BrainIntegrationHttpError && error.status === 401) {
        setNotice({ tone: 'error', message: 'Your Company Brain session expired. Please sign in again.' })
        onAuthenticationRequired()
      } else {
        setNotice({
          tone: 'error',
          message: userFacingErrorMessage(error, 'Company Brain integrations are unavailable.'),
        })
      }
      return false
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null
    }
  }, [demoIntegrations, demoMode, onAuthenticationRequired, surface])

  useEffect(() => {
    mountedRef.current = true
    if (demoMode) {
      setIntegrations(demoIntegrations)
      setSelectedId((currentId) => demoIntegrations.some((connector) => connector.slug === currentId)
        ? currentId
        : demoIntegrations[0]?.slug ?? '')
      setLoadState('ready')
    } else {
      void loadIntegrations()
    }

    return () => {
      mountedRef.current = false
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
      if (copyFeedbackTimeoutRef.current !== null) window.clearTimeout(copyFeedbackTimeoutRef.current)
    }
  }, [demoIntegrations, demoMode, loadIntegrations])

  const activeConnectorCount = integrations.filter(connectorIsOnline).length
  const integrationsLoading = loadState === 'loading'
  const connectorFilters = surface === 'mcp'
    ? CONNECTOR_FILTERS
    : CONNECTOR_FILTERS.filter((item) => item.id !== 'ai-clients')
  const visibleConnectors = useMemo(() => integrations.filter((connector) => (
    connectorMatchesFilter(connector, filter)
  )), [connectorMatchesFilter, filter, integrations])
  const selectedConnector = visibleConnectors.find((connector) => connector.slug === selectedId)
    ?? visibleConnectors[0]
  const selectedIndex = visibleConnectors.findIndex((connector) => connector.slug === selectedConnector?.slug)
  const enabledCapabilityCount = selectedConnector?.capabilities.filter((capability) => capability.enabled).length ?? 0
  const orderedConnections = useMemo(() => [...(selectedConnector?.connections ?? [])].sort((left, right) => {
    if ((left.status === 'error') !== (right.status === 'error')) return left.status === 'error' ? -1 : 1
    if (left.owned_by_viewer !== right.owned_by_viewer) return left.owned_by_viewer ? -1 : 1
    if (left.scope !== right.scope) return left.scope === 'organization' ? -1 : 1
    if (left.endpoint_host !== right.endpoint_host) {
      return (left.endpoint_host ?? '').localeCompare(right.endpoint_host ?? '')
    }
    return left.id.localeCompare(right.id)
  }), [selectedConnector])
  const endpointLabels = useMemo(() => {
    const groupSizes = new Map<string, number>()
    for (const connection of orderedConnections) {
      if (!connection.endpoint_host) continue
      const group = `${connection.scope}:${connection.endpoint_host}`
      groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1)
    }
    const positions = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const connection of orderedConnections) {
      if (!connection.endpoint_host) continue
      const group = `${connection.scope}:${connection.endpoint_host}`
      const position = (positions.get(group) ?? 0) + 1
      positions.set(group, position)
      labels.set(
        connection.id,
        groupSizes.get(group) === 1
          ? connection.endpoint_host
          : `${connection.endpoint_host} · Connection ${position}`,
      )
    }
    return labels
  }, [orderedConnections])
  const selectedConnection = orderedConnections[0]
  const editableExecutionPolicyConnections = orderedConnections.filter((connection) => (
    connection.execution_policy.editable && connection.execution_policy.update_path
  ))
  const executionPolicyConnection = editableExecutionPolicyConnections.length === 1
    ? editableExecutionPolicyConnections[0]
    : undefined
  const canManageOrganization = organization.role === 'admin' || organization.role === 'owner'
  const actorScopeOptions = (selectedConnector?.scope_options ?? []).filter((scope) => (
    scope === 'personal' || canManageOrganization
  ))
  const connectableScopes = selectedConnector?.kind === 'custom_connection'
    ? actorScopeOptions
    : actorScopeOptions.filter((scope) => !orderedConnections.some((connection) => (
        connection.scope === scope && (scope === 'organization' || connection.owned_by_viewer)
      )))
  const savedConnectScope = selectedConnector
    ? connectScopePreferences[selectedConnector.slug]
    : undefined
  const isStaticKeyConnector = selectedConnector?.kind === 'connected_app'
    && selectedConnector.auth_type === 'static'
  const staticScope = isStaticKeyConnector && actorScopeOptions.includes('personal')
    ? 'personal'
    : undefined
  const hasStaticPersonalConnection = isStaticKeyConnector && orderedConnections.some((connection) => (
    connection.scope === 'personal' && connection.owned_by_viewer
  ))
  const connectScope = savedConnectScope && connectableScopes.includes(savedConnectScope)
    ? savedConnectScope
    : connectableScopes.includes('personal')
      ? 'personal'
      : connectableScopes[0]
  const clientMemoryWrite = selectedConnector
    ? clientMemoryWritePreferences[selectedConnector.slug] ?? false
    : false
  const clientToolExecution = selectedConnector
    ? clientToolExecutionPreferences[selectedConnector.slug] ?? false
    : false

  useEffect(() => {
    setClientSetup(null)
    setClientTokenVisible(false)
    setCopiedSetupKey(null)
  }, [selectedConnector?.slug])

  const selectRelativeConnector = useCallback((direction: -1 | 1) => {
    setSelectedId((currentId) => {
      const currentIndex = visibleConnectors.findIndex((connector) => connector.slug === currentId)
      const safeIndex = currentIndex >= 0 ? currentIndex : 0
      const nextIndex = Math.min(Math.max(safeIndex + direction, 0), visibleConnectors.length - 1)
      return visibleConnectors[nextIndex]?.slug ?? currentId
    })
  }, [visibleConnectors])

  useEffect(() => {
    const catalog = catalogRef.current
    if (!catalog) return undefined

    function handleWheel(event: WheelEvent) {
      if (window.matchMedia('(max-width: 760px)').matches) return

      event.preventDefault()
      event.stopPropagation()

      const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      const normalizedDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? rawDelta * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? rawDelta * (catalogRef.current?.clientHeight ?? 1)
          : rawDelta
      const now = window.performance.now()

      if (now < wheelLockUntilRef.current) return

      wheelAccumulatorRef.current += normalizedDelta
      if (Math.abs(wheelAccumulatorRef.current) < 36) return

      const direction = wheelAccumulatorRef.current > 0 ? 1 : -1
      wheelAccumulatorRef.current = 0
      wheelLockUntilRef.current = now + 170
      selectRelativeConnector(direction)
    }

    catalog.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      catalog.removeEventListener('wheel', handleWheel)
      wheelAccumulatorRef.current = 0
    }
  }, [selectRelativeConnector])

  function handleCatalogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectRelativeConnector(1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectRelativeConnector(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSelectedId(visibleConnectors[0]?.slug ?? '')
    } else if (event.key === 'End') {
      event.preventDefault()
      setSelectedId(visibleConnectors[visibleConnectors.length - 1]?.slug ?? '')
    }
  }

  function chooseFilter(nextFilter: ConnectorFilter) {
    setFilter(nextFilter)
    setNotice(null)
    const nextVisible = integrations.filter((connector) => connectorMatchesFilter(connector, nextFilter))
    if (!nextVisible.some((connector) => connector.slug === selectedId)) {
      setSelectedId(nextVisible[0]?.slug ?? '')
    }
  }

  function connectorStatus(connector: BrainIntegration) {
    if (connector.availability === 'coming_soon') return 'Coming soon'
    return formatLabel(connector.status)
  }

  function setOperationError(error: unknown, fallback: string) {
    if (!mountedRef.current) return
    if (error instanceof BrainIntegrationHttpError && error.status === 401) {
      setNotice({ tone: 'error', message: 'Your Company Brain session expired. Please sign in again.' })
      onAuthenticationRequired()
      return
    }
    setNotice({ tone: 'error', message: userFacingErrorMessage(error, fallback) })
  }

  async function startIntegration(reconnect: boolean) {
    if (demoMode || busyAction || !selectedConnector) return
    const action = reconnect ? selectedConnector.actions.reconnect : selectedConnector.actions.connect
    if (!action.enabled || !action.path) return
    if (selectedConnector.kind === 'custom_connection') return
    if (selectedConnector.kind === 'connected_app' && selectedConnector.auth_type === 'static') return

    const actionKey = `${selectedConnector.slug}:${reconnect ? 'reconnect' : 'connect'}`
    setBusyAction(actionKey)
    setNotice(null)
    setClientSetup(null)
    try {
      const result = selectedConnector.kind === 'client_mcp'
        ? await connectBrainIntegration(action.path, {
            memory_write: clientMemoryWrite,
            tool_execution: clientToolExecution,
          })
        : await connectBrainIntegration(action.path, {
            redirect_url: window.location.href,
            ...(reconnect
              ? selectedConnection && selectedConnector.slug !== 'slack'
                ? { connection_id: selectedConnection.id }
                : {}
              : { scope: connectScope }),
          })
      if (!mountedRef.current) return
      if (result.type === 'oauth') {
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.type === 'client') {
        setClientSetup(result.setup)
        setClientTokenVisible(false)
        setCopiedSetupKey(null)
        const refreshed = await loadIntegrations()
        if (!mountedRef.current || !refreshed) return
        setNotice({ tone: 'success', message: `${selectedConnector.name} setup is ready. Save the one-time token before closing it.` })
        return
      }

      await loadIntegrations()
      if (!mountedRef.current) return
      setNotice({ tone: 'success', message: `${selectedConnector.name} is connected.` })
    } catch (error) {
      setOperationError(error, `Unable to ${reconnect ? 'reconnect' : 'connect'} ${selectedConnector.name}.`)
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function connectStaticKeyApp(input: {
    secret: string
    scope: BrainIntegrationScope
  }) {
    if (
      demoMode || busyAction || !selectedConnector
      || selectedConnector.kind !== 'connected_app'
      || selectedConnector.auth_type !== 'static'
      || input.scope !== 'personal'
      || hasStaticPersonalConnection
    ) return false

    const action = selectedConnector.actions.connect
    if (!action.enabled || !action.path) return false

    setBusyAction(`${selectedConnector.slug}:connect`)
    setNotice(null)
    try {
      const result = await connectBrainIntegration(action.path, {
        scope: input.scope,
        secret: input.secret,
      })
      if (result.type !== 'custom') {
        throw new Error(`The ${selectedConnector.name} connection could not be completed. Please try again.`)
      }
      if (!mountedRef.current) return false
      const refreshed = await loadIntegrations()
      if (!mountedRef.current || !refreshed) return false
      setNotice({
        tone: 'success',
        message: `${selectedConnector.name} is connected.`,
      })
      return true
    } catch (error) {
      setOperationError(error, `Unable to connect ${selectedConnector.name}.`)
      return false
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function connectCustomEndpoint(input: {
    endpointUrl: string
    authMode: BrainIntegrationCustomAuthMode
    secret?: string
    scope: BrainIntegrationScope
  }) {
    if (
      demoMode || busyAction || !selectedConnector
      || selectedConnector.kind !== 'custom_connection'
      || !selectedConnector.actions.connect.enabled
      || !selectedConnector.actions.connect.path
    ) return false

    setBusyAction(`${selectedConnector.slug}:connect`)
    setNotice(null)
    const signature = await customConnectionAttemptSignature(input)
    if (customConnectionAttemptRef.current?.signature !== signature) {
      customConnectionAttemptRef.current = {
        signature,
        idempotencyKey: crypto.randomUUID(),
      }
    }
    const idempotencyKey = customConnectionAttemptRef.current.idempotencyKey
    try {
      const result = await connectBrainIntegration(selectedConnector.actions.connect.path, {
        endpoint_url: input.endpointUrl,
        auth_mode: input.authMode,
        ...(input.secret ? { secret: input.secret } : {}),
        scope: input.scope,
      }, { idempotencyKey })
      if (result.type !== 'custom') throw new Error('The custom connection could not be completed. Please try again.')
      customConnectionAttemptRef.current = null
      if (!mountedRef.current) return false
      const refreshed = await loadIntegrations()
      if (!mountedRef.current || !refreshed) return false
      setNotice({ tone: 'success', message: `${selectedConnector.name} is connected.` })
      return true
    } catch (error) {
      if (
        error instanceof BrainIntegrationHttpError
        && error.status < 500
        && !(error.status === 409 && error.code === 'custom_connection_in_progress')
      ) {
        customConnectionAttemptRef.current = null
      }
      setOperationError(error, `Unable to connect ${selectedConnector.name}.`)
      return false
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function copyClientSetupValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      if (!mountedRef.current) return
      setCopiedSetupKey(key)
      if (copyFeedbackTimeoutRef.current !== null) window.clearTimeout(copyFeedbackTimeoutRef.current)
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        copyFeedbackTimeoutRef.current = null
        if (mountedRef.current) setCopiedSetupKey(null)
      }, 1_800)
    } catch {
      if (mountedRef.current) setNotice({ tone: 'error', message: 'Clipboard access was unavailable. Select and copy the value manually.' })
    }
  }

  async function toggleConnection(connection: BrainIntegrationConnection) {
    const updatePath = connection.configuration.update_path
    if (demoMode || busyAction || !connection.configuration.editable || !updatePath) return
    const nextEnabled = !connection.configuration.enabled
    setBusyAction(`${connection.id}:configuration`)
    setNotice(null)
    try {
      await setBrainIntegrationEnabled(updatePath, nextEnabled)
      if (!mountedRef.current) return
      const refreshed = await loadIntegrations()
      if (!mountedRef.current || !refreshed) return
      setNotice({
        tone: 'success',
        message: `${formatLabel(connection.scope)} ${selectedConnector?.name ?? 'connection'} is now ${nextEnabled ? 'enabled' : 'disabled'}.`,
      })
    } catch (error) {
      setOperationError(error, 'Unable to update this connection.')
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function toggleExecutionPolicy(capabilityId: ExecutionPolicyCapabilityId) {
    if (demoMode || busyAction || !selectedConnector || !executionPolicyConnection) return
    const capability = selectedConnector.capabilities.find((item) => item.id === capabilityId)
    const updatePath = executionPolicyConnection.execution_policy.update_path
    if (!capability?.supported || !updatePath) return

    const nextEnabled = !executionPolicyConnection.execution_policy[capabilityId]
    setBusyAction(`${executionPolicyConnection.id}:execution-policy:${capabilityId}`)
    setNotice(null)
    try {
      await setBrainIntegrationExecutionPolicy(
        updatePath,
        capabilityId === 'read_operations'
          ? { read_operations: nextEnabled }
          : { approved_writes: nextEnabled },
      )
      if (!mountedRef.current) return
      const refreshed = await loadIntegrations()
      if (!mountedRef.current || !refreshed) return
      setNotice({
        tone: 'success',
        message: capabilityId === 'read_operations'
          ? `${selectedConnector.name} reads are now ${nextEnabled ? 'automatic' : 'blocked'}.`
          : `${selectedConnector.name} writes are now ${nextEnabled ? 'allowed with approval' : 'blocked'}.`,
      })
    } catch (error) {
      setOperationError(error, `Unable to update ${selectedConnector.name} tool permissions.`)
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function disconnectConnection(connection: BrainIntegrationConnection) {
    if (demoMode || busyAction || !connection.revoke_path || !selectedConnector) return
    const endpointLabel = endpointLabels.get(connection.id)
    const confirmed = window.confirm(
      `Disconnect the ${formatLabel(connection.scope)} ${selectedConnector.name}${endpointLabel ? ` on ${endpointLabel}` : ''} connection from Company Brain?`,
    )
    if (!confirmed) return

    setBusyAction(`${connection.id}:revoke`)
    setNotice(null)
    try {
      const result = await revokeBrainIntegration(connection.revoke_path)
      if (!mountedRef.current) return
      const refreshed = await loadIntegrations()
      if (!mountedRef.current || !refreshed) return
      setNotice({
        tone: 'success',
        message: result.providerUninstallRequired
          ? `${formatLabel(connection.scope)} ${selectedConnector.name} was disconnected from Company Brain. The provider may still require uninstalling its app.`
          : `${formatLabel(connection.scope)} ${selectedConnector.name} was disconnected.`,
      })
    } catch (error) {
      setOperationError(error, `Unable to disconnect ${selectedConnector.name}.`)
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  function catalogEmptyCopy() {
    const noun = surface === 'mcp' ? 'MCP connections' : 'integrations'
    if (demoMode) return ['Connections unavailable in read-only demo', `Sign in to load and manage Company Brain ${noun}.`]
    if (loadState === 'error') return [`${surface === 'mcp' ? 'MCP connections' : 'Integrations'} unavailable`, notice?.message ?? `Company Brain did not return its ${noun} catalog.`]
    if (integrations.length) return [`No matching ${noun}`, 'Choose another filter to see the available modules.']
    return [`No ${noun} available`, `Company Brain did not return any ${noun}.`]
  }

  const emptyCopy = catalogEmptyCopy()
  const connectionCount = orderedConnections.length
  const scopeSummary = selectedConnection
    ? `${formatLabel(selectedConnection.scope)} scope · ${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`
    : selectedConnector?.kind === 'client_mcp'
      ? 'Signed-in member access'
      : 'Not connected'
  const canConnect = Boolean(selectedConnector?.actions.connect.enabled
    && selectedConnector.actions.connect.path
    && !demoMode
    && (selectedConnector.kind === 'client_mcp' || connectScope))
  const staticAction = isStaticKeyConnector ? selectedConnector?.actions.connect : null
  const showConnectAction = selectedConnector?.kind !== 'custom_connection'
    && !isStaticKeyConnector
    && (selectedConnector?.kind === 'client_mcp' || !selectedConnection || connectableScopes.length > 0)
  const connectActionDescription = notice?.message
    ?? selectedConnector?.status_reason
    ?? selectedConnector?.actions.connect.reason
    ?? (selectedConnector?.kind === 'client_mcp'
      ? 'Generate a one-time setup token for the signed-in member.'
      : connectScope
        ? `Authorize a ${formatLabel(connectScope)} connection for Company Brain.`
        : 'No additional connection scope is available.')
  const footerStatus = selectedConnector?.last_sync_at
    ? `Last sync: ${formatDate(selectedConnector.last_sync_at)}`
    : selectedConnection?.updated_at
      ? `Connection updated: ${formatDate(selectedConnection.updated_at)}`
      : 'Last sync unavailable'

  return (
    <section className="brain-connectors-workspace" aria-labelledby={`brain-${surface}-title`}>
      <header className="brain-connectors-toolbar">
        <div className="brain-connectors-toolbar__title">
          <span className="brain-connectors-toolbar__mark"><ConnectorIcon name="memory" /></span>
          <h1 id={`brain-${surface}-title`}>{surface === 'mcp' ? 'MCP' : 'Integrations'}</h1>
          <span className="brain-connectors-toolbar__count">
            {integrationsLoading ? '— modules' : `${integrations.length} modules`}
          </span>
        </div>
        <nav className="brain-connectors-filters" aria-label={surface === 'mcp' ? 'Filter MCP connections' : 'Filter connectors'}>
          {connectorFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? 'is-active' : ''}
              aria-pressed={filter === item.id}
              onClick={() => chooseFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div
          className="brain-connectors-toolbar__health"
          aria-label={integrationsLoading
            ? 'Loading active Company Brain integrations'
            : `${activeConnectorCount} active Company Brain integrations`}
        >
          <button
            type="button"
            disabled={demoMode || integrationsLoading || busyAction !== null}
            onClick={() => void loadIntegrations()}
          ><SyncIcon />Refresh</button>
          <i className={activeConnectorCount > 0 ? 'is-active' : ''} />
          <strong>{integrationsLoading ? '— online' : `${activeConnectorCount} online`}</strong>
        </div>
      </header>

      <div
        className={`brain-connectors-layout${integrationsLoading ? ' is-loading' : ''}`}
        aria-busy={integrationsLoading || undefined}
      >
        {integrationsLoading ? (
          <div className="brain-connectors-loading" role="status" aria-live="polite">
            <span className="brain-connectors-loading__spinner" aria-hidden="true" />
            <span>{surface === 'mcp' ? 'Loading MCP connections' : 'Loading integrations'}</span>
          </div>
        ) : (
          <>
        <section
          ref={catalogRef}
          className="brain-connector-catalog"
          aria-label={`${surface === 'mcp' ? 'Company Brain MCP connections' : 'Company Brain connectors'}. Scroll or use arrow keys to browse.`}
          tabIndex={0}
          onKeyDown={handleCatalogKeyDown}
        >
          {visibleConnectors.length ? (
            <div className="brain-connector-stack">
              {visibleConnectors.map((connector, index) => {
                const isSelected = selectedConnector?.slug === connector.slug
                const distance = index - selectedIndex
                const depth = Math.abs(distance)
                const rotation = isSelected ? 0 : Math.sign(distance) * Math.min(8, 2.8 + depth * 1.7)
                const opacity = isSelected ? 1 : depth === 1 ? 0.48 : depth === 2 ? 0.24 : depth === 3 ? 0.1 : 0
                const cardStyle = {
                  '--connector-offset': `${distance * 74}px`,
                  '--connector-rotation': `${rotation}deg`,
                  '--connector-opacity': String(opacity),
                  '--connector-shift': `${isSelected ? 0 : -Math.min(depth * 10, 28)}px`,
                  '--connector-scale': String(isSelected ? 1.02 : Math.max(0.9, 0.98 - depth * 0.025)),
                  '--connector-z': String(Math.max(1, 8 - depth)),
                } as CSSProperties
                return (
                  <button
                    key={connector.slug}
                    id={`brain-connector-${connector.slug}`}
                    type="button"
                    className={`${isSelected ? 'brain-connector-card is-selected' : 'brain-connector-card'}${depth > 3 ? ' is-distant' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(connector.slug)
                      setNotice(null)
                    }}
                    style={cardStyle}
                  >
                    <span className="brain-connector-icon"><ConnectorIcon name={connectorIconName(connector.slug)} /></span>
                    <span className="brain-connector-card__copy">
                      <strong>{connector.name}</strong>
                      <small>{connector.description}</small>
                    </span>
                    <span className={connectorIsOnline(connector) ? 'brain-connector-card__status is-active' : 'brain-connector-card__status'}>
                      <i />{connectorStatus(connector)}
                    </span>
                    <ChevronIcon />
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="brain-connector-catalog__empty" role="status">
              <strong>{emptyCopy[0]}</strong>
              <span>{emptyCopy[1]}</span>
            </div>
          )}
        </section>

        <section className="brain-connector-inspector" aria-live="polite">
          {selectedConnector ? (
            <>
              <div className="brain-connector-summary">
                <span className="brain-connector-icon brain-connector-icon--large"><ConnectorIcon name={connectorIconName(selectedConnector.slug)} /></span>
                <div className="brain-connector-summary__copy">
                  <div><h2>{selectedConnector.name}</h2><span>{selectedConnector.version}</span></div>
                  <p>{selectedConnector.description}</p>
                  <footer>
                    <span className={connectorIsOnline(selectedConnector) ? 'is-active' : ''}><i />{connectorStatus(selectedConnector)}</span>
                    <span>{enabledCapabilityCount}/{selectedConnector.capabilities.length} aggregate features on</span>
                    <span>{scopeSummary}</span>
                  </footer>
                </div>
                <div
                  className="brain-connector-summary__metric"
                  style={{ '--connector-utilization': `${selectedConnector.utilization ?? 0}%` } as CSSProperties}
                >
                  <strong>{selectedConnector.utilization ?? '—'}</strong>
                  <span>Util%</span>
                </div>
              </div>

              <div className="brain-connector-configuration__label">Company Brain configuration · aggregate across visible connections</div>
              {selectedConnector.scope_options.includes('personal') ? (
                <div className="brain-connector-scope-note" role="note">
                  <strong>Personal and shared connections stay separate.</strong>
                  <span>
                    {organization.role === 'member'
                      ? `A personal ${selectedConnector.name} connection belongs only to the member who connected it. Connect your own account here; an admin or owner can add an organization-shared connection when supported.`
                      : `Personal ${selectedConnector.name} connections belong only to the member who connected them. Choose organization scope only when this connection should be shared with authorized members.`}
                  </span>
                </div>
              ) : null}
              <div className="brain-connector-configuration">
                {selectedConnector.capabilities.map((capability) => {
                  const policyCapabilityId = isExecutionPolicyCapabilityId(capability.id)
                    ? capability.id
                    : null
                  const canConfigurePolicy = Boolean(
                    policyCapabilityId
                    && capability.supported
                    && executionPolicyConnection,
                  )
                  const capabilityEnabled = policyCapabilityId && executionPolicyConnection
                    ? executionPolicyConnection.execution_policy[policyCapabilityId]
                    : capability.enabled
                  return (
                    <article key={capability.id} className={capability.supported && capabilityEnabled ? 'is-enabled' : ''}>
                      <i />
                      <div><strong>{capability.name}</strong><span>{capability.description}</span></div>
                      <button
                        type="button"
                        className={capability.supported && capabilityEnabled ? 'brain-connector-switch is-on' : 'brain-connector-switch'}
                        aria-label={`${capability.name}: ${capability.supported ? (capabilityEnabled ? 'enabled' : 'not enabled') : 'unsupported'}`}
                        aria-pressed={capability.supported && capabilityEnabled}
                        disabled={demoMode || busyAction !== null || !canConfigurePolicy}
                        onClick={() => {
                          if (policyCapabilityId) void toggleExecutionPolicy(policyCapabilityId)
                        }}
                      ><span /></button>
                    </article>
                  )
                })}
                {selectedConnector.kind === 'client_mcp' ? (
                  <>
                    <article className={clientMemoryWrite ? 'is-enabled' : ''}>
                      <i />
                      <div>
                        <strong>Allow memory writes</strong>
                        <span>{clientMemoryWrite
                          ? `${selectedConnector.name} may add context to your personal memory space.`
                          : `${selectedConnector.name} will receive read-only memory access.`}</span>
                      </div>
                      <button
                        type="button"
                        className={clientMemoryWrite ? 'brain-connector-switch is-on' : 'brain-connector-switch'}
                        aria-label={`${selectedConnector.name} memory writes: ${clientMemoryWrite ? 'allowed' : 'not allowed'}`}
                        aria-pressed={clientMemoryWrite}
                        disabled={demoMode || busyAction !== null}
                        onClick={() => setClientMemoryWritePreferences((current) => ({
                          ...current,
                          [selectedConnector.slug]: !clientMemoryWrite,
                        }))}
                      ><span /></button>
                    </article>
                    <article className={clientToolExecution ? 'is-enabled' : ''}>
                      <i />
                      <div>
                        <strong>Allow tool execution</strong>
                        <span>{clientToolExecution
                          ? `${selectedConnector.name} may run read-only connected-app tools and isolated code tasks.`
                          : 'External app execution and isolated code tools stay off.'}</span>
                      </div>
                      <button
                        type="button"
                        className={clientToolExecution ? 'brain-connector-switch is-on' : 'brain-connector-switch'}
                        aria-label={`${selectedConnector.name} tool execution: ${clientToolExecution ? 'allowed' : 'not allowed'}`}
                        aria-pressed={clientToolExecution}
                        disabled={demoMode || busyAction !== null}
                        onClick={() => setClientToolExecutionPreferences((current) => ({
                          ...current,
                          [selectedConnector.slug]: !clientToolExecution,
                        }))}
                      ><span /></button>
                    </article>
                  </>
                ) : null}
                {selectedConnector.kind !== 'custom_connection'
                  && !isStaticKeyConnector
                  && connectableScopes.length > 0 ? (
                  <article className={connectScope === 'organization' ? 'is-enabled' : ''}>
                    <i />
                    <div>
                      <strong>Share new connection with organization</strong>
                      <span>{connectScope === 'organization'
                        ? 'The new connection will be available to authorized company members.'
                        : 'The new connection will be visible only to your account.'}</span>
                    </div>
                    <button
                      type="button"
                      className={connectScope === 'organization' ? 'brain-connector-switch is-on' : 'brain-connector-switch'}
                      aria-label={`New connection scope: ${connectScope === 'organization' ? 'organization' : 'personal'}`}
                      aria-pressed={connectScope === 'organization'}
                      disabled={demoMode
                        || busyAction !== null
                        || connectableScopes.length < 2
                        || !selectedConnector}
                      onClick={() => {
                        if (!selectedConnector || connectableScopes.length < 2) return
                        const nextScope = connectScope === 'organization' ? 'personal' : 'organization'
                        if (!connectableScopes.includes(nextScope)) return
                        setConnectScopePreferences((current) => ({
                          ...current,
                          [selectedConnector.slug]: nextScope,
                        }))
                      }}
                    ><span /></button>
                  </article>
                ) : null}
                {isStaticKeyConnector && staticScope && !hasStaticPersonalConnection ? (
                  <StaticKeyConnectionForm
                    key={`${selectedConnector.slug}:${staticScope}`}
                    name={selectedConnector.name}
                    scope={staticScope}
                    busy={busyAction !== null}
                    disabled={demoMode
                      || !staticAction?.enabled
                      || !staticAction.path}
                    onConnect={connectStaticKeyApp}
                  />
                ) : null}
                {selectedConnector.kind === 'custom_connection' && connectScope ? (
                  <CustomConnectionForm
                    key={selectedConnector.slug}
                    name={selectedConnector.name}
                    scope={connectScope}
                    scopeOptions={connectableScopes}
                    busy={busyAction !== null}
                    disabled={demoMode
                      || !selectedConnector.actions.connect.enabled
                      || !selectedConnector.actions.connect.path
                      || !connectScope}
                    onScopeChange={(nextScope) => setConnectScopePreferences((current) => ({
                      ...current,
                      [selectedConnector.slug]: nextScope,
                    }))}
                    onConnect={connectCustomEndpoint}
                  />
                ) : null}
                {orderedConnections.map((connection) => (
                  <article key={`${connection.id}:configuration`} className={connection.configuration.enabled ? 'is-enabled' : ''}>
                    <i />
                    <div>
                      <strong>{connection.scope === 'personal'
                        ? 'Personal · only you'
                        : `Organization · shared with ${organization.name}`}</strong>
                      <span>{endpointLabels.has(connection.id) ? `${endpointLabels.get(connection.id)} · ` : ''}{connection.owned_by_viewer ? 'Owned by you' : 'Managed by your organization'} · {formatLabel(connection.status)}</span>
                    </div>
                    <button
                      type="button"
                      className={connection.configuration.enabled ? 'brain-connector-switch is-on' : 'brain-connector-switch'}
                      aria-label={`${formatLabel(connection.scope)} connection: ${connection.configuration.enabled ? 'enabled' : 'disabled'}`}
                      aria-pressed={connection.configuration.enabled}
                      disabled={demoMode
                        || busyAction !== null
                        || !connection.configuration.editable
                        || !connection.configuration.update_path}
                      onClick={() => void toggleConnection(connection)}
                    ><span /></button>
                  </article>
                ))}
                {showConnectAction ? (
                  <article className="brain-connector-configuration__action">
                    <i />
                    <div>
                      <strong>{selectedConnection ? `Connect another ${selectedConnector.name} scope` : `Connect ${selectedConnector.name}`}</strong>
                      <span role={notice ? (notice.tone === 'error' ? 'alert' : 'status') : undefined}>{connectActionDescription}</span>
                    </div>
                    <button
                      type="button"
                      className="brain-connector-action-button"
                      disabled={busyAction !== null || !canConnect}
                      onClick={() => void startIntegration(false)}
                    >{busyAction
                        ? 'Working…'
                        : selectedConnector.kind === 'client_mcp'
                          ? 'Generate setup'
                          : connectScope === 'organization'
                            ? 'Connect for organization'
                            : 'Connect for me'}</button>
                  </article>
                ) : null}
                {orderedConnections.map((connection) => (
                  <article key={`${connection.id}:disconnect`} className="brain-connector-configuration__action">
                    <i />
                    <div>
                      <strong>Disconnect {formatLabel(connection.scope)} {selectedConnector.name}{endpointLabels.has(connection.id) ? ` · ${endpointLabels.get(connection.id)}` : ''}</strong>
                      <span>{connection.revoke_path
                        ? `Remove this ${formatLabel(connection.scope)} connection from Company Brain.`
                        : 'This connection is managed by your organization.'}</span>
                    </div>
                    <button
                      type="button"
                      className="brain-connector-action-button"
                      disabled={demoMode || busyAction !== null || !connection.revoke_path}
                      onClick={() => void disconnectConnection(connection)}
                    >{busyAction === `${connection.id}:revoke` ? 'Working…' : 'Disconnect'}</button>
                  </article>
                ))}
                {!showConnectAction && notice ? (
                  <article className="brain-connector-configuration__action">
                    <i />
                    <div>
                      <strong>Integration status</strong>
                      <span role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</span>
                    </div>
                    <button type="button" className="brain-connector-action-button" disabled>Updated</button>
                  </article>
                ) : null}
              </div>

              {selectedConnector.kind === 'client_mcp' && clientSetup ? (
                <ClientSetupPanel
                  name={selectedConnector.name}
                  setup={clientSetup}
                  copiedKey={copiedSetupKey}
                  tokenVisible={clientTokenVisible}
                  onCopy={(key, value) => void copyClientSetupValue(key, value)}
                  onToggleToken={() => setClientTokenVisible((visible) => !visible)}
                  onDismiss={() => {
                    setClientSetup(null)
                    setClientTokenVisible(false)
                    setCopiedSetupKey(null)
                  }}
                />
              ) : null}

              <footer className="brain-connector-syncbar">
                <span><SyncIcon />{footerStatus}</span>
                {!isStaticKeyConnector ? (
                  <button
                    type="button"
                    disabled={demoMode
                      || busyAction !== null
                      || !selectedConnector.actions.reconnect.enabled
                      || !selectedConnector.actions.reconnect.path
                      || selectedConnector.kind === 'custom_connection'
                      || (selectedConnector.kind !== 'client_mcp' && !selectedConnection)}
                    onClick={() => void startIntegration(true)}
                  >Reconnect</button>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="brain-connector-inspector__empty">Choose a connector to inspect its capabilities.</div>
          )}
        </section>
          </>
        )}
      </div>
    </section>
  )
}

async function customConnectionAttemptSignature(input: {
  endpointUrl: string
  authMode: BrainIntegrationCustomAuthMode
  secret?: string
  scope: BrainIntegrationScope
}) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(input)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function McpLockedState({ onOpenPricing }: { onOpenPricing: () => void }) {
  return (
    <section className="brain-runtime-settings brain-runtime-settings--state brain-mcp-locked" aria-labelledby="brain-mcp-locked-title">
      <span className="brain-mcp-locked__eyebrow">Company Brain Plus</span>
      <h1 id="brain-mcp-locked-title">Bring Company Brain into your coding tools.</h1>
      <p>Codex, Claude Code, Cursor and custom MCP setup are included with an active Company Brain Plus plan.</p>
      <button type="button" onClick={onOpenPricing}>View Company Brain Plus</button>
    </section>
  )
}

export default function CompanyBrainDashboard({
  dashboard,
  state,
  warning,
  view,
  demoMode,
  onAuthenticationRequired,
  onOpenPricing,
}: CompanyBrainDashboardProps) {
  if (!dashboard) return <DataState state={state} warning={warning} />

  return (
    <>
      {warning ? <div className="dashboard-alert" role="status">{warning}</div> : null}
      {view === 'usage'
        ? canViewBrainUsage(dashboard)
          ? <UsageView dashboard={dashboard} />
          : <UsageAccessState organizationName={dashboard.organization.name} />
        : null}
      {view === 'company' ? (
        <CompanyView
          dashboard={dashboard}
          demoMode={demoMode}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
      {view === 'connectors' ? (
        <ConnectorsView
          dashboard={dashboard}
          demoMode={demoMode}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
      {view === 'mcp' ? (
        dashboard.features?.mcp_access === true ? (
          <ConnectorsView
            dashboard={dashboard}
            demoMode={demoMode}
            onAuthenticationRequired={onAuthenticationRequired}
            surface="mcp"
          />
        ) : <McpLockedState onOpenPricing={onOpenPricing} />
      ) : null}
      {view === 'settings' ? (
        <>
          <BrainRuntimeSettings
            dashboard={dashboard}
            demoMode={demoMode}
            onAuthenticationRequired={onAuthenticationRequired}
          />
          <BrainAgentMailSettings
            key={`agentmail-${dashboard.organization.id}`}
            dashboard={dashboard}
            demoMode={demoMode}
            onAuthenticationRequired={onAuthenticationRequired}
          />
        </>
      ) : null}
      {view === 'code' ? (
        <BrainCodeModeSettings
          dashboard={dashboard}
          demoMode={demoMode}
          onAuthenticationRequired={onAuthenticationRequired}
          onOpenPricing={onOpenPricing}
        />
      ) : null}
    </>
  )
}
